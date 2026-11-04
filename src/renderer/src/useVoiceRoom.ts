import { useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001'

// Free public STUN server. We'll add our own TURN server later.
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
}

type Signal = { description: RTCSessionDescriptionInit } | { candidate: RTCIceCandidateInit }

type Peer = {
  pc: RTCPeerConnection
  polite: boolean // the polite side yields when both send offers at once
  makingOffer: boolean
  ignoreOffer: boolean
  screenSender?: RTCRtpSender
}

export type ShareQuality = 'hd60' | 'qhd60'

export const PRESETS: Record<
  ShareQuality,
  { label: string; width: number; height: number; fps: number; bitrate: number }
> = {
  hd60: { label: '1080p 60 fps', width: 1920, height: 1080, fps: 60, bitrate: 8_000_000 },
  qhd60: { label: '1440p 60 fps', width: 2560, height: 1440, fps: 60, bitrate: 16_000_000 }
}

export function useVoiceRoom() {
  const [joined, setJoined] = useState(false)
  const [peerIds, setPeerIds] = useState<string[]>([])
  const [muted, setMuted] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [screens, setScreens] = useState<Record<string, MediaStream>>({})

  const socketRef = useRef<Socket | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const qualityRef = useRef<ShareQuality>('hd60')
  const peersRef = useRef<Map<string, Peer>>(new Map())
  const audioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map())

  function send(to: string, data: Signal) {
    socketRef.current?.emit('signal', { to, data })
  }

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

    // Bitrate and frame rate ceilings
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

  function createPeer(peerId: string): Peer {
    const myId = socketRef.current!.id!
    const peer: Peer = {
      pc: new RTCPeerConnection(RTC_CONFIG),
      polite: myId < peerId,
      makingOffer: false,
      ignoreOffer: false
    }
    const { pc } = peer

    // Handlers first, then tracks, so no event is missed
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

    // Send our microphone (this triggers the first negotiation)
    localStreamRef.current?.getTracks().forEach((t) => pc.addTrack(t, localStreamRef.current!))
    // If we are already sharing, newcomers get the screen too
    attachScreen(peer)

    return peer
  }

  function removePeer(peerId: string) {
    peersRef.current.get(peerId)?.pc.close()
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
    // 1. Capture the microphone
    localStreamRef.current = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false
    })

    // 2. Connect to the signaling server
    const socket = io(SERVER_URL)
    socketRef.current = socket
    socket.on('connect_error', (err) => alert('Connection failed: ' + err.message))

    // Newcomer: just create the peers. Adding tracks triggers the offers.
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
    track.contentHint = 'motion' // keeps 60 fps when the network is tight
    track.onended = () => stopShare() // the user closed the shared window

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
    setJoined(false)
    setMuted(false)
  }

  function toggleMute() {
    const track = localStreamRef.current?.getAudioTracks()[0]
    if (!track) return
    track.enabled = !track.enabled
    setMuted(!track.enabled)
  }

  // Clean up if the component unmounts
  useEffect(() => leave, [])

  return { joined, peerIds, muted, sharing, screens, join, leave, toggleMute, startShare, stopShare }
}