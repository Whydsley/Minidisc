import { ChangeEvent, useEffect, useRef, useState } from 'react'
import { useVoiceRoom, PRESETS, ShareQuality } from './useVoiceRoom'

type Source = { id: string; name: string; thumbnail: string }

const RISKY = /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|js|jar|lnk|dll|reg)$/i

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function loadName(): string {
  try {
    return localStorage.getItem('minidisc:name') ?? 'Guest'
  } catch {
    return 'Guest'
  }
}

function RemoteScreen({ stream }: { stream: MediaStream }) {
  return (
    <video
      autoPlay
      playsInline
      muted
      ref={(el) => {
        if (el && el.srcObject !== stream) el.srcObject = stream
      }}
      style={{ width: '100%', maxWidth: 960, background: '#000', marginTop: 16 }}
    />
  )
}

export default function App() {
  const [room, setRoom] = useState('general')
  const [name, setName] = useState(loadName())
  const [error, setError] = useState('')
  const [sources, setSources] = useState<Source[] | null>(null)
  const [quality, setQuality] = useState<ShareQuality>('hd60')
  const [draft, setDraft] = useState('')
  const v = useVoiceRoom(name)

  const fileInput = useRef<HTMLInputElement>(null)
  const chatEnd = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatEnd.current?.scrollIntoView()
  }, [v.chat.length])

  function changeName(n: string) {
    setName(n)
    try {
      localStorage.setItem('minidisc:name', n)
    } catch {
      /* not critical */
    }
  }

  async function handleJoin() {
    try {
      setError('')
      await v.join(room)
    } catch (e) {
      setError(String(e))
    }
  }

  async function openPicker() {
    setSources(await window.api.getScreenSources())
  }

  async function pick(id: string) {
    setSources(null)
    try {
      setError('')
      await v.startShare(id, quality)
    } catch (e) {
      setError(String(e))
    }
  }

  function submitChat() {
    v.sendChat(draft)
    setDraft('')
  }

  function handleFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // lets the user pick the same file again
    setError('')
    for (const f of files) {
      try {
        v.sendFile(f)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>Minidisc</h1>

      {!v.joined ? (
        <>
          <div style={{ marginBottom: 8 }}>
            <label>Your name </label>
            <input value={name} maxLength={32} onChange={(e) => changeName(e.target.value)} />
          </div>
          <input value={room} onChange={(e) => setRoom(e.target.value)} />
          <button onClick={handleJoin}>Join voice</button>
        </>
      ) : (
        <>
          <p>
            In room <b>{room}</b> with {v.peerIds.length} other(s)
          </p>
          <button onClick={v.toggleMute}>{v.muted ? 'Unmute' : 'Mute'}</button>
          {v.sharing ? (
            <button onClick={v.stopShare}>Stop sharing</button>
          ) : (
            <button onClick={openPicker}>Share screen</button>
          )}
          <button onClick={v.leave}>Leave</button>
        </>
      )}

      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      {sources && (
        <div style={{ marginTop: 16 }}>
          <h3>Choose what to share</h3>
          <select value={quality} onChange={(e) => setQuality(e.target.value as ShareQuality)}>
            {Object.entries(PRESETS).map(([key, p]) => (
              <option key={key} value={key}>
                {p.label}
              </option>
            ))}
          </select>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
            {sources.map((s) => (
              <button key={s.id} onClick={() => pick(s.id)} style={{ width: 200 }}>
                <img src={s.thumbnail} style={{ width: '100%' }} />
                <div style={{ fontSize: 12 }}>{s.name}</div>
              </button>
            ))}
          </div>
          <button onClick={() => setSources(null)}>Cancel</button>
        </div>
      )}

      {v.joined && (
        <div style={{ marginTop: 16, maxWidth: 560 }}>
          <div
            style={{
              height: 220,
              overflowY: 'auto',
              border: '1px solid #8886',
              borderRadius: 6,
              padding: 8
            }}
          >
            {v.chat.map((m) => (
              <div key={m.key} style={{ marginBottom: 6 }}>
                <b style={{ color: m.self ? '#2a7' : undefined }}>{m.from}</b>
                <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {': '}
                  {m.text}
                </span>
              </div>
            ))}
            <div ref={chatEnd} />
          </div>

          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <input
              style={{ flex: 1 }}
              value={draft}
              maxLength={2000}
              placeholder="Type a message"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitChat()
              }}
            />
            <button onClick={submitChat}>Send</button>
            <button onClick={() => fileInput.current?.click()}>Send file</button>
            <input ref={fileInput} type="file" multiple hidden onChange={handleFiles} />
          </div>

          {v.transfers.map((t) => (
            <div key={t.key} style={{ marginTop: 8, fontSize: 13 }}>
              {t.direction === 'in' ? '⬇' : '⬆'} <b>{t.fileName}</b> ({formatSize(t.size)}){' '}
              {t.direction === 'in' ? 'from' : 'to'} {t.who}
              {!t.done && !t.failed && (
                <progress value={t.progress} max={1} style={{ marginLeft: 8 }} />
              )}
              {t.failed && <span style={{ color: 'crimson' }}> failed</span>}
              {t.done && t.direction === 'out' && <span> sent ✔</span>}
              {t.done && t.url && (
                <>
                  {' '}
                  <a href={t.url} download={t.fileName}>
                    Save
                  </a>
                  {RISKY.test(t.fileName) && (
                    <span style={{ color: 'darkorange' }}>
                      {' '}
                      ⚠ executable file, only open it if you trust the sender
                    </span>
                  )}
                </>
              )}{' '}
              <button onClick={() => v.dismissTransfer(t.key)}>✕</button>
            </div>
          ))}
        </div>
      )}

      {Object.entries(v.screens).map(([id, stream]) => (
        <RemoteScreen key={id} stream={stream} />
      ))}
    </div>
  )
}
