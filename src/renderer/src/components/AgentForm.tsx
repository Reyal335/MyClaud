import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type {
  AgentDetail,
  AgentDraft,
  AgentFolders,
  AgentIconChange,
  AgentScope,
  AgentSummary,
  ProjectInfo
} from '../../../shared/ipc'
import {
  agentDescriptionError,
  agentNameError,
  agentRoleError,
  agentToolsError,
  MAX_AGENT_ROLE_LENGTH,
  MODEL_CHOICES,
  safeFileStem,
  TOOL_CHOICES
} from '../../../shared/agentRules'
import AgentIcon from './AgentIcon'
import './AgentForm.css'

export type FormTarget = { kind: 'new'; scope: AgentScope } | { kind: 'edit'; filePath: string }

type AgentFormProps = {
  target: FormTarget
  agents: AgentSummary[]
  folders: AgentFolders | null
  project: ProjectInfo | null
  onDirtyChange: (dirty: boolean) => void
  onSaved: () => void
  onCancel: () => void
  onDelete: (agent: { filePath: string; name: string }) => void
  // Loads the file again, discarding edits.
  onReload: () => void
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; detail: AgentDetail | null }
  | { kind: 'failed'; message: string }

// Loads the agent, then shows the fields. A new agent starts empty.
function AgentForm(props: AgentFormProps): React.JSX.Element {
  const filePath = props.target.kind === 'edit' ? props.target.filePath : null
  const [load, setLoad] = useState<LoadState>(
    filePath === null ? { kind: 'ready', detail: null } : { kind: 'loading' }
  )

  useEffect(() => {
    if (filePath === null) return
    let cancelled = false
    window.myclaud.agents
      .read(filePath)
      .then((result) => {
        if (cancelled) return
        if (!result.ok) setLoad({ kind: 'failed', message: result.error.message })
        else if (result.agent.problem) {
          setLoad({
            kind: 'failed',
            message: `This file cannot be edited. ${result.agent.problem}`
          })
        } else setLoad({ kind: 'ready', detail: result.agent })
      })
      .catch((err: unknown) => {
        console.error('Could not read the agent:', err)
        if (!cancelled) setLoad({ kind: 'failed', message: 'The agent file could not be read.' })
      })
    return () => {
      cancelled = true
    }
  }, [filePath])

  if (load.kind !== 'ready') {
    return (
      <section className="agent-form" aria-label="Edit agent">
        <h2 className="agent-form__title">EDIT AGENT</h2>
        {load.kind === 'loading' ? (
          <p className="agent-form__note">Loading...</p>
        ) : (
          <>
            <div role="alert" className="agent-form__alert">
              {load.message}
            </div>
            <div className="agent-form__actions">
              <button type="button" className="button button--secondary" onClick={props.onCancel}>
                CLOSE
              </button>
            </div>
          </>
        )}
      </section>
    )
  }

  const newScope = props.target.kind === 'new' ? props.target.scope : 'global'
  return <AgentFields {...props} detail={load.detail} newScope={newScope} />
}

type Values = {
  scope: AgentScope
  // '' is no role.
  role: string
  name: string
  description: string
  body: string
  toolsMode: 'all' | 'only'
  // Ticked checkboxes. Entries without a checkbox are kept separately.
  checked: string[]
  // '' is Default: the model key is left out.
  model: string
  icon: AgentIconChange
  iconSrc: string | null
}

const isToolChoice = (tool: string): boolean => (TOOL_CHOICES as readonly string[]).includes(tool)

function initialValues(detail: AgentDetail | null, newScope: AgentScope): Values {
  return {
    scope: detail?.scope ?? newScope,
    role: detail?.role ?? '',
    name: detail?.name ?? '',
    description: detail?.description ?? '',
    body: detail?.body ?? '',
    toolsMode: detail?.tools ? 'only' : 'all',
    checked: (detail?.tools ?? []).filter(isToolChoice),
    model: detail?.model ?? '',
    icon: { type: 'keep' },
    iconSrc: detail?.icon ?? null
  }
}

// The tools to save: the file's entries in their order (minus unticked ones),
// then newly ticked tools in checkbox order.
function toolsOf(values: Values, fileTools: string[] | null): string[] | null {
  if (values.toolsMode === 'all') return null
  const kept = (fileTools ?? []).filter(
    (tool) => !isToolChoice(tool) || values.checked.includes(tool)
  )
  const added = TOOL_CHOICES.filter((tool) => values.checked.includes(tool) && !kept.includes(tool))
  return [...kept, ...added]
}

