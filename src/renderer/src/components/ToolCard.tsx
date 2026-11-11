import type { ToolState } from '../hooks/useConversation'
import type { ToolInput } from '../../../shared/ipc'
import { toolLabel } from './toolLabel'
import './ToolCard.css'

type ToolCardProps = {
  name: string
  input: ToolInput | null
  state: ToolState
  projectPath: string | null
}

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
function ToolCard({ name, input, state, projectPath }: ToolCardProps): React.JSX.Element {
  const { verb, target } = toolLabel(name, input, projectPath)

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
