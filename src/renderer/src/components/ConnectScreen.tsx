import { useRef } from 'react'
import Avatar from './Avatar'

type Props = {
  onHost: () => void
  serverUrl: string
  onServerUrl: (v: string) => void
  avatar: string
  onAvatar: (file: File | null) => void
  name: string
  onName: (v: string) => void
  error: string
  busy: boolean
  onJoin: () => void
  onSettings: () => void
}

export default function ConnectScreen(p: Props) {
  const fileInput = useRef<HTMLInputElement>(null)
  return (
    <div className="connect">
      <div className="card">
        <h1>Minidisc</h1>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <div style={{ cursor: 'pointer' }} onClick={() => fileInput.current?.click()}>
            <Avatar name={p.name} src={p.avatar} size={56} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <button onClick={() => fileInput.current?.click()}>Choose picture</button>
            {p.avatar && (
              <button className="link" style={{ margin: 0 }} onClick={() => p.onAvatar(null)}>
                Remove
              </button>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              p.onAvatar(e.target.files?.[0] ?? null)
              e.target.value = ''
            }}
          />
        </div>
        <label>Server address</label>
        <input
          value={p.serverUrl}
          placeholder="https://something.trycloudflare.com"
          onChange={(e) => p.onServerUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && p.onJoin()}
        />
        <label>Your name</label>
        <input value={p.name} maxLength={32} onChange={(e) => p.onName(e.target.value)} />
        {p.error && <div className="err">{p.error}</div>}
        <button className="primary" disabled={p.busy} onClick={p.onJoin}>
          {p.busy ? 'Connecting…' : 'Join voice'}
        </button>
        <button disabled={p.busy} onClick={p.onHost}>
          Host a room
        </button>
        <div className="sm">Starts a server on this PC and gives you an address to share.</div>
        <button className="link" onClick={p.onSettings}>
          Audio settings
        </button>
      </div>
    </div>
  )
}