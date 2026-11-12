import type { ToolInput, ToolState } from '../../../shared/ipc'
import { toolLabel, type ToolLabel } from '../../../shared/toolLabel'
import './ToolCard.css'

type ToolCardProps = { state: ToolState } & (
  | { name: string; input: ToolInput | null; projectPath: string | null }
  // A label already made, as a task's saved activity keeps it.
  | { label: ToolLabel }
)

const STATE_LABELS: Record<ToolState, string> = {
  running: 'RUNNING',
  waiting: 'WAITING',
  done: 'DONE',
  failed: 'FAILED',
  denied: 'DENIED',
  stopped: 'STOPPED'
}

// One tool call. Not a button: it has no hover state and does nothing on click.
// Approval details and buttons live in the dialogue box, not here.
function ToolCard(props: ToolCardProps): React.JSX.Element {
  const { state } = props
  const { verb, target } =
    'label' in props ? props.label : toolLabel(props.name, props.input, props.projectPath)

  return (
    <div className={`tool-card tool-card--${state}`}>
      <span className="tool-card__square" aria-hidden="true" />
      <span className="tool-card__label">
        {verb}
        {target !== null && (
          <>
            {' '}
            <span className="tool-card__target">{target}</span>
          </>
        )}
      </span>
      <span className="tool-card__state">{STATE_LABELS[state]}</span>
    </div>
  )
}

export default ToolCard
