import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { PermissionDecision, TaskAgent } from '../../../shared/ipc'
import type { ConversationItem } from '../hooks/useConversation'
import { useTypewriter } from '../hooks/useTypewriter'
import { errorText, STOPPED_TEXT } from '../../../shared/noticeText'
import AgentIcon from './AgentIcon'
import { PermissionActions, PermissionDetails } from './PermissionRow'
import type { ToolLabel } from '../../../shared/toolLabel'
import './DialogueBox.css'

type ToolItem = Extract<ConversationItem, { kind: 'tool' }>
type NoticeItem = Extract<ConversationItem, { kind: 'notice' }>

type DialogueBoxProps = {
  agentName: string
  // The last item when it is reply text. It types out here and is not in the history,
  // unless it is `instant`: text loaded from a saved conversation shows at once.
  reply: { id: number; text: string; instant: boolean } | null
  // The last item when it is a notice (stopped or error).
  notice: NoticeItem['notice'] | null
  // Requests waiting for an answer, oldest first, from the main conversation and agents.
  pending: ToolItem[]
  // The agent behind the oldest request, or null when Claude itself asks.
  asker: Pick<TaskAgent, 'name' | 'icon'> | null
  // The label of the running tool card, if one is running.
  working: ToolLabel | null
  // A run is in progress.
  running: boolean
  // Nothing has been sent yet.
  empty: boolean
  // The most recent reply text that is complete, for screen readers.
  announce: string
  projectPath: string
  reducedMotion: boolean
  onAnswer: (permissionId: string, decision: PermissionDecision) => void
  // Called only when typing starts or stops, never per character.
  onTypingChange: (typing: boolean) => void
}

// Position of the oldest pending request among all requests seen since the queue
// was last empty, so two requests read "1 of 2" and then "2 of 2".
function useRequestPosition(pending: ToolItem[]): { index: number; total: number } {
  const [batch, setBatch] = useState<string[]>([])
  const ids = pending.map((item) => item.permission?.permissionId ?? '')
  const added = ids.filter((id) => !batch.includes(id))

  let next = batch
  if (ids.length === 0) next = batch.length > 0 ? [] : batch
  else if (added.length > 0) next = [...batch, ...added]
  if (next !== batch) setBatch(next)

  return { index: ids.length > 0 ? next.indexOf(ids[0]) : 0, total: next.length }
}

// The RPG dialogue box from designs/2-conversation.html. Per-character typing
// updates stay inside this component; the history does not re-render for them.
function DialogueBox({
  agentName,
  reply,
  notice,
  pending,
  asker,
  working,
  running,
  empty,
  announce,
  projectPath,
  reducedMotion,
  onAnswer,
  onTypingChange
}: DialogueBoxProps): React.JSX.Element {
  const { shown, typing, skip } = useTypewriter(
    reply?.text ?? '',
    reply?.id ?? null,
    reducedMotion || Boolean(reply?.instant)
  )
  const bodyRef = useRef<HTMLDivElement>(null)
  const position = useRequestPosition(pending)

  useEffect(() => {
    onTypingChange(typing)
  }, [typing, onTypingChange])

  const request = pending[0] ?? null
  const kind = request
    ? 'asking'
    : reply
      ? 'reply'
      : notice
        ? 'notice'
        : working
          ? 'working'
          : running
            ? 'thinking'
            : 'idle'

  // Reply text stays scrolled to the bottom while it types. A new request starts at the top.
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (!body) return
    body.scrollTop = kind === 'asking' ? 0 : body.scrollHeight
  }, [kind, shown, request?.id])

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      skip()
    }
  }

  let body: React.JSX.Element
  switch (kind) {
    case 'asking':
      body = (
        <>
          {asker && (
            <p className="dialogue__asker">
              <AgentIcon src={asker.icon} size={16} label="" />
              {asker.name} asks
            </p>
          )}
          <PermissionDetails
            name={request!.name}
            request={request!.permission!}
            projectPath={projectPath}
          />
        </>
      )
      break
    case 'reply':
      body = (
        <>
          <span aria-hidden="true">{shown}</span>
          <span
            className={`dialogue__cursor${typing ? '' : ' dialogue__cursor--blink'}`}
            aria-hidden="true"
          />
        </>
      )
      break
    case 'notice':
      body =
        notice!.type === 'stopped' ? (
          <span className="dialogue__muted">{STOPPED_TEXT}</span>
        ) : notice!.type === 'info' ? (
          <span className="dialogue__muted">{notice!.text}</span>
        ) : (
          <span className="dialogue__error">{errorText(notice!.error)}</span>
        )
      break
    case 'working':
      body = (
        <span>
          {working!.verb}
          {working!.target !== null && <> {working!.target}</>}
        </span>
      )
      break
    case 'thinking':
      body = (
        <span className="dialogue__dots" aria-label="Thinking">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      )
      break
    default:
      body = <span className="dialogue__muted">{empty ? 'What should we work on?' : ''}</span>
  }

  return (
    <section
      className="dialogue"
      aria-label={`${agentName} says`}
      tabIndex={0}
      onClick={skip}
      onKeyDown={handleKeyDown}
    >
      <div className="dialogue__name">{agentName}</div>
      <div ref={bodyRef} className={`dialogue__body dialogue__body--${kind}`}>
        {body}
      </div>
      {request && (
        <PermissionActions
          name={request.name}
          request={request.permission!}
          projectPath={projectPath}
          position={position}
          onAnswer={onAnswer}
        />
      )}
      <p className="visually-hidden" aria-live="polite">
        {announce}
      </p>
    </section>
  )
}

export default DialogueBox
