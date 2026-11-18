import { createServer, type Server as HttpServer } from 'http'
import type { AddressInfo } from 'net'
import { spawn, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { Server } from 'socket.io'
import { writeLog } from './logger'

let httpServer: HttpServer | null = null
let io: Server | null = null
let tunnel: ChildProcess | null = null

export type HostInfo = { localUrl: string; publicUrl: string }

function cloudflaredPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'cloudflared.exe')
    : join(app.getAppPath(), 'bin', 'cloudflared.exe')
}

export async function stopHost(): Promise<void> {
  tunnel?.kill()
  tunnel = null
  io?.close() // also closes the HTTP server
  io = null
  httpServer = null
}

export async function startHost(): Promise<HostInfo> {
  if (httpServer) await stopHost()

  const exe = cloudflaredPath()
  if (!existsSync(exe)) throw new Error('cloudflared.exe not found in the bin folder')

  const http = createServer()
  const server = new Server(http, { cors: { origin: '*' }, maxHttpBufferSize: 1e6 })
  httpServer = http
  io = server

  server.on('connection', (socket) => {
    writeLog('server', `connected ${socket.id}`)
    socket.on('join', (roomId: unknown) => {
      if (typeof roomId !== 'string' || roomId.length > 64) return
      const room = server.sockets.adapter.rooms.get(roomId)
      const existing = room ? [...room] : []
      socket.join(roomId)
      socket.data.roomId = roomId
      socket.emit('peers', existing)
      socket.to(roomId).emit('peer-joined', socket.id)
    })

    // Relay only between people in the same room
    socket.on('signal', (msg: { to?: unknown; data?: unknown }) => {
      if (typeof msg?.to !== 'string') return
      const target = server.sockets.sockets.get(msg.to)
      if (!target || target.data.roomId !== socket.data.roomId) return
      target.emit('signal', { from: socket.id, data: msg.data })
    })

    socket.on('disconnect', (reason) => {
      writeLog('server', `disconnected ${socket.id}: ${reason}`)
      const roomId = socket.data.roomId as string | undefined
      if (roomId) socket.to(roomId).emit('peer-left', socket.id)
    })
  })

  // Listen on this PC only; the tunnel is the way in from outside
  const port = await new Promise<number>((resolve, reject) => {
    http.once('error', reject)
    http.listen(0, '127.0.0.1', () => resolve((http.address() as AddressInfo).port))
  })

  try {
    const publicUrl = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        exe,
          ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate', '--protocol', 'http2'],
        { windowsHide: true }
      )
      tunnel = child
      let url = ''
      let registered = false
      const timer = setTimeout(() => reject(new Error('The tunnel did not start in time')), 30000)

      const onData = (buf: Buffer): void => {
        const text = buf.toString()
        writeLog('tunnel', text.trim())
        const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)
        if (m) url = m[0]
        if (/Registered tunnel connection/i.test(text)) registered = true
        // Wait until the tunnel is really connected, not only named
        if (url && registered) {
          clearTimeout(timer)
          resolve(url)
        }
      }
      child.stdout?.on('data', onData)
      child.stderr?.on('data', onData)
      child.once('error', (e) => {
        clearTimeout(timer)
        reject(e)
      })
      child.once('exit', (code) => {
        writeLog('tunnel', `cloudflared exited, code ${code}`)
        clearTimeout(timer)
        reject(new Error('The tunnel stopped'))
      })
    })
    return { localUrl: `http://127.0.0.1:${port}`, publicUrl }
  } catch (e) {
    await stopHost()
    throw e
  }
}