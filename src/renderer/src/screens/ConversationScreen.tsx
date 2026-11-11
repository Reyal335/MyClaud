import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { ProjectInfo } from '../../../shared/ipc'
import type { Conversation, ConversationItem, ConversationStatus } from '../hooks/useConversation'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import { useActiveMascot } from '../mascots/useActiveMascot'
import { loopFor, type MascotStateName } from '../mascots/types'
import { mascotState } from '../conversation/mascotState'
import { useHeldMascotState } from '../conversation/useHeldMascotState'
import { AGENT_NAME } from '../conversation/agentName'
import { errorText, STOPPED_TEXT } from '../conversation/noticeText'
import ToolCard from '../components/ToolCard'
import Mascot from '../components/Mascot'
import DialogueBox from '../components/DialogueBox'
import { toolLabel } from '../components/toolLabel'
import './ConversationScreen.css'

type ConversationScreenProps = {
  project: ProjectInfo
  conversation: Conversation
}

type ToolItem = Extract<ConversationItem, { kind: 'tool' }>

// Consecutive tool cards share one wrapping row, as in the mockup.
type Block =
  { kind: 'item'; item: ConversationItem } | { kind: 'tools'; id: number; tools: ToolItem[] }

function toBlocks(items: ConversationItem[]): Block[] {
  const blocks: Block[] = []
  for (const item of items) {
    const last = blocks[blocks.length - 1]
    if (item.kind === 'tool') {
      if (last?.kind === 'tools') last.tools.push(item)
      else blocks.push({ kind: 'tools', id: item.id, tools: [item] })
    } else {
      blocks.push({ kind: 'item', item })
    }
  }
  return blocks
}

type HistoryProps = { items: ConversationItem[]; projectPath: string }

function HistoryList({ items, projectPath }: HistoryProps): React.JSX.Element {
  return (
    <>
      {toBlocks(items).map((block) => {
        if (block.kind === 'tools') {
          return (
            <div key={block.id} className="conversation__tools">
              {block.tools.map((tool) => (
                <ToolCard
                  key={tool.id}
                  name={tool.name}
                  input={tool.input}
                  state={tool.state}
                  projectPath={projectPath}
                />
              ))}
            </div>
          )
        }
        const { item } = block
        switch (item.kind) {
          case 'user':
            return (
              <p key={item.id} className="conversation__mine">
                {item.text}
              </p>
            )
          case 'text':
            return (
              <p key={item.id} className="conversation__reply">
                {item.text}
              </p>
            )
          case 'notice':
            return item.notice.type === 'stopped' ? (
              <p key={item.id} className="conversation__stopped">
                {STOPPED_TEXT}
              </p>
            ) : (
              <p key={item.id} className="conversation__error">
                {errorText(item.notice.error)}
              </p>
            )
          default:
            return null
        }
      })}
    </>
  )
}

// Re-renders only when the items it shows change, not while the box types.
const History = memo(
  HistoryList,
  (a, b) =>
    a.projectPath === b.projectPath &&
    a.items.length === b.items.length &&
    a.items.every((item, i) => item === b.items[i])
)

const STATUS_LABELS: Partial<Record<ConversationStatus, string>> = {
  running: 'RUNNING',
  waiting: 'WAITING FOR APPROVAL',
  done: 'DONE',
  error: 'ERROR'
}

// Corner badges from designs/6-mascot-states.html.
const BADGES: Partial<Record<MascotStateName, string>> = {
  thinking: '...',
  talking: 'Aa',
  working: '>_',
  asking: '?'
}

// How close to the bottom (px) still counts as "at the bottom" for auto-scroll.
const STICK_THRESHOLD = 24

