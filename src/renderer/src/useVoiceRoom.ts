import { useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'

const SERVER_URL = 'http://localhost:3001'

// Free public STUN server. We'll add our own TURN server later.
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
}

type Signal =
  | { type: 'offer'; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; sdp: RTCSessionDescriptionInit }
  | { type: 'ice'; candidate: RTCIceCandidateInit }

export function useVoiceRoom() {
  const [joined, setJoined] = useState(false)
  const [peerIds, setPeerIds] = useState<string[]>([])
  const [muted, setMuted] = useState(false)

  const socketRef = useRef<Socket | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const audioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map())

  function createPeer(peerId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection(RTC_CONFIG)

    // Send our microphone to this peer
    localStreamRef.current?.getTracks().forEach((track) => {
      pc.addTrack(track, localStreamRef.current!)
    })

    // Send our network candidates through the server
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        const data: Signal = { type: 'ice', candidate: e.candidate.toJSON() }
        socketRef.current?.emit('signal', { to: peerId, data })
      }
    }

    // Play the remote audio when it arrives
    pc.ontrack = (e) => {
      let audio = audioElsRef.current.get(peerId)
      if (!audio) {
        audio = new Audio()
        audio.autoplay = true
        audioElsRef.current.set(peerId, audio)
      }
      audio.srcObject = e.streams[0]
    }

    peersRef.current.set(peerId, pc)
    setPeerIds([...peersRef.current.keys()])
    return pc
  }

  function removePeer(peerId: string) {
    peersRef.current.get(peerId)?.close()
    peersRef.current.delete(peerId)
    const audio = audioElsRef.current.get(peerId)
    if (audio) audio.srcObject = null
    audioElsRef.current.delete(peerId)
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

    // We are the newcomer: call everyone already in the room
    socket.on('peers', async (existing: string[]) => {
      for (const peerId of existing) {
        const pc = createPeer(peerId)
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        const data: Signal = { type: 'offer', sdp: offer }
        socket.emit('signal', { to: peerId, data })
      }
    })

    // Someone else arrived: they will call us, so we just wait
    socket.on('peer-joined', () => {})

    socket.on('signal', async ({ from, data }: { from: string; data: Signal }) => {
      let pc = peersRef.current.get(from)

      if (data.type === 'offer') {
        pc = pc ?? createPeer(from)
        await pc.setRemoteDescription(data.sdp)
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        const reply: Signal = { type: 'answer', sdp: answer }
        socket.emit('signal', { to: from, data: reply })
      } else if (data.type === 'answer') {
        await pc?.setRemoteDescription(data.sdp)
      } else if (data.type === 'ice') {
        await pc?.addIceCandidate(data.candidate)
      }
    })

    socket.on('peer-left', (peerId: string) => removePeer(peerId))

    socket.emit('join', roomId)
    setJoined(true)
  }

  function leave() {
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

  return { joined, peerIds, muted, join, leave, toggleMute }
}
