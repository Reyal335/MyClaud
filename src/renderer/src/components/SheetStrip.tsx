import type { CSSProperties } from 'react'
import { FRAME_SIZE } from '../../../shared/mascotRules'
import './SheetStrip.css'

type SheetStripProps = {
  src: string
  frames: number
  label: string
}

// The whole spritesheet at 1x, frame by frame, with a divider line between
// frames. Never scaled; a long strip scrolls sideways inside its own area.
function SheetStrip({ src, frames, label }: SheetStripProps): React.JSX.Element {
  // The sheet is set once on the parent; each frame shows its own slice of it.
  const style = {
    '--sheet': `url("${src}")`,
    '--sheet-width': `${frames * FRAME_SIZE}px`
  } as CSSProperties

  return (
    <div className="sheet-strip" tabIndex={0} role="img" aria-label={label} style={style}>
      <div className="sheet-strip__frames">
        {Array.from({ length: frames }, (_, i) => (
          <div
            key={i}
            className="sheet-strip__frame"
            style={{ backgroundPosition: `${-i * FRAME_SIZE}px 0` }}
          />
        ))}
      </div>
    </div>
  )
}

export default SheetStrip
