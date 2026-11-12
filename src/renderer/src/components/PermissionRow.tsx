import type { PermissionDecision, ToolInput } from '../../../shared/ipc'
import type { PermissionRequest } from '../hooks/useConversation'
import { relativePath } from '../../../shared/toolLabel'
import './PermissionRow.css'

// A waiting tool call, in two parts the dialogue box places separately: the
// details scroll with the box body, and the actions stay pinned below it.

function stringField(input: ToolInput, key: string): string {
  const value = input[key]
  return typeof value === 'string' ? value : ''
}

// A labelled block of plain text that scrolls after about 12 lines.
function DetailBlock({ label, text }: { label: string; text: string }): React.JSX.Element {
  return (
    <div className="permission__field">
      <div className="permission__label">{label}</div>
      <pre className="permission__block">
        {text === '' ? <span className="permission__empty">(empty)</span> : text}
      </pre>
    </div>
  )
}

function Details({
  name,
  input,
  projectPath
}: {
  name: string
  input: ToolInput
  projectPath: string | null
}): React.JSX.Element {
  const path = relativePath(stringField(input, 'file_path'), projectPath)
  switch (name) {
    case 'Bash': {
      const description = stringField(input, 'description')
      return (
        <>
          <DetailBlock label="COMMAND" text={stringField(input, 'command')} />
          {description !== '' && <p className="permission__note">{description}</p>}
        </>
      )
    }
    case 'Edit':
      return (
        <>
          <p className="permission__path">{path}</p>
          <DetailBlock label="OLD TEXT" text={stringField(input, 'old_string')} />
          <DetailBlock label="NEW TEXT" text={stringField(input, 'new_string')} />
        </>
      )
    case 'Write':
      return (
        <>
          <p className="permission__path">{path}</p>
          <DetailBlock label="CONTENT" text={stringField(input, 'content')} />
        </>
      )
    default:
      return <DetailBlock label="INPUT" text={JSON.stringify(input, null, 2)} />
  }
}

function question(name: string, input: ToolInput, projectPath: string | null): string {
  const path = relativePath(stringField(input, 'file_path'), projectPath)
  switch (name) {
    case 'Edit':
      return `EDIT ${path}?`
    case 'Write':
      return `WRITE ${path}?`
    case 'Bash':
      return 'RUN THIS COMMAND?'
    default:
      return `USE ${name.toUpperCase()}?`
  }
}

type PartProps = {
  name: string
  request: PermissionRequest
  projectPath: string | null
}

// What the agent wants to do: plain text blocks that scroll after about 12 lines.
export function PermissionDetails({ name, request, projectPath }: PartProps): React.JSX.Element {
  return (
    <div className="permission">
      <Details name={name} input={request.input} projectPath={projectPath} />
      {request.truncated && <p className="permission__note">Shown in part.</p>}
    </div>
  )
}

type ActionsProps = PartProps & {
  // Where this request is among those pending, shown as "1 of 2" when more than one.
  position: { index: number; total: number }
  onAnswer: (permissionId: string, decision: PermissionDecision) => void
}

// The APPROVE / DENY row from designs/2-conversation.html. Both buttons are
// disabled after one click. No keyboard shortcut and no automatic focus.
export function PermissionActions({
  name,
  request,
  projectPath,
  position,
  onAnswer
}: ActionsProps): React.JSX.Element {
  return (
    <div className="permission__actions" role="group" aria-label="Permission request">
      {position.total > 1 && (
        <span className="permission__position">
          {position.index + 1} of {position.total}
        </span>
      )}
      <span className="permission__question">{question(name, request.input, projectPath)}</span>
      <button
        type="button"
        className="button button--primary"
        disabled={request.answering}
        onClick={() => onAnswer(request.permissionId, 'approve')}
      >
        APPROVE
      </button>
      <button
        type="button"
        className="button button--secondary"
        disabled={request.answering}
        onClick={() => onAnswer(request.permissionId, 'deny')}
      >
        DENY
      </button>
    </div>
  )
}
