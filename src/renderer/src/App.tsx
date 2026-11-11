import { ChangeEvent, useEffect, useRef, useState } from 'react'
import { useVoiceRoom, PRESETS, ShareQuality, NoiseMode } from './useVoiceRoom'

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

function loadPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem('minidisc:' + key) ?? fallback
  } catch {
    return fallback
  }
}

function savePref(key: string, value: string): void {
  try {
    localStorage.setItem('minidisc:' + key, value)
  } catch {
    /* not critical */
  }
}

function normalizeServerUrl(input: string): string | null {
  let value = input.trim()
  if (!value) return null
  if (!/^https?:\/\//i.test(value)) {
    const local = /^(localhost|\d{1,3}(\.\d{1,3}){3})(:|\/|$)/.test(value)
    value = (local ? 'http://' : 'https://') + value
  }
  try {
    return new URL(value).origin
  } catch {
    return null
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
  const [serverUrl, setServerUrl] = useState(
    loadPref('serverUrl', import.meta.env.VITE_SERVER_URL ?? '')
  )
  const [name, setName] = useState(loadName())
  const [error, setError] = useState('')
  const [sources, setSources] = useState<Source[] | null>(null)
  const [quality, setQuality] = useState<ShareQuality>('hd60')
  const [draft, setDraft] = useState('')
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [boost, setBoost] = useState(Number(loadPref('boost', '100')))
  const [micId, setMicId] = useState(loadPref('micId', ''))
  const [noise, setNoise] = useState<NoiseMode>(loadPref('noise', 'standard') as NoiseMode)
  const v = useVoiceRoom(name)

  const fileInput = useRef<HTMLInputElement>(null)
  const chatEnd = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatEnd.current?.scrollIntoView()
  }, [v.chat.length])

  useEffect(() => {
    const load = async (): Promise<void> => {
      const all = await navigator.mediaDevices.enumerateDevices()
      setMics(all.filter((d) => d.kind === 'audioinput'))
    }
    load()
    navigator.mediaDevices.addEventListener('devicechange', load)
    return () => navigator.mediaDevices.removeEventListener('devicechange', load)
  }, [v.joined])

  function changeName(n: string) {
    setName(n)
    try {
      localStorage.setItem('minidisc:name', n)
    } catch {
      /* not critical */
    }
  }

  async function handleJoin() {
    const url = normalizeServerUrl(serverUrl)
    if (!url) return setError('Type the server address first')
      try {
        setError('')
        savePref('serverUrl', url)
        setServerUrl(url)
        v.setMicBoost(boost)
        await v.join(url, micId, noise)
    } catch (e) {
      setError('Could not connect: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  async function applyMic(nextId: string, nextNoise: NoiseMode) {
    setMicId(nextId)
    setNoise(nextNoise)
    savePref('micId', nextId)
    savePref('noise', nextNoise)
    if (!v.joined) return
    try {
      setError('')
      await v.changeMic(nextId, nextNoise)
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

      <div style={{ marginBottom: 12}}>
        <label>Microphone </label>
        <select value={micId} onChange={(e) => applyMic(e.target.value, noise)}>
          <option value="">System default</option>
          {mics.map((m,i) => (
            <option key={m.deviceId} value={m.deviceId}>
              {m.label || `Microphone ${i + 1}`}
            </option>
          ))}
        </select>{' '}
        <label>Noise </label>
        <select value={noise} onChange={(e) => applyMic(micId, e.target.value as NoiseMode)}>
          <option value="off">Off</option>
          <option value="standard">Standard</option>
          <option value="strong">Strong (RNNoise)</option>
        </select>
        {' '}
        <label>Mic boost </label>
        <input
          type='range'
          min={100}
          max={400}
          step={10}
          value={boost}
          onChange={(e) => {
            const n = Number(e.target.value)
            setBoost(n)
            savePref('boost', String(n))
            v.setMicBoost(n)
          }}
        />{' '}
        {boost}%
      </div>

      {!v.joined ? (
        <>
          <div style={{ marginBottom: 8 }}>
            <label>Your name </label>
            <input value={name} maxLength={32} onChange={(e) => changeName(e.target.value)} />
          </div>
          <div style={{ marginBottom: 8 }}>
            <label>Server Address </label>
            <input
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder='https://something.trycloudflare.com'
              style={{ width: 340}}/>
          </div>
          <button onClick={handleJoin}>Join voice</button>
        </>
      ) : (
        <>
          <p>
            Connected with {v.peerIds.length} other(s)
          </p>
          <button onClick={v.toggleMute}>{v.muted ? 'Unmute' : 'Mute'}</button>
          {v.sharing ? (
            <button onClick={v.stopShare}>Stop sharing</button>
          ) : (
            <button onClick={openPicker}>Share screen</button>
          )}
          <button onClick={v.leave}>Leave</button>
          {v.peerIds.map((id) => (
            <div key={id} style={{ marginTop: 6 }}>
              <span style={{ display: 'inline-block', width: 140 }}>
                {v.names[id] ?? id.slice(0, 4)}
              </span>
              <input
              type="range"
              min={0}
              max={300}
              step={5}
              value={v.volumes[id] ?? 100}
              onChange={(e) => v.setVolume(id, Number(e.target.value))}
              />{' '}
              {v.volumes[id] ?? 100}%
            </div>
          ))}
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
