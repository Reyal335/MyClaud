import type { TaskSummary } from '../../../shared/ipc'
import { TASK_STATUS_LABELS } from '../conversation/callTarget'
import { timeLabel } from '../conversation/timeLabel'
import AgentIcon from './AgentIcon'
import './TaskRow.css'

type TaskRowProps = {
  task: TaskSummary
  selected: boolean
  onOpen: () => void
  onDelete: () => void
}

// One task in the inbox list, as the rows in designs/1-inbox.html. A waiting task
// has the unread look; a finished one I have not opened shows NEW.
function TaskRow({ task, selected, onOpen, onDelete }: TaskRowProps): React.JSX.Element {
  const waiting = task.status === 'waiting'
  const open = task.status === 'running' || waiting
  const isNew = waiting || (!open && !task.seen)
  const className = [
    'task-row',
    waiting ? 'task-row--unread' : '',
    selected ? 'task-row--selected' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={className}>
      <button
        type="button"
        className="task-row__open"
        aria-current={selected ? 'true' : undefined}
        onClick={onOpen}
      >
        <AgentIcon src={task.agent.icon} size={32} label="" />
        <span className="task-row__text">
          <span className="task-row__top">
            <span className="task-row__agent">{task.agent.name}</span>
            <span className="task-row__time">{timeLabel(task.startedAt)}</span>
          </span>
          <span className="task-row__label">{task.description || 'Task'}</span>
          {task.preview && <span className="task-row__preview">{task.preview}</span>}
          <span className="task-row__tags">
            {task.agent.scope && (
              <span className={`task-row__scope task-row__scope--${task.agent.scope}`}>
                {task.agent.scope === 'project' ? 'PROJECT' : 'GLOBAL'}
              </span>
            )}
            <span className={`task-row__status task-row__status--${task.status}`}>
              <span className="task-row__square" aria-hidden="true" />
              {TASK_STATUS_LABELS[task.status]}
            </span>
            {isNew && <span className="task-row__new">NEW</span>}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="task-row__delete"
        aria-label={`Delete the task for ${task.agent.name}: ${task.description}`}
        title={open ? 'A running or waiting task cannot be deleted.' : 'Delete this task'}
        disabled={open}
        onClick={onDelete}
      >
        X
      </button>
    </div>
  )
}

export default TaskRow
