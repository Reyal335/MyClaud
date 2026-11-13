import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { ProjectInfo } from '../../../shared/ipc'
import { toolLabel, type ToolLabel } from '../../../shared/toolLabel'
import type {
  CallTarget,
  Conversation,
  ConversationItem,
  ConversationStatus,
  ToolItem
} from '../hooks/useConversation'
import { useAgents } from '../hooks/useAgents'
import { useChatTheme } from '../hooks/useChatTheme'
import { useModelChoice } from '../hooks/useModelChoice'
import { replyTag, type ModelLists } from '../../../shared/models'
import ModelPicker from '../components/ModelPicker'
import ThemeBackdrop from '../components/ThemeBackdrop'
import ThemePicker from '../components/ThemePicker'
import { usePartyPanelMode } from '../hooks/usePartyPanelMode'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import { useActiveMascot } from '../mascots/useActiveMascot'
import { loopFor, type MascotStateName } from '../mascots/types'
import { mascotState } from '../conversation/mascotState'
import { useHeldMascotState } from '../conversation/useHeldMascotState'
import { AGENT_NAME } from '../conversation/agentName'
import { errorText, STOPPED_TEXT } from '../../../shared/noticeText'
import { partyWork, taskViews, type TaskView } from '../conversation/agentWork'
import { callTargetOf } from '../conversation/callTarget'
import AgentChip from '../components/AgentChip'
import AgentTaskCard from '../components/AgentTaskCard'
import Dialog from '../components/Dialog'
import ToolCard from '../components/ToolCard'
import Mascot from '../components/Mascot'
import DialogueBox from '../components/DialogueBox'
import Markdown from '../components/Markdown'
import { toPlainText } from '../../../shared/plainText'
import PartyPanel from '../components/PartyPanel'
import './ConversationScreen.css'

type ConversationScreenProps = {
  project: ProjectInfo
  conversation: Conversation
  // The agent called for my next message, held in App so AGENTS and INBOX can set it.
  call: CallTarget | null
  onCallChange: (call: CallTarget | null) => void
  // Changes when another screen wants the input focused.
  focusRequest: number
  onOpenTask: (taskId: string) => void
}

// Consecutive tool cards share one wrapping row, as in the mockup. Tool calls
// made inside a task are its activity and show on its card instead.
type Block =
  { kind: 'item'; item: ConversationItem } | { kind: 'tools'; id: number; tools: ToolItem[] }

