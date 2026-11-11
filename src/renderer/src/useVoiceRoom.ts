import { useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'
import { loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor'
import rnnoiseWorkletPath from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'
import rnnoiseWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url'
import rnnoiseSimdWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url'

const ROOM = 'main'

// Free public STUN server. We'll add our own TURN server later.
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
}

const MAX_TEXT = 2000
const MAX_FILE = 100 * 1024 * 1024 // 100 MB, files are held in RAM while receiving
const CHUNK = 16 * 1024
const MAX_BUFFER = 4 * 1024 * 1024

type Signal = { description: RTCSessionDescriptionInit } | { candidate: RTCIceCandidateInit }

type Incoming = {
  key: string
  size: number
  received: number
  chunks: ArrayBuffer[]
  lastStep: number
  skip: boolean
}

type Peer = {
  pc: RTCPeerConnection
  polite: boolean
  makingOffer: boolean
  ignoreOffer: boolean
  screenSender?: RTCRtpSender
  micSender?: RTCRtpSender
  chat?: RTCDataChannel
  files?: RTCDataChannel
  name?: string
  incoming?: Incoming
  sendChain: Promise<void>
}

export type ShareQuality = 'hd60' | 'qhd60'

export const PRESETS: Record<
  ShareQuality,
  { label: string; width: number; height: number; fps: number; bitrate: number }
> = {
  hd60: { label: '1080p 60 fps', width: 1920, height: 1080, fps: 60, bitrate: 8_000_000 },
  qhd60: { label: '1440p 60 fps', width: 2560, height: 1440, fps: 60, bitrate: 16_000_000 }
}

export type ChatMsg = { key: string; from: string; text: string; self: boolean }

export type Transfer = {
  key: string
  who: string
  fileName: string
  size: number
  progress: number // 0 to 1
  direction: 'in' | 'out'
  done: boolean
  failed?: boolean
  url?: string
}

const newKey = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

function cleanName(input: unknown): string {
  const s = String(input ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 32)
  return s || 'Guest'
}

// Remove paths and characters Windows does not allow
function safeFileName(input: string): string {
  const base = input.split(/[\\/]/).pop() ?? ''
  const s = base
    .replace(/[<>:"|?*\u0000-\u001f]/g, '_')
    .trim()
    .slice(-100)
  return s || 'file'
}

function waitDrain(ch: RTCDataChannel): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      ch.removeEventListener('bufferedamountlow', done)
      ch.removeEventListener('close', done)
      resolve()
    }
    ch.addEventListener('bufferedamountlow', done)
    ch.addEventListener('close', done)
  })
}

export type NoiseMode = 'off' | 'standard' | 'strong'

type Mic = { stream: MediaStream; cleanup: () => void; setGain: (g: number) => void }

async function openMic(deviceId: string, noise: NoiseMode, boost: number) : Promise<Mic> {
  const raw = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: false,
      autoGainControl: true,
      //Only one noise filter at a time: the browser's, or RNNoise
      noiseSuppression: false
    },
    video: false
  })
  const stopRaw = (): void => raw.getTracks().forEach((t) => t.stop())

  const ctx = new AudioContext({ sampleRate: 48000 }) // RNNoise needs 48 KHz
  try {
    const source = ctx.createMediaStreamSource(raw)
    let last: AudioNode = source

    if (noise === 'strong') {
      await ctx.audioWorklet.addModule(rnnoiseWorkletPath)
      const wasmBinary = await loadRnnoise({ url: rnnoiseWasmPath, simdUrl: rnnoiseSimdWasmPath })
      const denoise = new RnnoiseWorkletNode(ctx, { wasmBinary, maxChannels: 1 })
      last.connect(denoise)
      last = denoise
    }

    // Leveler: lifts quiet speech and tames peaks
    const leveler = ctx.createDynamicsCompressor()
    leveler.threshold.value = -30
    leveler.knee.value = 20
    leveler.ratio.value = 4
    leveler.attack.value = 0.005
    leveler.release.value = 0.2

    const gain = ctx.createGain()
    gain.gain.value = boost

    // Limiter: stops the boost from clipping
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -3
    limiter.knee.value = 0
    limiter.ratio.value = 20
    limiter.attack.value = 0.003
    limiter.release.value = 0.1

    const dest = ctx.createMediaStreamDestination()
    last.connect(leveler)
    leveler.connect(gain)
    gain.connect(limiter)
    limiter.connect(dest)

    return {
      stream: dest.stream,
      cleanup: () => {
        stopRaw()
        ctx.close().catch(() => {})
      },
      setGain: (g: number) => {
        gain.gain.value = g
      }
    }
  } catch (e) {
    stopRaw()
    ctx.close().catch(() => {})
    throw e
  }
}

