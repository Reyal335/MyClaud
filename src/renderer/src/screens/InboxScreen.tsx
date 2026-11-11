import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { AgentError, ProjectInfo } from '../../../shared/ipc'
import type { Conversation } from '../hooks/useConversation'
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

// How close to the bottom (px) still counts as "at the bottom" for auto-scroll.
const STICK_THRESHOLD = 24

function InboxScreen({
  project,
  projectLoaded,
  onOpenProject,
  conversation
}: InboxScreenProps): React.JSX.Element {
  const { prompt, reply, status, error, running, send, stop } = conversation
  const [input, setInput] = useState('')
  const replyRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  // Keep the reply scrolled to the bottom while it streams, unless the user scrolled up.
  useEffect(() => {
    const el = replyRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [prompt, reply, status, error])

  function handleScroll(): void {
    const el = replyRef.current
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

  return (
    <section className="screen inbox" aria-labelledby="inbox-title">
      <h1 id="inbox-title" className="screen__title">
        INBOX
      </h1>

      <div
        ref={replyRef}
        className="inbox__reply"
        onScroll={handleScroll}
        aria-live="polite"
        aria-busy={running}
      >
        {prompt !== null && <p className="inbox__prompt">{prompt}</p>}
        {reply !== '' && <p className="inbox__text">{reply}</p>}
        {running && reply === '' && <p className="inbox__status">Thinking...</p>}
        {status === 'stopped' && <p className="inbox__status">Stopped.</p>}
        {status === 'error' && error && <p className="inbox__error">{errorText(error)}</p>}
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
