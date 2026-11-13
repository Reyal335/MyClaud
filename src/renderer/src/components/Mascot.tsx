import { useEffect, useRef, type CSSProperties } from 'react'
import { canReverse, loopOrder } from '../../../shared/mascotRules'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import './Mascot.css'

const FRAME = 64
const MAX_FRAMES = 16

type MascotProps = {
  // A horizontal strip of 64x64 frames.
  src: string
  frames: number
  fps: number
  // Play forward, then back, then forward again. Needs three or more frames.
  reverse?: boolean
  // Whole-number display scale: the mascot is drawn at 64 * scale pixels square.
  scale?: number
  label: string
}

// Draws one frame of a spritesheet at a time and loops through the frames.
// The CSS animation uses steps(), so each frame lands on an exact whole-pixel
// offset and the timing follows the animation clock, with no drift. Knows nothing
// about conversations, so the mascot manager and the popup can reuse it.
//
// A loop that reverses at the end plays the frames in loopOrder instead (0 to n-1,
// then back down to 1). That order is not a straight run of steps, so it is played
// with the Web Animations API: still stepped, still on the animation clock.
function Mascot({
  src,
  frames,
  fps,
  reverse = false,
  scale = 2,
  label
}: MascotProps): React.JSX.Element {
  const count = Math.min(MAX_FRAMES, Math.max(1, Math.floor(frames)))
  const size = FRAME * Math.max(1, Math.round(scale))
  const animated = count > 1 && fps > 0
  const bounces = reverse && canReverse(count)
  const reducedMotion = usePrefersReducedMotion()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = ref.current
    if (!element || !animated || !bounces || reducedMotion) return
    const order = loopOrder(count, true)
    const length = order.length
    const stops = order.map((frame, k) => ({
      backgroundPositionX: `${-frame * size}px`,
      offset: k / length,
      // Hold each frame until the next one starts.
      easing: 'step-end'
    }))
    // The end of the cycle is the first frame again.
    stops.push({ backgroundPositionX: '0px', offset: 1, easing: 'step-end' })
    const animation = element.animate(stops, {
      duration: (length / fps) * 1000,
      iterations: Infinity
    })
    return () => animation.cancel()
    // The element is made again when `src` changes (see the key below), so it is
    // listed: a new element needs a new animation.
  }, [animated, bounces, count, fps, reducedMotion, size, src])

  const style = {
    width: size,
    height: size,
    backgroundImage: `url("${src}")`,
    backgroundSize: `${count * size}px ${size}px`,
    '--mascot-end': `${-count * size}px`,
    '--mascot-frames': count,
    '--mascot-duration': animated ? `${count / fps}s` : '0s'
  } as CSSProperties

  // The key restarts the animation from frame 0 when the sheet, frames, fps, or
  // direction change.
  return (
    <div
      key={`${src}|${count}|${fps}|${bounces}`}
      ref={ref}
      className={animated && !bounces ? 'mascot mascot--animated' : 'mascot'}
      role="img"
      aria-label={label}
      style={style}
    />
  )
}

export default Mascot