// The conversation screen from designs/2-conversation.html: header, history,
// the stage with the mascot and the dialogue box, and the input row.
function ConversationScreen({ project, conversation }: ConversationScreenProps): React.JSX.Element {
  const { items, status, running, send, stop, answerPermission } = conversation
  const reducedMotion = usePrefersReducedMotion()
  const mascot = useActiveMascot()
  const [typing, setTyping] = useState(false)
  const [input, setInput] = useState('')
  const historyRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  const target = mascotState({ items, status, typing })
  const shownState = useHeldMascotState(target)
  const loop = loopFor(mascot, shownState)

  // The last item shows in the dialogue box instead of the history when it is
  // reply text or a notice. It moves up once something comes after it.
  const last = items[items.length - 1]
  const boxItem = last && (last.kind === 'text' || last.kind === 'notice') ? last : null
  const historyItems = useMemo(() => (boxItem ? items.slice(0, -1) : items), [items, boxItem])

  const pending = useMemo(
    () =>
      items.filter((item): item is ToolItem => item.kind === 'tool' && item.permission !== null),
    [items]
  )
  const runningTool = [...items]
    .reverse()
    .find((item): item is ToolItem => item.kind === 'tool' && item.state === 'running')
  const working = runningTool ? toolLabel(runningTool.name, runningTool.input, project.path) : null

  // For screen readers: the latest reply text block that is complete. A block is
  // complete once something follows it or the run has ended.
  const announce = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]
      if (item.kind === 'text' && (i < items.length - 1 || !running)) return item.text
    }
    return ''
  }, [items, running])

  // Keep the history scrolled to the bottom while it grows, unless the user scrolled up.
  useEffect(() => {
    const el = historyRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [historyItems])

  function handleScroll(): void {
    const el = historyRef.current
    if (!el) return
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_THRESHOLD
  }

  function submit(): void {
    if (running || input.trim() === '') return
    stickToBottom.current = true
    send(input)
    setInput('')
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  const statusLabel = STATUS_LABELS[status]
  const badge = BADGES[shownState]

  return (
    <section className="conversation" aria-labelledby="conversation-title">
      <header className="conversation__header">
        <div className="conversation__heading">
          <h1 id="conversation-title" className="conversation__title">
            {AGENT_NAME}
          </h1>
          <div className="conversation__subtitle">In {project.name}</div>
        </div>
        {statusLabel && (
          <span className={`conversation__status conversation__status--${status}`}>
            <span className="conversation__status-square" aria-hidden="true" />
            {statusLabel}
          </span>
        )}
      </header>

      <div
        ref={historyRef}
        className="conversation__history"
        onScroll={handleScroll}
        aria-label="History"
      >
        <History items={historyItems} projectPath={project.path} />
      </div>

      <div className="conversation__stage">
        <div className="stage__mascot">
          <div className="stage__frame">
            <Mascot
              src={loop.src}
              frames={loop.frames}
              fps={loop.fps}
              scale={2}
              label={`Mascot, ${shownState}`}
            />
            {badge && (
              <span className={`stage__badge stage__badge--${shownState}`} aria-hidden="true">
                {badge}
              </span>
            )}
          </div>
          <div className={`stage__tag stage__tag--${shownState}`}>{shownState.toUpperCase()}</div>
        </div>
        <DialogueBox
          agentName={AGENT_NAME}
          reply={boxItem?.kind === 'text' ? { id: boxItem.id, text: boxItem.text } : null}
          notice={boxItem?.kind === 'notice' ? boxItem.notice : null}
          pending={pending}
          working={working}
          running={running}
          empty={items.length === 0}
          announce={announce}
          projectPath={project.path}
          reducedMotion={reducedMotion}
          onAnswer={answerPermission}
          onTypingChange={setTyping}
        />
      </div>

      <form
        className="conversation__input-row"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <label htmlFor="conversation-input" className="visually-hidden">
          Message {AGENT_NAME}
        </label>
        <textarea
          id="conversation-input"
          className="conversation__input"
          rows={1}
          placeholder={`Message ${AGENT_NAME}...`}
          value={input}
          disabled={running}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        {running ? (
          <button type="button" className="button" onClick={stop}>
            STOP
          </button>
        ) : (
          <button type="submit" className="button" disabled={input.trim() === ''}>
            SEND
          </button>
        )}
      </form>
    </section>
  )
}

export default ConversationScreen
