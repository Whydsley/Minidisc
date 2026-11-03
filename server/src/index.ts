import { Server } from 'socket.io'

const PORT = 3001

//Note: allow any origin. We'll restrict this before deploying.

const io = new Server(PORT, { cors: { origin: '*' } })

type SignalPayload = { to: string; data: unknown }

io.on('connection', (socket) => {
  console.log('Connected:', socket.id)

  //A user joins a room (Voice Channel)
  socket.on('join', (roomId: string) => {
    const room = io.sockets.adapter.rooms.get(roomId)
    const existingPeers = room ? [...room] : []

    socket.join(roomId)
    socket.data.roomId = roomId

    // Tell the newcomer who is already in the room
    socket.emit('peers', existingPeers)
    // Tell everyone else that somene arrived
    socket.to(roomId).emit('peer-joined', socket.id)
  })

  // Relay WebRTC offers, answers and ICE candidates to one specific peer
  socket.on('signal', ({ to, data }: SignalPayload) => {
    io.to(to).emit('signal', { from: socket.id, data })
  })

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId as string | undefined
    if (roomId) socket.to(roomId).emit('peer-left', socket.id)
    console.log('disconnected:', socket.id)
  })
})

console.log(`Signaling server running on port ${PORT}`)
