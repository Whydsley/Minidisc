import { useRef, useState } from 'react'
import { IconMaximize } from '@tabler/icons-react'

type TileProps = { stream: MediaStream; label: string; onClick: () => void }

function Tile({ stream, label, onClick }: TileProps) {
  const box = useRef<HTMLDivElement>(null)
  return (
    <div ref={box} className="tile" onClick={onClick}>
      <video
        autoPlay
        playsInline
        muted
        ref={(el) => {
          if (el && el.srcObject !== stream) el.srcObject = stream
        }}
      />
      <span className="tag">{label}</span>
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