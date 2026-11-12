import type { TaskStatus } from '../../../shared/ipc'
import type { TaskView } from '../conversation/agentWork'
import AgentIcon from './AgentIcon'
import './AgentTaskCard.css'

type AgentTaskCardProps = {
  view: TaskView
  onOpen: (taskId: string) => void
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  running: 'RUNNING',
  waiting: 'WAITING',
  done: 'DONE',
  error: 'ERROR',
  stopped: 'STOPPED'
}

// One task in the history, as in designs/8-chat-party.html: the agent, its task,
// and its status as a word. While it runs, its latest activity; when it ends, the
// start of its report and OPEN IN INBOX.
function AgentTaskCard({ view, onOpen }: AgentTaskCardProps): React.JSX.Element {
  const { item, state, activity } = view
  const status: TaskStatus = state === 'waiting' ? 'waiting' : item.status
  const smaller = [item.agent.role, item.description].filter(Boolean).join(' · ')

  let body: React.JSX.Element | null
  if (state === 'waiting') {
    body = <p className="task-card__line task-card__line--waiting">Needs your approval</p>
  } else if (state === 'working') {
    body = <p className="task-card__line">{activity ?? 'Starting...'}</p>
  } else {
    body = item.report ? <p className="task-card__report">{item.report}</p> : null
  }

  return (
    <article
      className={`task-card task-card--${status}`}
      aria-label={`Task for ${item.agent.name}`}
    >
      <AgentIcon src={item.agent.icon} size={32} label="" />
      <div className="task-card__text">
        <div className="task-card__head">
          <span className="task-card__name">{item.agent.name}</span>
          {smaller && <span className="task-card__smaller">{smaller}</span>}
          <span className="task-card__status">{STATUS_LABELS[status]}</span>
        </div>
        {body}
        {state === 'ended' && (
          <button type="button" className="task-card__open" onClick={() => onOpen(item.taskId)}>
            OPEN IN INBOX &gt;
          </button>
        )}
      </div>
    </article>
  )
}

export default AgentTaskCard
