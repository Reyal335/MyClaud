import type { AgentSummary } from '../../../shared/ipc'
import AgentIcon from './AgentIcon'
import './AgentCard.css'

type AgentCardProps = {
  agent: AgentSummary
  selected: boolean
  onSelect: () => void
  onDelete: () => void
}

function toolSummary(tools: string[] | null): string {
  if (tools === null) return 'All tools'
  return tools.length === 0 ? 'No tools' : tools.join(' · ')
}

// One agent in the list, as in designs/3-agent-manager.html. An agent whose file
// cannot be read shows the problem and can only be deleted.
function AgentCard({ agent, selected, onSelect, onDelete }: AgentCardProps): React.JSX.Element {
  if (agent.problem) {
    return (
      <div className="agent-card agent-card--problem">
        <AgentIcon src={null} size={48} label={`${agent.name} icon`} />
        <div className="agent-card__text">
          <span className="agent-card__name">{agent.name}</span>
          <span className="agent-card__problem">{agent.problem}</span>
          <span className="agent-card__path">{agent.filePath}</span>
          <button
            type="button"
            className="button button--danger button--small agent-card__delete"
            onClick={onDelete}
          >
            DELETE
          </button>
        </div>
      </div>
    )
  }

  return (
    <button
      type="button"
      className={`agent-card${selected ? ' agent-card--selected' : ''}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <AgentIcon src={agent.icon} size={48} label={`${agent.name} icon`} />
      <span className="agent-card__text">
        {agent.role && <span className="agent-card__role">{agent.role}</span>}
        <span className="agent-card__top">
          <span className="agent-card__name">{agent.name}</span>
          <span className="agent-card__model">{agent.model ?? 'default'}</span>
        </span>
        <span className="agent-card__description">{agent.description}</span>
        <span className="agent-card__tools">
          {toolSummary(agent.tools)}
          {!agent.icon && <span className="agent-card__muted"> · no icon yet</span>}
        </span>
      </span>
    </button>
  )
}

export default AgentCard
