import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectInfo, TaskDetail as TaskDetailData } from '../../../shared/ipc'
import { callBlock } from '../../../shared/agentGate'
import type { CallTarget, Conversation, ToolItem } from '../hooks/useConversation'
import { useAgents } from '../hooks/useAgents'
import type { TasksStore } from '../hooks/useTasks'
import Dialog from '../components/Dialog'
import NoProject from '../components/NoProject'
import TaskDetail from '../components/TaskDetail'
import TaskRow from '../components/TaskRow'
import { callTargetOf } from '../conversation/callTarget'
import './Screen.css'
import './InboxScreen.css'

type InboxScreenProps = {
  project: ProjectInfo | null
  projectLoaded: boolean
  onOpenProject: () => void
  conversation: Conversation
  tasks: TasksStore
  selectedTaskId: string | null
  onSelectTask: (taskId: string | null) => void
  onAskAgain: (call: CallTarget) => void
}

type Confirm = { kind: 'delete'; taskId: string; label: string } | { kind: 'clear' }

// The INBOX from designs/1-inbox.html: every task Claude handed to an agent, with
// the opened one in full beside the list.
function InboxScreen({
  project,
  projectLoaded,
  onOpenProject,
  conversation,
  tasks,
  selectedTaskId,
  onSelectTask,
  onAskAgain
}: InboxScreenProps): React.JSX.Element {
  const { agents } = useAgents(project?.path ?? null)
  const [detail, setDetail] = useState<TaskDetailData | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const latest = useRef(0)

  const selected = tasks.tasks.find((task) => task.id === selectedTaskId) ?? null

  // The open task follows events as they arrive: its summary changes whenever
  // main says the tasks changed, and the detail is read again then.
  useEffect(() => {
    if (!selected) return
    const request = ++latest.current
    window.myclaud.tasks
      .get(selected.id)
      .then((result) => {
        if (request !== latest.current) return
        setDetail(result.ok ? result.task : null)
        if (!result.ok) setActionError(result.error.message)
      })
      .catch((err: unknown) => console.error('Could not read the task:', err))
  }, [selected])

  // Opening a task marks it seen.
  useEffect(() => {
    if (selected && !selected.seen) {
      void window.myclaud.tasks.markSeen(selected.id).catch(() => {})
    }
  }, [selected])

  const pending = useMemo(
    () =>
      conversation.items.filter(
        (item): item is ToolItem =>
          item.kind === 'tool' && item.permission !== null && item.taskId === selectedTaskId
      ),
    [conversation.items, selectedTaskId]
  )

  if (!projectLoaded) return <section className="screen inbox" aria-label="Inbox" />
  if (!project) return <NoProject title="INBOX" onOpenProject={onOpenProject} />

  const finished = tasks.tasks.filter(
    (task) => task.status !== 'running' && task.status !== 'waiting'
  )
  const agentFile = detail?.agent.filePath
    ? agents.find((agent) => agent.filePath === detail.agent.filePath)
    : undefined

  async function confirmAction(action: Confirm): Promise<void> {
    setConfirm(null)
    const result =
      action.kind === 'delete'
        ? await window.myclaud.tasks.remove(action.taskId)
        : await window.myclaud.tasks.clearFinished()
    if (!result.ok) {
      setActionError(result.error.message)
      return
    }
    setActionError(null)
    if (action.kind === 'delete' && action.taskId === selectedTaskId) onSelectTask(null)
    if (action.kind === 'clear' && selected && finished.some((task) => task.id === selected.id)) {
      onSelectTask(null)
    }
  }

  return (
    <div className="inbox">
      <section className="inbox__list" aria-labelledby="inbox-title">
        <div className="inbox__head">
          <h1 id="inbox-title" className="inbox__title">
            INBOX
          </h1>
          <button
            type="button"
            className="button button--secondary button--small"
            disabled={finished.length === 0}
            onClick={() => setConfirm({ kind: 'clear' })}
          >
            CLEAR FINISHED
          </button>
        </div>
        {(tasks.error || actionError) && (
          <p role="alert" className="inbox__error">
            {actionError ?? tasks.error}
          </p>
        )}
        {tasks.loaded && tasks.tasks.length === 0 && (
          <p className="inbox__empty">
            Nothing here yet. Call an agent from the party panel on CHAT.
          </p>
        )}
        {tasks.tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            selected={task.id === selectedTaskId}
            onOpen={() => onSelectTask(task.id)}
            onDelete={() =>
              setConfirm({
                kind: 'delete',
                taskId: task.id,
                label: `${task.agent.name}: ${task.description || 'Task'}`
              })
            }
          />
        ))}
      </section>

      <section className="inbox__detail" aria-label="Task">
        {detail && selected && detail.id === selected.id ? (
          <TaskDetail
            task={{ ...detail, status: selected.status }}
            projectName={project.name}
            pending={pending}
            projectPath={project.path}
            onAnswer={conversation.answerPermission}
            onAskAgain={agentFile ? () => onAskAgain(callTargetOf(agentFile)) : null}
            askAgainBlocked={agentFile ? (callBlock(agentFile, agents)?.message ?? null) : null}
          />
        ) : (
          <p className="inbox__pick">
            {tasks.tasks.length > 0 ? 'Open a task to see what was asked and what came back.' : ''}
          </p>
        )}
      </section>

      {confirm && (
        <Dialog
          title={confirm.kind === 'delete' ? 'DELETE TASK?' : 'CLEAR FINISHED?'}
          tone="danger"
          onClose={() => setConfirm(null)}
          actions={
            <>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => setConfirm(null)}
              >
                CANCEL
              </button>
              <button
                type="button"
                className="button button--danger"
                onClick={() => void confirmAction(confirm)}
              >
                {confirm.kind === 'delete' ? 'DELETE' : 'CLEAR'}
              </button>
            </>
          }
        >
          {confirm.kind === 'delete' ? (
            <p>
              Delete <strong>{confirm.label}</strong> from the inbox? The conversation keeps its
              card.
            </p>
          ) : (
            <p>
              Remove {finished.length} finished {finished.length === 1 ? 'task' : 'tasks'} (done,
              error, and stopped) from the inbox?
            </p>
          )}
        </Dialog>
      )}
    </div>
  )
}

export default InboxScreen
