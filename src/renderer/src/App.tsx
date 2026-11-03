import { useState } from 'react'
import { useVoiceRoom } from './useVoiceRoom'

export default function App() {
  const [room, setRoom] = useState('general')
  const { joined, peerIds, muted, join, leave, toggleMute } = useVoiceRoom()

  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>Minidisc</h1>

      {!joined ? (
        <>
          <input value={room} onChange={(e) => setRoom(e.target.value)} />
          <button onClick={() => join(room)}>Join voice</button>
        </>
      ) : (
        <>
          <p>
            In room <b>{room}</b> with {peerIds.length} other(s)
          </p>
          <button onClick={toggleMute}>{muted ? 'Unmute' : 'Mute'}</button>
          <button onClick={leave}>Leave</button>
        </>
      )}
    </div>
  )
}
