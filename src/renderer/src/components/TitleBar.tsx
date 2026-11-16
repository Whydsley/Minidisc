import { useEffect, useState } from 'react'
import { IconCopy, IconMinus, IconSquare, IconX } from '@tabler/icons-react'

export default function TitleBar() {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => window.api.onMaximizeChange(setMaximized), [])

  return (
    <div className="titlebar">
      <span className="title">Minidisc</span>
      <div className="wbtns">
        <button aria-label="Minimize" onClick={() => window.api.minimize()}>
          <IconMinus size={16} />
        </button>
        <button
          aria-label={maximized ? 'Restore' : 'Maximize'}
          onClick={() => window.api.toggleMaximize()}
        >
          {maximized ? <IconCopy size={14} /> : <IconSquare size={14} />}
        </button>
        <button className="close" aria-label="Close" onClick={() => window.api.close()}>
          <IconX size={16} />
        </button>
      </div>
    </div>
  )
}