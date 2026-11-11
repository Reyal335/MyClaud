import { useEffect, useRef } from 'react'
import type { PermissionDecision, ToolInput } from '../../../shared/ipc'
import type { PermissionRequest } from '../hooks/useConversation'
import { relativePath } from './toolLabel'
import './PermissionRow.css'

type PermissionRowProps = {
  name: string
  request: PermissionRequest
  projectPath: string | null
  onAnswer: (permissionId: string, decision: PermissionDecision) => void
}

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

// The details of a waiting tool call and the APPROVE / DENY buttons, as in
// designs/2-conversation.html. No keyboard shortcut and no automatic focus.
function PermissionRow({
  name,
  request,
  projectPath,
  onAnswer
}: PermissionRowProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  // Bring the request into view when it appears, without moving keyboard focus.
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest' })
  }, [])

  return (
    <div ref={ref} className="permission" role="group" aria-label="Permission request">
      <Details name={name} input={request.input} projectPath={projectPath} />
      {request.truncated && <p className="permission__note">Shown in part.</p>}
      <div className="permission__actions">
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
    </div>
  )
}

export default PermissionRow