export function useVoiceRoom(displayName: string) {
  const [joined, setJoined] = useState(false)
  const [peerIds, setPeerIds] = useState<string[]>([])
  const [muted, setMuted] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [screens, setScreens] = useState<Record<string, MediaStream>>({})
  const [chat, setChat] = useState<ChatMsg[]>([])
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [volumes, setVolumes] = useState<Record<string, number>>({})
  const [names, setNames] = useState<Record<string, string>>({})

  const socketRef = useRef<Socket | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const qualityRef = useRef<ShareQuality>('hd60')
  const peersRef = useRef<Map<string, Peer>>(new Map())
  const audioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map())
  const micRef = useRef<Mic | null>(null)
  const urlsRef = useRef<Map<string, string>>(new Map())
  const nameRef = useRef(displayName)
  nameRef.current = displayName
  const volumeCtxRef = useRef<AudioContext | null>(null)
  const gainsRef = useRef<Map<string, GainNode>>(new Map())
  const boostRef = useRef(1)

  function send(to: string, data: Signal) {
    socketRef.current?.emit('signal', { to, data })
  }

  // ---------- chat and file helpers ----------

  function addChat(msg: ChatMsg) {
    setChat((c) => [...c.slice(-199), msg]) // keep the last 200 messages only
  }

  function addTransfer(t: Transfer) {
    setTransfers((list) => [...list, t])
  }

  function updateTransfer(key: string, patch: Partial<Transfer>) {
    setTransfers((list) => list.map((t) => (t.key === key ? { ...t, ...patch } : t)))
  }

  function setupChannels(peer: Peer, peerId: string) {
    // "negotiated" channels with fixed ids: both sides create them, no extra signaling
    const chatCh = peer.pc.createDataChannel('chat', { negotiated: true, id: 0 })
    const filesCh = peer.pc.createDataChannel('files', { negotiated: true, id: 1 })
    filesCh.binaryType = 'arraybuffer'
    filesCh.bufferedAmountLowThreshold = 1_000_000
    peer.chat = chatCh
    peer.files = filesCh

    chatCh.onopen = () =>
      chatCh.send(JSON.stringify({ t: 'hello', name: cleanName(nameRef.current) }))

    chatCh.onmessage = (e) => {
      if (typeof e.data !== 'string') return
      try {
        const m = JSON.parse(e.data)
        if (m.t === 'hello') {
          peer.name = cleanName(m.name)
          setNames((n) => ({ ...n, [peerId]: peer.name! }))
        } else if (typeof m.text === 'string') {
          addChat({
            key: newKey(),
            from: cleanName(m.name),
            text: m.text.slice(0, MAX_TEXT),
            self: false
          })
        }
      } catch {
        /* ignore malformed messages */
      }
    }

    filesCh.onmessage = (e) => handleFileMessage(peer, e.data)
  }

  function handleFileMessage(peer: Peer, data: string | ArrayBuffer) {
    if (typeof data === 'string') {
      let m: { t?: string; name?: unknown; size?: unknown; from?: unknown }
      try {
        m = JSON.parse(data)
      } catch {
        return
      }

      if (m.t === 'meta') {
        const size = Number(m.size)
        const ok = Number.isFinite(size) && size > 0 && size <= MAX_FILE
        const key = newKey()
        peer.incoming = { key, size, received: 0, chunks: [], lastStep: 0, skip: !ok }
        if (ok) {
          addTransfer({
            key,
            who: cleanName(m.from),
            fileName: safeFileName(String(m.name ?? '')),
            size,
            progress: 0,
            direction: 'in',
            done: false
          })
        }
      } else if (m.t === 'end') {
        const inc = peer.incoming
        peer.incoming = undefined
        if (!inc || inc.skip) return
        if (inc.received !== inc.size) {
          updateTransfer(inc.key, { failed: true })
          return
        }
        // Never trust the sender's MIME type
        const url = URL.createObjectURL(new Blob(inc.chunks, { type: 'application/octet-stream' }))
        urlsRef.current.set(inc.key, url)
        updateTransfer(inc.key, { progress: 1, done: true, url })
      }
      return
    }

    // Binary chunk
    const inc = peer.incoming
    if (!inc || inc.skip) return
    inc.received += data.byteLength
    if (inc.received > inc.size) {
      // sender is sending more than it announced: abort
      inc.skip = true
      inc.chunks = []
      updateTransfer(inc.key, { failed: true })
      return
    }
    inc.chunks.push(data)
    const step = Math.floor((inc.received / inc.size) * 50) // update the UI every 2%
    if (step !== inc.lastStep) {
      inc.lastStep = step
      updateTransfer(inc.key, { progress: inc.received / inc.size })
    }
  }

  async function sendToPeer(peer: Peer, peerId: string, file: File, name: string) {
    const ch = peer.files
    if (!ch) return
    const key = newKey()
    addTransfer({
      key,
      who: peer.name ?? peerId.slice(0, 4),
      fileName: name,
      size: file.size,
      progress: 0,
      direction: 'out',
      done: false
    })
    try {
      ch.send(
        JSON.stringify({ t: 'meta', name, size: file.size, from: cleanName(nameRef.current) })
      )
      let offset = 0
      let lastStep = 0
      while (offset < file.size) {
        if (ch.readyState !== 'open') throw new Error('channel closed')
        if (ch.bufferedAmount > MAX_BUFFER) await waitDrain(ch)
        const buf = await file.slice(offset, offset + CHUNK).arrayBuffer()
        ch.send(buf)
        offset += buf.byteLength
        const step = Math.floor((offset / file.size) * 50)
        if (step !== lastStep) {
          lastStep = step
          updateTransfer(key, { progress: offset / file.size })
        }
      }
      ch.send(JSON.stringify({ t: 'end' }))
      updateTransfer(key, { progress: 1, done: true })
    } catch {
      updateTransfer(key, { failed: true })
    }
  }

  function sendChat(text: string) {
    const clean = text.trim().slice(0, MAX_TEXT)
    if (!clean) return
    const name = cleanName(nameRef.current)
    const payload = JSON.stringify({ name, text: clean })
    peersRef.current.forEach((p) => {
      if (p.chat?.readyState === 'open') p.chat.send(payload)
    })
    addChat({ key: newKey(), from: name, text: clean, self: true })
  }

  function sendFile(file: File) {
    if (file.size === 0) throw new Error('The file is empty')
    if (file.size > MAX_FILE) throw new Error('File too large (limit is 100 MB)')
    const name = safeFileName(file.name)
    let count = 0
    peersRef.current.forEach((peer, peerId) => {
      if (peer.files?.readyState !== 'open') return
      count++
      // One file at a time per peer, so chunks never interleave
      peer.sendChain = peer.sendChain.then(() => sendToPeer(peer, peerId, file, name))
    })
    if (count === 0) throw new Error('No one else is connected')
  }

  function dismissTransfer(key: string) {
    const url = urlsRef.current.get(key)
    if (url) URL.revokeObjectURL(url)
    urlsRef.current.delete(key)
    setTransfers((list) => list.filter((t) => t.key !== key))
  }

  // ---------- screen sharing ----------

  function attachScreen(peer: Peer) {
    const stream = screenStreamRef.current
    if (!stream) return
    const track = stream.getVideoTracks()[0]
    const preset = PRESETS[qualityRef.current]

    const sender = peer.pc.addTrack(track, stream)
    peer.screenSender = sender

    // Prefer H.264 so the GPU can encode (must be set before negotiation)
    try {
      const transceiver = peer.pc.getTransceivers().find((t) => t.sender === sender)
      const codecs = RTCRtpSender.getCapabilities('video')?.codecs ?? []
      const rank = (c: RTCRtpCodec): number =>
        c.mimeType === 'video/H264' ? 0 : c.mimeType === 'video/VP9' ? 1 : 2
      transceiver?.setCodecPreferences([...codecs].sort((a, b) => rank(a) - rank(b)))
    } catch {
      /* not critical */
    }

    try {
      const params = sender.getParameters()
      if (!params.encodings?.length) params.encodings = [{}]
      params.encodings[0].maxBitrate = preset.bitrate
      params.encodings[0].maxFramerate = preset.fps
      sender.setParameters(params).catch(() => {})
    } catch {
      /* not critical */
    }
  }

  // ---------- peers ----------

  function createPeer(peerId: string): Peer {
    const myId = socketRef.current!.id!
    const peer: Peer = {
      pc: new RTCPeerConnection(RTC_CONFIG),
      polite: myId < peerId,
      makingOffer: false,
      ignoreOffer: false,
      sendChain: Promise.resolve()
    }
    const { pc } = peer

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true
        await pc.setLocalDescription()
        send(peerId, { description: pc.localDescription! })
      } catch (e) {
        console.error('negotiation failed', e)
      } finally {
        peer.makingOffer = false
      }
    }

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) send(peerId, { candidate: candidate.toJSON() })
    }

    pc.ontrack = (e) => {
      const stream = e.streams[0]
      if (e.track.kind === 'audio') {
        // Muted element: Chromium needs it attached, or WebRTC audio stays silent in Web Audio
        let audio = audioElsRef.current.get(peerId)
        if (!audio) {
          audio = new Audio()
          audio.muted = true
          audioElsRef.current.set(peerId, audio)
        }
        audio.srcObject = stream
        audio.play().catch(() => {})

        let ctx = volumeCtxRef.current
        if (!ctx) {
          ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive'})
          volumeCtxRef.current = ctx
        }
        ctx.resume().catch(() => {})

        const previous = gainsRef.current.get(peerId)
        const level = previous ? previous.gain.value : 1
        previous?.disconnect()

        const gain = ctx.createGain()
        gain.gain.value = level
        ctx.createMediaStreamSource(stream).connect(gain)
        gain.connect(ctx.destination)
        gainsRef.current.set(peerId, gain)
        setVolumes((v) => ({ ...v, [peerId]: Math.round(level * 100) }))
      } else {
        setScreens((s) => ({ ...s, [peerId]: stream }))
        stream.onremovetrack = () =>
          setScreens((s) => {
            const next = { ...s }
            delete next[peerId]
            return next
          })
      }
    }

    peersRef.current.set(peerId, peer)
    setPeerIds([...peersRef.current.keys()])

    // Data channels first, then tracks
    setupChannels(peer, peerId)
    const micTrack = localStreamRef.current?.getAudioTracks()[0]
    if (micTrack) peer.micSender = pc.addTrack(micTrack, localStreamRef.current!)
    attachScreen(peer)

    return peer
  }

  function removePeer(peerId: string) {
    const peer = peersRef.current.get(peerId)
    if (peer?.incoming && !peer.incoming.skip) updateTransfer(peer.incoming.key, { failed: true })
    peer?.pc.close()
    peersRef.current.delete(peerId)
    const audio = audioElsRef.current.get(peerId)
    if (audio) audio.srcObject = null
    audioElsRef.current.delete(peerId)
    gainsRef.current.get(peerId)?.disconnect()
    gainsRef.current.delete(peerId)
    setVolumes((v) => {
      const next = { ...v }
      delete next[peerId]
      return next
    })
    setScreens((s) => {
      const next = { ...s }
      delete next[peerId]
      return next
    })
    setPeerIds([...peersRef.current.keys()])
  }

  async function join(serverUrl: string, micDeviceId: string, noise: NoiseMode) {
    const mic = await openMic(micDeviceId, noise, boostRef.current)
    micRef.current = mic
    localStreamRef.current = mic.stream

    const socket = io(serverUrl)
    socketRef.current = socket

    socket.on('peers', (existing: string[]) => existing.forEach((id) => createPeer(id)))
    socket.on('peer-joined', () => {})

    socket.on('signal', async ({ from, data }: { from: string; data: Signal }) => {
      const peer = peersRef.current.get(from) ?? createPeer(from)
      const { pc } = peer
      try {
        if ('description' in data) {
          const collision =
            data.description.type === 'offer' &&
            (peer.makingOffer || pc.signalingState !== 'stable')
          peer.ignoreOffer = !peer.polite && collision
          if (peer.ignoreOffer) return

          await pc.setRemoteDescription(data.description)
          if (data.description.type === 'offer') {
            await pc.setLocalDescription()
            send(from, { description: pc.localDescription! })
          }
        } else if (data.candidate) {
          try {
            await pc.addIceCandidate(data.candidate)
          } catch (e) {
            if (!peer.ignoreOffer) throw e
          }
        }
      } catch (e) {
        console.error('signal handling failed', e)
      }
    })

    socket.on('peer-left', (peerId: string) => removePeer(peerId))

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Server did not answer')), 8000)
        socket.once('connect', () => {
          clearTimeout(timer)
          resolve()
        })
        socket.once('connect_error', (err) => {
          clearTimeout(timer)
          reject(err)
        })
      })
    } catch (e) {
      leave() // releases the mic and closes the socket
      throw e
    }

    socket.emit('join', ROOM)
    setJoined(true)
  }

  async function startShare(sourceId: string, quality: ShareQuality) {
    qualityRef.current = quality
    const p = PRESETS[quality]

    await window.api.selectScreenSource(sourceId)
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: p.width },
        height: { ideal: p.height },
        frameRate: { ideal: p.fps }
      },
      audio: false
    })

    const track = stream.getVideoTracks()[0]
    track.contentHint = 'motion'
    track.onended = () => stopShare()

    screenStreamRef.current = stream
    peersRef.current.forEach((peer) => attachScreen(peer))
    setSharing(true)
  }

  function stopShare() {
    screenStreamRef.current?.getTracks().forEach((t) => t.stop())
    screenStreamRef.current = null
    peersRef.current.forEach((peer) => {
      if (peer.screenSender) {
        peer.pc.removeTrack(peer.screenSender)
        peer.screenSender = undefined
      }
    })
    setSharing(false)
  }

  function leave() {
    stopShare()
    peersRef.current.forEach((_, id) => removePeer(id))
    localStreamRef.current?.getTracks().forEach((t) => t.stop())
    localStreamRef.current = null
    micRef.current?.cleanup
    micRef.current = null
    socketRef.current?.disconnect()
    socketRef.current = null
    volumeCtxRef.current?.close().catch(() => {})
    volumeCtxRef.current = null
    gainsRef.current.clear()
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    urlsRef.current.clear()
    setChat([])
    setTransfers([])
    setJoined(false)
    setMuted(false)
  }

  function setMicBoost(percent: number) {
    boostRef.current = percent / 100
    micRef.current?.setGain(boostRef.current)
  }

  function toggleMute() {
    const track = localStreamRef.current?.getAudioTracks()[0]
    if (!track) return
    track.enabled = !track.enabled
    setMuted(!track.enabled)
  }

  function setVolume(peerId: string, percent: number) {
    const gain = gainsRef.current.get(peerId)
    if (gain) gain.gain.value = percent / 100
    setVolumes((v) => ({ ...v, [peerId]: percent }))
  }

  // Switch microphone or noise mode during a call, without renegotiating
  async function changeMic(micDeviceId: string, noise: NoiseMode) {
    const next = await openMic(micDeviceId, noise, boostRef.current)
    const track = next.stream.getAudioTracks()[0]
    track.enabled = localStreamRef.current?.getAudioTracks()[0]?.enabled ?? true // Keep mute state
    await Promise.all([...peersRef.current.values()].map((p) => p.micSender?.replaceTrack(track)))
    const old = micRef.current
    micRef.current = next
    localStreamRef.current = next.stream
    old?.cleanup
  }

  useEffect(() => leave, [])

  return {
    joined,
    peerIds,
    muted,
    sharing,
    screens,
    chat,
    transfers,
    volumes,
    names,
    join,
    leave,
    toggleMute,
    changeMic,
    startShare,
    stopShare,
    sendChat,
    sendFile,
    dismissTransfer,
    setVolume,
    setMicBoost
  }
}
