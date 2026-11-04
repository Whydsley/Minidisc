import { useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001'

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

export function useVoiceRoom(displayName: string) {
  const [joined, setJoined] = useState(false)
  const [peerIds, setPeerIds] = useState<string[]>([])
  const [muted, setMuted] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [screens, setScreens] = useState<Record<string, MediaStream>>({})
  const [chat, setChat] = useState<ChatMsg[]>([])
  const [transfers, setTransfers] = useState<Transfer[]>([])

  const socketRef = useRef<Socket | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const qualityRef = useRef<ShareQuality>('hd60')
  const peersRef = useRef<Map<string, Peer>>(new Map())
  const audioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map())
  const urlsRef = useRef<Map<string, string>>(new Map())
  const nameRef = useRef(displayName)
  nameRef.current = displayName

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

  function setupChannels(peer: Peer) {
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
        let audio = audioElsRef.current.get(peerId)
        if (!audio) {
          audio = new Audio()
          audio.autoplay = true
          audioElsRef.current.set(peerId, audio)
        }
        audio.srcObject = stream
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
    setupChannels(peer)
    localStreamRef.current?.getTracks().forEach((t) => pc.addTrack(t, localStreamRef.current!))
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
    setScreens((s) => {
      const next = { ...s }
      delete next[peerId]
      return next
    })
    setPeerIds([...peersRef.current.keys()])
  }

  async function join(roomId: string) {
    localStreamRef.current = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false
    })

    const socket = io(SERVER_URL)
    socketRef.current = socket
    socket.on('connect_error', (err) => alert('Connection failed: ' + err.message))

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

    socket.emit('join', roomId)
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
    socketRef.current?.disconnect()
    socketRef.current = null
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    urlsRef.current.clear()
    setChat([])
    setTransfers([])
    setJoined(false)
    setMuted(false)
  }

  function toggleMute() {
    const track = localStreamRef.current?.getAudioTracks()[0]
    if (!track) return
    track.enabled = !track.enabled
    setMuted(!track.enabled)
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
    join,
    leave,
    toggleMute,
    startShare,
    stopShare,
    sendChat,
    sendFile,
    dismissTransfer
  }
}