function toBlocks(items: ConversationItem[]): Block[] {
  const blocks: Block[] = []
  for (const item of items) {
    if (item.kind === 'tool' && item.taskId !== null) continue
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

type HistoryProps = {
  items: ConversationItem[]
  projectPath: string
  views: Map<string, TaskView>
  note: Conversation['historyNote']
  onOpenTask: (taskId: string) => void
  // The models, to name the model on each reply's tag.
  lists: ModelLists | null
}

function HistoryList({
  items,
  projectPath,
  views,
  note,
  onOpenTask,
  lists
}: HistoryProps): React.JSX.Element {
  return (
    <>
      {note === 'truncated' && (
        <p className="conversation__muted">Earlier messages are not shown.</p>
      )}
      {note === 'unavailable' && (
        <p className="conversation__muted">Earlier messages are not available.</p>
      )}
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
              <div key={item.id} className="conversation__mine">
                {item.call && <AgentChip agent={item.call} />}
                <span>{item.text}</span>
                {item.delivery === 'queued' && (
                  <span className="conversation__delivery">QUEUED</span>
                )}
                {item.delivery === 'not_delivered' && (
                  <span className="conversation__undelivered">Not delivered. The run ended.</span>
                )}
              </div>
            )
          case 'text': {
            const tag = item.meta ? replyTag(item.meta, lists) : ''
            return (
              <div key={item.id} className="conversation__reply">
                {tag !== '' && <span className="conversation__tag">{tag}</span>}
                <Markdown source={item.text} />
              </div>
            )
          }
          case 'task': {
            const view = views.get(item.taskId)
            return view ? <AgentTaskCard key={item.id} view={view} onOpen={onOpenTask} /> : null
          }
          case 'notice':
            if (item.notice.type === 'stopped') {
              return (
                <p key={item.id} className="conversation__stopped">
                  {STOPPED_TEXT}
                </p>
              )
            }
            if (item.notice.type === 'info') {
              return (
                <p key={item.id} className="conversation__muted">
                  {item.notice.text}
                </p>
              )
            }
            return (
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
    a.note === b.note &&
    a.views === b.views &&
    a.lists === b.lists &&
    a.onOpenTask === b.onOpenTask &&
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

// The most agents working at once. Main refuses a call past this, and Claude
// Code's own limit is set to the same.
const MAX_AGENTS = 3

// The CHAT screen from designs/8-chat-party.html: the header, then the history
// and the stage in one frame with the input row under it, and the party panel on
// the right.
function ConversationScreen({
  project,
  conversation,
  call,
  onCallChange,
  focusRequest,
  onOpenTask
}: ConversationScreenProps): React.JSX.Element {
  const { items, status, running, send, stop, answerPermission, loadHistory, newChat } =
    conversation
  const reducedMotion = usePrefersReducedMotion()
  const mascot = useActiveMascot(window.myclaud.mascots)
  const { agents, loaded: agentsLoaded } = useAgents(project.path)
  const { mode, toggle } = usePartyPanelMode()
  const modelChoice = useModelChoice(project.path)
  const chatTheme = useChatTheme(project.path)
  const [themeOpen, setThemeOpen] = useState(false)
  const [typing, setTyping] = useState(false)
  const [input, setInput] = useState('')
  const [confirmNew, setConfirmNew] = useState(false)
  const [newChatError, setNewChatError] = useState<string | null>(null)
  const historyRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stickToBottom = useRef(true)

  // The saved conversation comes back once per project, when nothing is in memory.
  useEffect(() => {
    loadHistory(project.path)
  }, [project.path, loadHistory])

  useEffect(() => {
    if (focusRequest > 0) inputRef.current?.focus()
  }, [focusRequest])

  const views = useMemo(() => taskViews(items, project.path), [items, project.path])
  const work = useMemo(() => partyWork(views), [views])

  const target = mascotState({ items, status, typing })
  const shownState = useHeldMascotState(target)
  const loop = loopFor(mascot, shownState)

  // The last item shows in the dialogue box instead of the history when it is
  // reply text or a notice. It moves up once something comes after it.
  const last = items[items.length - 1]
  const boxItem = last && (last.kind === 'text' || last.kind === 'notice') ? last : null
  const historyItems = useMemo(() => (boxItem ? items.slice(0, -1) : items), [items, boxItem])
  // The tag of the reply in the dialogue box: the model that answered and the level.
  const boxTag =
    boxItem?.kind === 'text' && boxItem.meta ? replyTag(boxItem.meta, modelChoice.lists) : ''
  const hasReplies = items.some((item) => item.kind === 'text')

  // Requests from the main conversation and from agents together, oldest first.
  const pending = useMemo(
    () =>
      items.filter((item): item is ToolItem => item.kind === 'tool' && item.permission !== null),
    [items]
  )
  const askingTask = pending[0]?.taskId ? views.get(pending[0].taskId) : undefined
  const asker = askingTask ? askingTask.item.agent : null

  // Agents working or waiting for me. At three, nobody else can be called.
  const openAgents = [...views.values()].filter((view) => view.state !== 'ended').length
  const full = openAgents >= MAX_AGENTS

  // An agent at work names itself: "<agent> is working: Reading src/auth.js". With
  // more than one at work: "2 agents are working".
  let working: ToolLabel | null = null
  const busyTasks = [...views.values()].filter((view) => view.state === 'working')
  const busyTask = busyTasks[busyTasks.length - 1]
  if (busyTasks.length > 1) {
    working = { verb: `${busyTasks.length} agents are working`, target: null }
  } else if (busyTask) {
    const name = busyTask.item.agent.name
    working = busyTask.activity
      ? { verb: `${name} is working:`, target: busyTask.activity }
      : { verb: `${name} is working...`, target: null }
  } else {
    const runningTool = [...items]
      .reverse()
      .find(
        (item): item is ToolItem =>
          item.kind === 'tool' && item.taskId === null && item.state === 'running'
      )
    if (runningTool) working = toolLabel(runningTool.name, runningTool.input, project.path)
  }

  // For screen readers: the latest reply text block that is complete. A block is
  // complete once something follows it or the run has ended.
  const announced = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]
      if (item.kind === 'text' && (i < items.length - 1 || !running)) return item.text
    }
    return ''
  }, [items, running])
  // Read as plain text, so no Markdown marks are read out.
  const announce = useMemo(() => toPlainText(announced), [announced])

  // Keep the history scrolled to the bottom while it grows, unless the user scrolled up.
  useEffect(() => {
    const el = historyRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [historyItems, views])

  function handleScroll(): void {
    const el = historyRef.current
    if (!el) return
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_THRESHOLD
  }

  // Sending works during a run too: main puts the message into the run, and Claude
  // reads it once the agent that is working has finished.
  function submit(): void {
    if (input.trim() === '') return
    stickToBottom.current = true
    send(input, call)
    setInput('')
    // One agent per message: the chip clears after I send.
    onCallChange(null)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  async function startNewChat(): Promise<void> {
    setConfirmNew(false)
    const error = await newChat()
    setNewChatError(error ? error.message : null)
    if (!error) {
      stickToBottom.current = true
      // The new chat starts from the saved defaults, so the control changes with it.
      modelChoice.reload()
      // And with no theme of its own: it shows the default theme.
      chatTheme.reload()
    }
  }

  const statusLabel = STATUS_LABELS[status]
  const badge = BADGES[shownState]
  const placeholder = call
    ? `Message for ${call.agent.name}...`
    : running
      ? `Message ${AGENT_NAME} or call an agent...`
      : `Message ${AGENT_NAME}...`

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
        {/* Works during a run: a theme never touches the agent. */}
        <button
          type="button"
          className="button button--secondary conversation__theme"
          aria-haspopup="dialog"
          disabled={chatTheme.active === null}
          onClick={() => setThemeOpen(true)}
        >
          <span
            aria-hidden="true"
            className={`conversation__swatch${chatTheme.entry.kind === 'none' ? ' conversation__swatch--none' : ''}`}
          />
          THEME: {chatTheme.entry.name.toUpperCase()}
        </button>
        <button
          type="button"
          className="button button--secondary button--small conversation__new"
          disabled={running}
          onClick={() => setConfirmNew(true)}
        >
          NEW CHAT
        </button>
        {newChatError && (
          <p role="alert" className="conversation__header-error">
            {newChatError}
          </p>
        )}
      </header>

      <div className="conversation__body">
        <div className="conversation__main">
          <div className="conversation__frame">
            {/* The theme behind the history and the stage, under its fade. */}
            <ThemeBackdrop image={chatTheme.entry.image} fade={chatTheme.active?.fade ?? 0} />
            <div
              ref={historyRef}
              className="conversation__history"
              onScroll={handleScroll}
              aria-label="History"
            >
              <History
                items={historyItems}
                projectPath={project.path}
                views={views}
                note={conversation.historyNote}
                onOpenTask={onOpenTask}
                lists={modelChoice.lists}
              />
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
                    reverse={loop.reverse}
                  />
                  {badge && (
                    <span className={`stage__badge stage__badge--${shownState}`} aria-hidden="true">
                      {badge}
                    </span>
                  )}
                </div>
                <div className={`stage__tag stage__tag--${shownState}`}>
                  {shownState.toUpperCase()}
                </div>
              </div>
              <DialogueBox
                agentName={AGENT_NAME}
                reply={
                  boxItem?.kind === 'text'
                    ? { id: boxItem.id, text: boxItem.text, instant: boxItem.instant }
                    : null
                }
                notice={boxItem?.kind === 'notice' ? boxItem.notice : null}
                tag={boxTag}
                pending={pending}
                asker={asker}
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
          </div>

          <form
            className="conversation__input-row"
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <ModelPicker
              lists={modelChoice.lists}
              listFailed={modelChoice.listFailed}
              choice={modelChoice.choice}
              asDefault={modelChoice.asDefault}
              onAsDefaultChange={modelChoice.setAsDefault}
              onPick={modelChoice.pick}
              hasReplies={hasReplies}
              onOpen={() => {
                if (modelChoice.listFailed) modelChoice.reload()
              }}
            />
            {call && <AgentChip agent={call.agent} onRemove={() => onCallChange(null)} />}
            <label htmlFor="conversation-input" className="visually-hidden">
              {call ? `Message for ${call.agent.name}` : `Message ${AGENT_NAME}`}
            </label>
            <textarea
              ref={inputRef}
              id="conversation-input"
              className="conversation__input"
              rows={1}
              placeholder={placeholder}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
            />
            {running && (
              <button type="button" className="button" onClick={stop}>
                STOP
              </button>
            )}
            <button type="submit" className="button" disabled={input.trim() === ''}>
              SEND
            </button>
          </form>
        </div>

        <PartyPanel
          agents={agents}
          loaded={agentsLoaded}
          call={call}
          onCall={(agent) => onCallChange(agent ? callTargetOf(agent) : null)}
          full={full}
          work={work}
          mode={mode}
          onToggle={toggle}
          onOpenTask={onOpenTask}
        />
      </div>

      {themeOpen && chatTheme.active && (
        <ThemePicker
          entries={chatTheme.entries}
          active={chatTheme.active}
          ownChoice={chatTheme.ownChoice}
          onApply={chatTheme.apply}
          onAdd={chatTheme.add}
          onRename={chatTheme.rename}
          onRemove={chatTheme.remove}
          onClose={() => setThemeOpen(false)}
        />
      )}

      {confirmNew && (
        <Dialog
          title="NEW CHAT?"
          onClose={() => setConfirmNew(false)}
          actions={
            <>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => setConfirmNew(false)}
              >
                CANCEL
              </button>
              <button
                type="button"
                className="button button--primary"
                onClick={() => void startNewChat()}
              >
                NEW CHAT
              </button>
            </>
          }
        >
          <p>Start a new conversation? The current one is cleared from MyClaud.</p>
        </Dialog>
      )}
    </section>
  )
}

export default ConversationScreen
