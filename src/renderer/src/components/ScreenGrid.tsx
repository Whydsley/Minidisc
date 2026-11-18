import { useRef, useState } from 'react'
import { IconMaximize, IconVolume, IconVolumeOff } from '@tabler/icons-react'

type TileProps = { stream: MediaStream; label: string; onClick: () => void }

function Tile({ stream, label, onClick }: TileProps) {
  const box = useRef<HTMLDivElement>(null)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(100)
  const local = label.startsWith('Your screen') // your own preview must stay silent

  return (
    <div ref={box} className="tile" onClick={onClick}>
      <video
        autoPlay
        playsInline
        ref={(el) => {
          if (!el) return
          if (el.srcObject !== stream) el.srcObject = stream
          el.muted = local || muted
          el.volume = volume / 100
        }}
      />
      <span className="tag">{label}</span>
      {!local && (
        <button
          className="xbtn"
          style={{ right: 44 }}
          aria-label={muted ? 'Unmute screen sound' : 'Mute screen sound'}
          onClick={(e) => {
            e.stopPropagation()
            setMuted(!muted)
          }}
        >
          {muted ? <IconVolumeOff size={16} /> : <IconVolume size={16} />}
        </button>
      )}
      {!local && (
        <input
          className="vslider"
          type="range"
          min={0}
          max={100}
          value={volume}
          aria-label="Screen sound volume"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setVolume(Number(e.target.value))}
        />
      )}
      <button
        className="xbtn"
        aria-label="Full screen"
        onClick={(e) => {
          e.stopPropagation()
          box.current?.requestFullscreen().catch(() => {})
        }}
      >
        <IconMaximize size={16} />
      </button>
    </div>
  )
}

type Props = { screens: Record<string, MediaStream>; names: Record<string, string> }

export default function ScreenGrid({ screens, names }: Props) {
  const [focus, setFocus] = useState<string | null>(null)
  const ids = Object.keys(screens)
  if (ids.length === 0) return null

  const label = (id: string): string =>
    id === 'me' ? 'Your screen (preview)' : `${names[id] ?? 'Someone'}'s screen`
  const focused = focus && screens[focus] ? focus : null
  const main = ids.length === 1 ? ids[0] : focused

  if (!main) {
    return (
      <div className="screens grid">
        {ids.map((id) => (
          <Tile key={id} stream={screens[id]} label={label(id)} onClick={() => setFocus(id)} />
        ))}
      </div>
    )
  }

  return (
    <div className="screens has-focus">
      <Tile
        key={main}
        stream={screens[main]}
        label={label(main)}
        onClick={() => ids.length > 1 && setFocus(null)}
      />
      {ids.length > 1 && (
        <div className="strip">
          {ids
            .filter((id) => id !== main)
            .map((id) => (
              <Tile key={id} stream={screens[id]} label={label(id)} onClick={() => setFocus(id)} />
            ))}
        </div>
      )}
    </div>
  )
}