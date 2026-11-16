import { useState } from 'react'
import { IconScreenShare } from '@tabler/icons-react'
import Avatar from './Avatar'

type Props = {
  hosting: boolean
  server: string
  myName: string
  peerIds: string[]
  avatar: string
  avatars: Record<string, string>
  names: Record<string, string>
  volumes: Record<string, number>
  sharing: string[]
  onVolume: (id: string, percent: number) => void
}

export default function Sidebar({
  hosting,
  server,
  myName,
  avatar,
  avatars,
  peerIds,
  names,
  volumes,
  sharing,
  onVolume
}: Props) {
  const [open, setOpen] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  function copyAddress() {
    navigator.clipboard.writeText(server)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <aside className="side">
      <div
        className={'srv' + (hosting ? ' copy' : '')}
        title={hosting ? 'Click to copy the address' : server}
        onClick={hosting ? copyAddress : undefined}
      >
        <span className="dot" />
        <span>{copied ? 'Address copied ✓' : server.replace(/^https?:\/\//, '')}</span>
      </div>
      {hosting && <div className="sm" style={{ padding: '0 6px 8px' }}>Click the address to copy it</div>}
      <div className="lbl">In voice, {peerIds.length + 1}</div>

      <div className="mem">
        <Avatar name={myName} src={avatar} />
        <span className="nm">{myName} (you)</span>
      </div>

      {peerIds.map((id) => {
        const name = names[id] ?? 'Connecting…'
        const vol = volumes[id] ?? 100
        return (
          <div key={id}>
            <div className="mem click" onClick={() => setOpen(open === id ? null : id)}>
              <Avatar name={name} src={avatars[id]} />
              <span className="nm">{name}</span>
              {sharing.includes(id) && <IconScreenShare size={14} />}
            </div>
            {open === id && (
              <div className="vol">
                <input
                  type="range"
                  min={0}
                  max={300}
                  step={5}
                  value={vol}
                  onChange={(e) => onVolume(id, Number(e.target.value))}
                />
                <span style={{ minWidth: 34 }}>{vol}%</span>
              </div>
            )}
          </div>
        )
      })}
    </aside>
  )
}