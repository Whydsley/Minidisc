import { useState } from 'react'
import { useVoiceRoom, PRESETS, ShareQuality } from './useVoiceRoom'

type Source = { id: string; name: string; thumbnail: string }

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
  const [error, setError] = useState('')
  const [sources, setSources] = useState<Source[] | null>(null)
  const [quality, setQuality] = useState<ShareQuality>('hd60')
  const v = useVoiceRoom()

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

  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>Minidisc</h1>

      {!v.joined ? (
        <>
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

      {Object.entries(v.screens).map(([id, stream]) => (
        <RemoteScreen key={id} stream={stream} />
      ))}
    </div>
  )
}