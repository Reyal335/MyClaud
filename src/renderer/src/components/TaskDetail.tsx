import type { PermissionDecision, TaskDetail as TaskDetailData } from '../../../shared/ipc'
import type { ToolItem } from '../hooks/useConversation'
import { clockTime, durationLabel } from '../conversation/timeLabel'
import AgentIcon from './AgentIcon'
import HarnessNote from './HarnessNote'
import Markdown from './Markdown'
import { splitHarnessNote } from '../../../shared/plainText'
import { PermissionActions, PermissionDetails } from './PermissionRow'
import ToolCard from './ToolCard'
import { TASK_STATUS_LABELS } from '../conversation/callTarget'
import './TaskDetail.css'

type TaskDetailProps = {
  task: TaskDetailData
  projectName: string
  // This task's requests waiting for my answer, oldest first.
  pending: ToolItem[]
  projectPath: string
  onAnswer: (permissionId: string, decision: PermissionDecision) => void
  // ASK AGAIN: null hides it (the agent no longer exists).
  onAskAgain: (() => void) | null
  askAgainBlocked: string | null
}

function scopeText(task: TaskDetailData, projectName: string): string {
  if (task.agent.scope === 'project') return `Project agent in ${projectName}`
  if (task.agent.scope === 'global') return 'Global agent'
  return 'Built-in agent'
}

// A task in full, beside the inbox list as in designs/1-inbox.html: what Claude
// asked the agent, what the agent did, and what it reported.
function TaskDetail({
  task,
  projectName,
  pending,
  projectPath,
  onAnswer,
  onAskAgain,
  askAgainBlocked
}: TaskDetailProps): React.JSX.Element {
  const request = pending[0] ?? null
  const ended = task.endedAt !== null
  // A done report is the agent's Markdown. An error or stopped one is plain text.
  const report = task.report && task.status === 'done' ? splitHarnessNote(task.report) : null
  const meta = [
    scopeText(task, projectName),
    `started ${clockTime(task.startedAt)}`,
    ended ? `took ${durationLabel(task.endedAt! - task.startedAt)}` : null
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <article className="task-detail" aria-labelledby="task-detail-title">
      <header className="task-detail__header">
        <AgentIcon src={task.agent.icon} size={48} label="" />
        <div className="task-detail__heading">
          <h2 id="task-detail-title" className="task-detail__title">
            {task.agent.name}
            {task.agent.role && <span className="task-detail__role">{task.agent.role}</span>}
          </h2>
          <div className="task-detail__meta">{meta}</div>
        </div>
        <span className={`task-detail__status task-detail__status--${task.status}`}>
          <span className="task-detail__square" aria-hidden="true" />
          {task.status === 'waiting' ? 'WAITING FOR APPROVAL' : TASK_STATUS_LABELS[task.status]}
        </span>
      </header>

      {request?.permission && (
        <section className="task-detail__request" aria-label="Permission request">
          <span className="task-detail__request-title">PERMISSION REQUEST</span>
          <PermissionDetails
            name={request.name}
            request={request.permission}
            projectPath={projectPath}
          />
          <PermissionActions
            name={request.name}
            request={request.permission}
            projectPath={projectPath}
            position={{ index: 0, total: pending.length }}
            onAnswer={onAnswer}
          />
        </section>
      )}

      <section className="task-detail__section" aria-labelledby="task-detail-task">
        <h3 id="task-detail-task" className="task-detail__label">
          TASK
        </h3>
        {task.description && <p className="task-detail__description">{task.description}</p>}
        <div className="task-detail__text task-detail__text--markdown">
          <Markdown source={task.prompt} measure />
        </div>
        {task.promptTruncated && <p className="task-detail__note">Shown in part.</p>}
      </section>

      <section className="task-detail__section" aria-labelledby="task-detail-activity">
        <h3 id="task-detail-activity" className="task-detail__label">
          ACTIVITY
        </h3>
        {task.activity.length > 0 ? (
          <div className="task-detail__activity">
            {task.activity.map((entry) => (
              <ToolCard
                key={entry.toolId}
                label={{ verb: entry.verb, target: entry.target }}
                state={entry.state}
              />
            ))}
          </div>
        ) : (
          <p className="task-detail__note">No tool calls.</p>
        )}
      </section>

      <section className="task-detail__section" aria-labelledby="task-detail-report">
        <h3 id="task-detail-report" className="task-detail__label">
          REPORT
        </h3>
        {report ? (
          <>
            {report.note !== null && <HarnessNote key={task.id} text={report.note} />}
            {report.body.trim() !== '' && (
              <div className="task-detail__text task-detail__text--markdown">
                <Markdown source={report.body} measure />
              </div>
            )}
          </>
        ) : task.report ? (
          <pre className={`task-detail__text task-detail__text--${task.status}`}>{task.report}</pre>
        ) : (
          <p className="task-detail__note">
            {ended ? 'No report.' : 'The agent is still working.'}
          </p>
        )}
        {task.reportTruncated && <p className="task-detail__note">Shown in part.</p>}
      </section>

      {onAskAgain && (
        <div className="task-detail__actions">
          <button
            type="button"
            className="button"
            aria-disabled={askAgainBlocked ? true : undefined}
            title={askAgainBlocked ?? undefined}
            onClick={() => {
              if (!askAgainBlocked) onAskAgain()
            }}
          >
            ASK AGAIN
          </button>
        </div>
      )}
    </article>
  )
}

export default TaskDetail
