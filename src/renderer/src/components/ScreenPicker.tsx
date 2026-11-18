import { useEffect, useState } from 'react'
import { PRESETS, type ShareQuality } from '../useVoiceRoom'

type Source = { id: string; name: string; thumbnail: string }
type Props = { onPick: (id: string, quality: ShareQuality, withAudio: boolean) => void; onClose: () => void }

export default function ScreenPicker({ onPick, onClose }: Props) {
  const [sources, setSources] = useState<Source[]>([])
  const [quality, setQuality] = useState<ShareQuality>('hd60')
  const [withAudio, setWithAudio] = useState(true)

  useEffect(() => {
    window.api.getScreenSources().then(setSources)
  }, [])

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Choose what to share</h3>
        <select value={quality} onChange={(e) => setQuality(e.target.value as ShareQuality)}>
          {Object.entries(PRESETS).map(([key, p]) => (
            <option key={key} value={key}>{p.label}</option>
          ))}
        </select>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={withAudio}
            onChange={(e) => setWithAudio(e.target.checked)}
            style={{ width: 'auto' }}
          />
          Share system sound
        </label>
        <div className="sources">
          {sources.map((s) => (
            <button key={s.id} onClick={() => onPick(s.id, quality, withAudio)}>
              <img src={s.thumbnail} />
              {s.name}
            </button>
          ))}
        </div>
        <button onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}