import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentScope, AgentSummary, ProjectInfo } from '../../../shared/ipc'
import { useAgents } from '../hooks/useAgents'
import AgentCard from '../components/AgentCard'
import AgentForm, { type FormTarget } from '../components/AgentForm'
import Dialog from '../components/Dialog'
import type { LeaveGuard } from './types'
import './AgentsScreen.css'

type AgentsScreenProps = {
  project: ProjectInfo | null
  // Lets the app ask before leaving while the form has unsaved changes.
  setLeaveGuard: (guard: LeaveGuard | null) => void
}

type Selection = { target: FormTarget; key: string }

type DialogState =
  | { kind: 'discard'; proceed: () => void }
  | { kind: 'delete'; filePath: string; name: string; busy: boolean }

function targetKey(target: FormTarget, nonce: number): string {
  return `${target.kind === 'edit' ? target.filePath : `new:${target.scope}`}#${nonce}`
}

// The AGENTS screen from designs/3-agent-manager.html: project and global agents,
// and the form to create or edit one.
function AgentsScreen({ project, setLeaveGuard }: AgentsScreenProps): React.JSX.Element {
  const projectPath = project?.path ?? null
  const { agents, folders, loaded, error, reload } = useAgents(projectPath)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [dirty, setDirty] = useState(false)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const nonce = useRef(0)
  const titleRef = useRef<HTMLHeadingElement>(null)

  // A different project closes the form. The app already asked if it had changes.
  const [shownProject, setShownProject] = useState(projectPath)
  if (shownProject !== projectPath) {
    setShownProject(projectPath)
    setSelection(null)
    setDirty(false)
  }

  const askBeforeLeaving = useCallback(
    (proceed: () => void): void => {
      if (dirty) setDialog({ kind: 'discard', proceed })
      else proceed()
    },
    [dirty]
  )

  useEffect(() => {
    setLeaveGuard(dirty ? askBeforeLeaving : null)
    return () => setLeaveGuard(null)
  }, [dirty, askBeforeLeaving, setLeaveGuard])

  function open(target: FormTarget): void {
    askBeforeLeaving(() => {
      nonce.current += 1
      setSelection({ target, key: targetKey(target, nonce.current) })
      setActionError(null)
    })
  }

  function closeForm(): void {
    setSelection(null)
    setDirty(false)
    titleRef.current?.focus()
  }

  function reloadForm(): void {
    if (!selection) return
    nonce.current += 1
    setSelection({ target: selection.target, key: targetKey(selection.target, nonce.current) })
  }

  async function confirmDelete(filePath: string): Promise<void> {
    setDialog((current) => (current?.kind === 'delete' ? { ...current, busy: true } : current))
    try {
      const result = await window.myclaud.agents.remove(filePath)
      if (result.ok) {
        if (selection?.target.kind === 'edit' && selection.target.filePath === filePath) {
          closeForm()
        }
        setActionError(null)
      } else {
        setActionError(result.error.message)
      }
    } catch (err) {
      console.error('Could not delete the agent:', err)
      setActionError('The agent could not be deleted.')
    }
    setDialog(null)
    void reload()
  }

  const selectedPath = selection?.target.kind === 'edit' ? selection.target.filePath : null

  function renderSection(scope: AgentScope): React.JSX.Element {
    const list = agents.filter((agent) => agent.scope === scope)
    const available = scope === 'global' || Boolean(folders?.project)
    const title =
      scope === 'project'
        ? project
          ? `PROJECT · ${project.name}`
          : 'PROJECT'
        : 'GLOBAL · all projects'
    let empty: string | null = null
    if (scope === 'project' && !project) empty = 'No project is open.'
    else if (loaded && list.length === 0) {
      empty = scope === 'project' ? 'No agents in this project yet.' : 'No global agents yet.'
    }

    return (
      <section className="agents__section" aria-labelledby={`agents-${scope}`}>
        <div className="agents__section-head">
          <h2
            id={`agents-${scope}`}
            className={`agents__section-title agents__section-title--${scope}`}
          >
            {title}
          </h2>
          <button
            type="button"
            className="button button--small"
            disabled={!available}
            aria-label={`New ${scope} agent`}
            onClick={() => open({ kind: 'new', scope })}
          >
            + NEW
          </button>
        </div>
        {empty && <p className="agents__empty">{empty}</p>}
        {list.map((agent: AgentSummary) => (
          <AgentCard
            key={agent.filePath}
            agent={agent}
            selected={agent.filePath === selectedPath}
            onSelect={() => {
              if (agent.filePath !== selectedPath) open({ kind: 'edit', filePath: agent.filePath })
            }}
            onDelete={() =>
              setDialog({ kind: 'delete', filePath: agent.filePath, name: agent.name, busy: false })
            }
          />
        ))}
      </section>
    )
  }

  return (
    <div className="agents">
      <div className="agents__list">
        <h1 ref={titleRef} tabIndex={-1} className="agents__title">
          AGENTS
        </h1>
        {error && (
          <p role="alert" className="agents__error">
            {error}
          </p>
        )}
        {actionError && (
          <p role="alert" className="agents__error">
            {actionError}
          </p>
        )}
        {renderSection('project')}
        {renderSection('global')}
      </div>

      {selection && (
        <AgentForm
          key={selection.key}
          target={selection.target}
          agents={agents}
          folders={folders}
          project={project}
          onDirtyChange={setDirty}
          onSaved={() => {
            closeForm()
            void reload()
          }}
          onCancel={() => askBeforeLeaving(closeForm)}
          onDelete={({ filePath, name }) =>
            setDialog({ kind: 'delete', filePath, name, busy: false })
          }
          onReload={reloadForm}
        />
      )}

      {dialog?.kind === 'discard' && (
        <Dialog
          title="DISCARD CHANGES?"
          onClose={() => setDialog(null)}
          actions={
            <>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => setDialog(null)}
              >
                KEEP EDITING
              </button>
              <button
                type="button"
                className="button button--danger"
                onClick={() => {
                  const { proceed } = dialog
                  setDialog(null)
                  setDirty(false)
                  proceed()
                }}
              >
                DISCARD
              </button>
            </>
          }
        >
          <p>This agent has unsaved changes. They will be lost.</p>
        </Dialog>
      )}

      {dialog?.kind === 'delete' && (
        <Dialog
          title="DELETE AGENT?"
          tone="danger"
          onClose={() => {
            if (!dialog.busy) setDialog(null)
          }}
          actions={
            <>
              <button
                type="button"
                className="button button--secondary"
                disabled={dialog.busy}
                onClick={() => setDialog(null)}
              >
                CANCEL
              </button>
              <button
                type="button"
                className="button button--danger"
                disabled={dialog.busy}
                onClick={() => void confirmDelete(dialog.filePath)}
              >
                DELETE
              </button>
            </>
          }
        >
          <p>
            Delete <strong>{dialog.name}</strong>? The file goes to the trash, and its icon and role
            are removed.
          </p>
          <p className="agents__dialog-path">{dialog.filePath}</p>
        </Dialog>
      )}
    </div>
  )
}

export default AgentsScreen
