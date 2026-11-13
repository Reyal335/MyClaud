import type { BarView } from '../../../shared/account'
import './SegmentBar.css'

type SegmentBarProps = {
  view: BarView
  // 20 on the ACCOUNT screen, 10 in the sidebar meter.
  segments: number
  size: 'screen' | 'meter'
}

// A bar of equal segments, like an HP bar. Filled segments take the tone's color; empty
// ones are a 2px --line box, dashed when there is no percent to show. Drawn for the eye
// only: the row it sits in says the same in words.
function SegmentBar({ view, segments, size }: SegmentBarProps): React.JSX.Element {
  const cells: React.JSX.Element[] = []
  for (let i = 0; i < segments; i++) {
    const kind =
      i < view.filled && view.tone !== null ? view.tone : view.dashed ? 'dashed' : 'empty'
    cells.push(<span key={i} className={`segment-bar__cell segment-bar__cell--${kind}`} />)
  }
  return (
    <div className={`segment-bar segment-bar--${size}`} aria-hidden="true">
      {cells}
    </div>
  )
}

export default SegmentBar
