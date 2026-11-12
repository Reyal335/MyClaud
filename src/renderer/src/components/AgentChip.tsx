import type { TaskAgent } from '../../../shared/ipc'
import AgentIcon from './AgentIcon'
import './AgentChip.css'

type AgentChipProps = {
  agent: Pick<TaskAgent, 'name' | 'icon'>
  // Shown in the input row with a remove button; in the history without one.
  onRemove?: () => void
}

// The agent I called for a message: its icon and name, as in
// designs/8-chat-party.html (on my message) and 8b (in the input row).
function AgentChip({ agent, onRemove }: AgentChipProps): React.JSX.Element {
  if (!onRemove) {
    return (
      <span className="agent-chip">
        <AgentIcon src={agent.icon} size={16} label="" />
        {agent.name}
      </span>
    )
  }
  return (
    <div className="agent-chip agent-chip--input">
      <AgentIcon src={agent.icon} size={16} label="" />
      <span className="agent-chip__name">{agent.name}</span>
      <button
        type="button"
        className="agent-chip__remove"
        aria-label={`Stop calling ${agent.name}`}
        onClick={onRemove}
      >
        X
      </button>
    </div>
  )
}

export default AgentChip
