import type { ToolState } from '../hooks/useConversation'
import type { PermissionDecision, ToolInput } from '../../../shared/ipc'
import type { PermissionRequest } from '../hooks/useConversation'
import { toolLabel } from './toolLabel'
import PermissionRow from './PermissionRow'
import './ToolCard.css'

type ToolCardProps = {
  name: string
  input: ToolInput | null
  state: ToolState
  permission: PermissionRequest | null
  projectPath: string | null
  onAnswer: (permissionId: string, decision: PermissionDecision) => void
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
function ToolCard({
  name,
  input,
  state,
  permission,
  projectPath,
  onAnswer
}: ToolCardProps): React.JSX.Element {
  const { verb, target } = toolLabel(name, input, projectPath)

  return (
    <div className={`tool-card tool-card--${state}${permission ? ' tool-card--asking' : ''}`}>
      <div className="tool-card__line">
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
      {permission && (
        <PermissionRow
          name={name}
          request={permission}
          projectPath={projectPath}
          onAnswer={onAnswer}
        />
      )}
    </div>
  )
}

export default ToolCard
