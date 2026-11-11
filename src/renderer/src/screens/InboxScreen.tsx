import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { AgentError, ProjectInfo } from '../../../shared/ipc'
import type { Conversation, ConversationItem } from '../hooks/useConversation'
import ToolCard from '../components/ToolCard'
import './Screen.css'
import './InboxScreen.css'

type InboxScreenProps = {
  project: ProjectInfo | null
  projectLoaded: boolean
  onOpenProject: () => void
  conversation: Conversation
}

function errorText(error: AgentError): string {
  switch (error.code) {
    case 'not_signed_in':
      return 'MyClaud uses your Claude Code login. Open a terminal, run `claude`, sign in with /login, then try again.'
    case 'api_key_in_use':
      return 'An API key is set for Claude Code on this machine, so this would be billed to the API. Remove it and try again.'
    case 'rate_limit':
      return "You've reached your Claude plan's usage limit, or Claude is busy. Try again later."
    case 'overloaded':
      return 'Claude is busy or rate limited. Try again in a moment.'
    default:
      return `The request failed: ${error.message}`
  }
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

// How close to the bottom (px) still counts as "at the bottom" for auto-scroll.
const STICK_THRESHOLD = 24

function InboxScreen({
  project,
  projectLoaded,
  onOpenProject,
  conversation
}: InboxScreenProps): React.JSX.Element {
  const { items, status, running, send, stop, answerPermission } = conversation
  const [input, setInput] = useState('')
  const historyRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  // Keep the history scrolled to the bottom while it grows, unless the user scrolled up.
  useEffect(() => {
    const el = historyRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [items, status])

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

  if (!projectLoaded) {
    return <section className="screen inbox" aria-label="Inbox" />
  }

  if (!project) {
    return (
      <section className="screen inbox" aria-labelledby="inbox-title">
        <h1 id="inbox-title" className="screen__title">
          INBOX
        </h1>
        <p className="screen__note">Open a project folder to start a conversation.</p>
        <div>
          <button
            type="button"
            className="button button--primary inbox__open"
            onClick={onOpenProject}
          >
            OPEN PROJECT
          </button>
        </div>
      </section>
    )
  }

  // "Thinking..." while running, unless text is growing or a card is running.
  const last = items[items.length - 1]
  const thinking =
    status === 'running' &&
    last?.kind !== 'text' &&
    !(last?.kind === 'tool' && last.state === 'running')

  return (
    <section className="screen inbox" aria-labelledby="inbox-title">
      <h1 id="inbox-title" className="screen__title">
        INBOX
      </h1>

      <div
        ref={historyRef}
        className="inbox__history"
        onScroll={handleScroll}
        aria-live="polite"
        aria-busy={status === 'running'}
      >
        {toBlocks(items).map((block) => {
          if (block.kind === 'tools') {
            return (
              <div key={block.id} className="inbox__tools">
                {block.tools.map((tool) => (
                  <ToolCard
                    key={tool.id}
                    name={tool.name}
                    input={tool.input}
                    state={tool.state}
                    permission={tool.permission}
                    projectPath={project.path}
                    onAnswer={answerPermission}
                  />
                ))}
              </div>
            )
          }
          const { item } = block
          switch (item.kind) {
            case 'user':
              return (
                <p key={item.id} className="inbox__prompt">
                  {item.text}
                </p>
              )
            case 'text':
              return (
                <p key={item.id} className="inbox__text">
                  {item.text}
                </p>
              )
            case 'notice':
              return item.notice.type === 'stopped' ? (
                <p key={item.id} className="inbox__status">
                  Stopped.
                </p>
              ) : (
                <p key={item.id} className="inbox__error">
                  {errorText(item.notice.error)}
                </p>
              )
            default:
              return null
          }
        })}
        {thinking && <p className="inbox__status">Thinking...</p>}
      </div>

      <form
        className="inbox__input-row"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <label htmlFor="inbox-input" className="visually-hidden">
          Message
        </label>
        <textarea
          id="inbox-input"
          className="inbox__input"
          rows={2}
          placeholder="Ask about this project..."
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

export default InboxScreen