function toDraft(values: Values, fileTools: string[] | null): AgentDraft {
  return {
    scope: values.scope,
    name: values.name.trim(),
    description: values.description.replace(/\r\n/g, '\n').trim(),
    body: values.body.replace(/\r\n/g, '\n').replace(/^\n+/, '').replace(/\n+$/, ''),
    tools: toolsOf(values, fileTools),
    model: values.model === '' ? null : values.model,
    icon: values.icon,
    role: values.role.trim() === '' ? null : values.role.trim()
  }
}

const SCOPE_LABEL: Record<AgentScope, string> = { project: 'PROJECT', global: 'GLOBAL' }

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function joinPath(folder: string, file: string): string {
  return `${folder}${folder.includes('\\') ? '\\' : '/'}${file}`
}

// Project paths are shown from the project folder's name, as in the mockup.
function displayPath(path: string, project: ProjectInfo | null): string {
  if (project && path.startsWith(project.path))
    return project.name + path.slice(project.path.length)
  return path
}

type AgentFieldsProps = AgentFormProps & { detail: AgentDetail | null; newScope: AgentScope }

function AgentFields({
  detail,
  newScope,
  agents,
  folders,
  project,
  onDirtyChange,
  onSaved,
  onCancel,
  onDelete,
  onReload
}: AgentFieldsProps): React.JSX.Element {
  const id = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const [initial] = useState(() => initialValues(detail, newScope))
  const [values, setValues] = useState(initial)
  const [touched, setTouched] = useState({ name: detail !== null, description: detail !== null })
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [serverNameError, setServerNameError] = useState<string | null>(null)
  const [iconError, setIconError] = useState<string | null>(null)
  // A picked icon waits in the main process until saved. Dropped if not saved.
  const pendingIcon = useRef<string | null>(null)

  const fileTools = detail?.tools ?? null
  const extraTools = (fileTools ?? []).filter((tool) => !isToolChoice(tool))
  const draft = toDraft(values, fileTools)
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(initial, fileTools))

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])

  useEffect(
    () => () => {
      onDirtyChange(false)
      if (pendingIcon.current) void window.myclaud.agents.discardIcon(pendingIcon.current)
    },
    [onDirtyChange, pendingIcon]
  )

  // On narrow windows the form sits below the list.
  useEffect(() => {
    formRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [])

  const ownPath = detail?.filePath ?? null
  const sameNamed = useMemo(
    () =>
      agents.filter(
        (agent) => agent.problem === null && agent.name === draft.name && agent.filePath !== ownPath
      ),
    [agents, draft.name, ownPath]
  )
  const otherScope: AgentScope = values.scope === 'project' ? 'global' : 'project'
  const nameClash = sameNamed.some((agent) => agent.scope === values.scope)
  const nameShadow = !nameClash && sameNamed.some((agent) => agent.scope === otherScope)

  const nameError =
    agentNameError(values.name) ??
    (nameClash
      ? `${SCOPE_LABEL[values.scope]} already has an agent named "${draft.name}".`
      : null) ??
    serverNameError
  const roleError = agentRoleError(values.role)
  const descriptionError = agentDescriptionError(values.description)
  const toolsError = agentToolsError(draft.tools)
  const valid = !roleError && !nameError && !descriptionError && !toolsError
  const canSave = valid && dirty && !saving

  const projectAvailable = Boolean(folders?.project)
  const savedTo = useMemo(() => {
    if (detail && values.scope === detail.scope) return displayPath(detail.filePath, project)
    const folder = folders?.[values.scope]
    if (!folder) return null
    if (detail) return displayPath(joinPath(folder, baseName(detail.filePath)), project)
    if (draft.name === '') return displayPath(folder, project)
    const stem = safeFileStem(draft.name) || 'agent-xxxxxx'
    return displayPath(joinPath(folder, `${stem}.md`), project)
  }, [detail, values.scope, folders, draft.name, project])

  function update(patch: Partial<Values>): void {
    setValues((current) => ({ ...current, ...patch }))
  }

  function toggleTool(tool: string, on: boolean): void {
    setValues((current) => ({
      ...current,
      checked: on ? [...current.checked, tool] : current.checked.filter((t) => t !== tool)
    }))
  }

  function dropPendingIcon(): void {
    if (pendingIcon.current) void window.myclaud.agents.discardIcon(pendingIcon.current)
    pendingIcon.current = null
  }

  async function chooseIcon(): Promise<void> {
    setIconError(null)
    try {
      const result = await window.myclaud.agents.pickIcon()
      if (!result.ok) {
        setIconError(result.error.message)
        return
      }
      if (result.canceled) return
      dropPendingIcon()
      pendingIcon.current = result.token
      update({ icon: { type: 'token', token: result.token }, iconSrc: result.preview })
    } catch (err) {
      console.error('Could not pick an icon:', err)
      setIconError('The icon could not be opened.')
    }
  }

  function removeIcon(): void {
    dropPendingIcon()
    setIconError(null)
    // Without a saved icon there is nothing to remove from the file's mapping.
    update({ icon: detail?.icon ? { type: 'remove' } : { type: 'keep' }, iconSrc: null })
  }

  async function save(): Promise<void> {
    if (!canSave) return
    setSaving(true)
    setFormError(null)
    setConflict(false)
    try {
      const result = detail
        ? await window.myclaud.agents.update(detail.filePath, draft, detail.modifiedTime)
        : await window.myclaud.agents.create(draft)
      if (result.ok) {
        pendingIcon.current = null
        onSaved()
        return
      }
      const { code, message } = result.error
      if (code === 'conflict') setConflict(true)
      else if (code === 'exists') setServerNameError(message)
      else setFormError(message)
    } catch (err) {
      console.error('Could not save the agent:', err)
      setFormError('The agent could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  const modelOptions: string[] = [...MODEL_CHOICES]
  if (initial.model !== '' && !modelOptions.includes(initial.model)) {
    modelOptions.push(initial.model)
  }

  return (
    <form
      ref={formRef}
      className="agent-form"
      aria-label={detail ? 'Edit agent' : 'New agent'}
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <h2 className="agent-form__title">{detail ? 'EDIT AGENT' : 'NEW AGENT'}</h2>

      {conflict && (
        <div role="alert" className="agent-form__alert agent-form__alert--row">
          <span>This file changed on disk.</span>
          <button type="button" className="button button--small" onClick={onReload}>
            RELOAD
          </button>
        </div>
      )}

      <div className="agent-form__icon-row">
        <div className="agent-form__icon-preview">
          <AgentIcon src={values.iconSrc} size={64} label="Current icon, shown at 4x" />
        </div>
        <div className="agent-form__icon-actions">
          <div className="agent-form__icon-buttons">
            <button
              type="button"
              className="button button--icon-upload"
              onClick={() => void chooseIcon()}
            >
              UPLOAD 16x16 PNG
            </button>
            {values.iconSrc && (
              <button
                type="button"
                className="button button--secondary button--small"
                onClick={removeIcon}
              >
                REMOVE
              </button>
            )}
          </div>
          <div className="agent-form__note">
            Preview is 4x. Only exact 16x16 PNG files are accepted.
          </div>
        </div>
      </div>
      {iconError && (
        <div role="alert" className="agent-form__alert agent-form__alert--row">
          <span className="agent-form__alert-mark" aria-hidden="true">
            X
          </span>
          <span>{iconError}</span>
        </div>
      )}

      <div className="agent-form__field">
        <label htmlFor={`${id}-role`} className="agent-form__label">
          ROLE
        </label>
        <input
          id={`${id}-role`}
          className="agent-form__input"
          type="text"
          value={values.role}
          placeholder="code-reader"
          maxLength={MAX_AGENT_ROLE_LENGTH}
          aria-invalid={Boolean(roleError)}
          aria-describedby={`${id}-role-help`}
          onChange={(event) => update({ role: event.target.value })}
        />
        <div id={`${id}-role-help`}>
          {roleError ? (
            <p className="agent-form__error">{roleError}</p>
          ) : (
            <p className="agent-form__note">
              Optional. Shown in MyClaud only; not saved in the agent file.
            </p>
          )}
        </div>
      </div>

      <div className="agent-form__field">
        <label htmlFor={`${id}-name`} className="agent-form__label">
          NAME
        </label>
        <input
          id={`${id}-name`}
          className="agent-form__input"
          type="text"
          value={values.name}
          autoFocus={!detail}
          aria-invalid={touched.name && Boolean(nameError)}
          aria-describedby={`${id}-name-help`}
          onChange={(event) => {
            setServerNameError(null)
            setTouched((t) => ({ ...t, name: true }))
            update({ name: event.target.value })
          }}
        />
        <div id={`${id}-name-help`}>
          {touched.name && nameError && <p className="agent-form__error">{nameError}</p>}
          {nameShadow && (
            <p className="agent-form__warning">
              {SCOPE_LABEL[otherScope]} also has an agent named &quot;{draft.name}&quot;. In this
              project, Claude Code uses the PROJECT one.
            </p>
          )}
        </div>
      </div>

      <div className="agent-form__field">
        <label htmlFor={`${id}-description`} className="agent-form__label">
          DESCRIPTION
        </label>
        <textarea
          id={`${id}-description`}
          className="agent-form__input agent-form__input--description"
          rows={2}
          value={values.description}
          aria-invalid={touched.description && Boolean(descriptionError)}
          aria-describedby={`${id}-description-error`}
          onChange={(event) => {
            setTouched((t) => ({ ...t, description: true }))
            update({ description: event.target.value })
          }}
        />
        <div id={`${id}-description-error`}>
          {touched.description && descriptionError && (
            <p className="agent-form__error">{descriptionError}</p>
          )}
        </div>
      </div>

      <div className="agent-form__field">
        <label htmlFor={`${id}-prompt`} className="agent-form__label">
          SYSTEM PROMPT
        </label>
        <textarea
          id={`${id}-prompt`}
          className="agent-form__input agent-form__input--prompt"
          rows={12}
          value={values.body}
          onChange={(event) => update({ body: event.target.value })}
        />
      </div>

      <fieldset className="agent-form__tools" aria-describedby={`${id}-tools-error`}>
        <legend className="agent-form__label agent-form__legend">TOOLS</legend>
        <div className="agent-form__tool-mode">
          <label className="agent-form__check">
            <input
              type="radio"
              name={`${id}-tools-mode`}
              checked={values.toolsMode === 'all'}
              onChange={() => update({ toolsMode: 'all' })}
            />
            All tools
          </label>
          <label className="agent-form__check">
            <input
              type="radio"
              name={`${id}-tools-mode`}
              checked={values.toolsMode === 'only'}
              onChange={() => update({ toolsMode: 'only' })}
            />
            Only these
          </label>
        </div>
        {values.toolsMode === 'only' && (
          <>
            <div className="agent-form__tool-list">
              {TOOL_CHOICES.map((tool) => (
                <label key={tool} className="agent-form__check">
                  <input
                    type="checkbox"
                    checked={values.checked.includes(tool)}
                    onChange={(event) => toggleTool(tool, event.target.checked)}
                  />
                  {tool}
                </label>
              ))}
            </div>
            {extraTools.length > 0 && (
              <div className="agent-form__extras">
                <span className="agent-form__note">Also in this file, kept as they are:</span>
                {extraTools.map((tool) => (
                  <span key={tool} className="agent-form__chip">
                    {tool}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
        <div id={`${id}-tools-error`}>
          {toolsError && <p className="agent-form__error">{toolsError}</p>}
        </div>
      </fieldset>

      <div className="agent-form__row">
        <div className="agent-form__field agent-form__field--model">
          <label htmlFor={`${id}-model`} className="agent-form__label">
            MODEL
          </label>
          <select
            id={`${id}-model`}
            className="agent-form__input"
            value={values.model}
            onChange={(event) => update({ model: event.target.value })}
          >
            <option value="">Default</option>
            {modelOptions.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="agent-form__scope">
          <legend className="agent-form__label agent-form__legend">SCOPE</legend>
          <div className="agent-form__segments">
            {(['project', 'global'] as const).map((scope) => (
              <label
                key={scope}
                className={`agent-form__segment${values.scope === scope ? ' agent-form__segment--on' : ''}`}
              >
                <input
                  type="radio"
                  name={`${id}-scope`}
                  checked={values.scope === scope}
                  disabled={scope === 'project' && !projectAvailable}
                  onChange={() => {
                    setServerNameError(null)
                    update({ scope })
                  }}
                />
                {SCOPE_LABEL[scope]}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      {savedTo && <div className="agent-form__note">Saved to {savedTo}</div>}
      {detail && detail.otherFields.length > 0 && (
        <div className="agent-form__note">
          Also set in this file: {detail.otherFields.join(', ')}. These are kept as they are.
        </div>
      )}
      {formError && (
        <div role="alert" className="agent-form__alert">
          {formError}
        </div>
      )}

      <div className="agent-form__actions">
        <button type="submit" className="button button--primary" disabled={!canSave}>
          SAVE
        </button>
        <button type="button" className="button button--secondary" onClick={onCancel}>
          CANCEL
        </button>
        {detail && (
          <button
            type="button"
            className="button button--danger agent-form__delete"
            onClick={() => onDelete({ filePath: detail.filePath, name: detail.name })}
          >
            DELETE
          </button>
        )}
      </div>
    </form>
  )
}

export default AgentForm
