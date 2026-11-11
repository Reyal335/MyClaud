import type { CSSProperties } from 'react'
import './Mascot.css'

const FRAME = 64
const MAX_FRAMES = 16

type MascotProps = {
  // A horizontal strip of 64x64 frames.
  src: string
  frames: number
  fps: number
  // Whole-number display scale: the mascot is drawn at 64 * scale pixels square.
  scale?: number
  label: string
}

// Draws one frame of a spritesheet at a time and loops through the frames.
// The CSS animation uses steps(), so each frame lands on an exact whole-pixel
// offset and the timing follows the animation clock, with no drift. Knows nothing
// about conversations, so the mascot manager and the popup can reuse it.
function Mascot({ src, frames, fps, scale = 2, label }: MascotProps): React.JSX.Element {
  const count = Math.min(MAX_FRAMES, Math.max(1, Math.floor(frames)))
  const size = FRAME * Math.max(1, Math.round(scale))
  const animated = count > 1 && fps > 0

  const style = {
    width: size,
    height: size,
    backgroundImage: `url("${src}")`,
    backgroundSize: `${count * size}px ${size}px`,
    '--mascot-end': `${-count * size}px`,
    '--mascot-frames': count,
    '--mascot-duration': animated ? `${count / fps}s` : '0s'
  } as CSSProperties

  // The key restarts the animation from frame 0 when the sheet, frames, or fps change.
  return (
    <div
      key={`${src}|${count}|${fps}`}
      className={animated ? 'mascot mascot--animated' : 'mascot'}
      role="img"
      aria-label={label}
      style={style}
    />
  )
}

export default Mascot
