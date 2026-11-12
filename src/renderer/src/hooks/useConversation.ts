import { useCallback, useEffect, useReducer, useRef } from 'react'
import type {
  AgentCallRef,
  AgentError,
  AgentEvent,
  ChatHistory,
  HistoryItem,
  MessageDelivery,
  PermissionDecision,
  TaskAgent,
  TaskStatus,
  ToolInput,
  ToolState
} from '../../../shared/ipc'
import type { ReplyMeta } from '../../../shared/models'

export type { ToolState }

export type ConversationStatus = 'idle' | 'running' | 'waiting' | 'done' | 'error'

export type PermissionRequest = {
  permissionId: string
  input: ToolInput
  truncated: boolean
  // True after APPROVE or DENY was clicked, until permission_resolved arrives.
  answering: boolean
}

export type ConversationItem =
  // `call` is the agent I called for this message, shown as a chip. `messageId` is
  // the id main reports its delivery under (null for loaded history). `delivery` is
  // queued only for a message sent while a run was going, until Claude takes it in.
  | {
      kind: 'user'
      id: number
      text: string
      call: TaskAgent | null
      messageId: string | null
      delivery: MessageDelivery
    }
  // `instant` text came from loaded history and never types out. `meta` is what the
  // reply was made with, for its tag: null when not known.
  | { kind: 'text'; id: number; text: string; instant: boolean; meta: ReplyMeta | null }
  | {
      kind: 'tool'
      id: number
      toolId: string
      name: string
      input: ToolInput | null
      truncated: boolean
      state: ToolState
      permission: PermissionRequest | null
      // The task this call was made in, or null for the main conversation. Task
      // calls are the task's activity: they are not shown in the history.
      taskId: string | null
    }
  | {
      kind: 'task'
      id: number
      taskId: string
      agent: TaskAgent
      description: string
      // running until the task ends. Waiting is derived from its pending requests.
      status: TaskStatus
      report: string | null
    }
  | {
      kind: 'notice'
      id: number
      notice:
        { type: 'stopped' } | { type: 'error'; error: AgentError } | { type: 'info'; text: string }
    }

export type ToolItem = Extract<ConversationItem, { kind: 'tool' }>
export type TaskItem = Extract<ConversationItem, { kind: 'task' }>

// What I call for my next message: the agent to send with, and how it looks.
export type CallTarget = { ref: AgentCallRef; agent: TaskAgent }

// `status` here is never 'waiting': that is derived from pending permission requests.
type State = {
  items: ConversationItem[]
  status: Exclude<ConversationStatus, 'waiting'>
  nextId: number
  // The project whose saved history was loaded (or found empty), so it loads once.
  historyFor: string | null
  // A line at the top of the history: more than 200 messages, or none readable.
  historyNote: 'truncated' | 'unavailable' | null
  // The model and level of the reply now starting, and the time spent thinking since
  // the last reply text. The next reply text takes them for its tag.
  reply: ReplyMeta | null
}

type Action =
  // `queued`: the message is sent while a run is going, so it waits for Claude.
  | { type: 'start'; prompt: string; call: TaskAgent | null; messageId: string; queued: boolean }
  // The send started a new run, so its message did not queue behind anything.
  | { type: 'began'; messageId: string }
  | { type: 'event'; event: AgentEvent }
  // Nothing was sent and no run is going.
  | { type: 'failed'; error: AgentError }
  // Nothing was sent, but the run that was going goes on.
  | { type: 'refused'; messageId: string; error: AgentError }
  | { type: 'answering'; permissionId: string; answering: boolean }
  | { type: 'loaded'; projectPath: string; history: ChatHistory }
  | { type: 'clear' }

const initialState: State = {
  items: [],
  status: 'idle',
  nextId: 1,
  historyFor: null,
  historyNote: null,
  reply: null
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

function append(state: State, item: DistributiveOmit<ConversationItem, 'id'>): State {
  return {
    ...state,
    items: [...state.items, { ...item, id: state.nextId } as ConversationItem],
    nextId: state.nextId + 1
  }
}

function updateTool(
  state: State,
  match: (item: ToolItem) => boolean,
  change: (item: ToolItem) => ToolItem
): State {
  let changed = false
  const items = state.items.map((item) => {
    if (item.kind !== 'tool' || !match(item)) return item
    changed = true
    return change(item)
  })
  return changed ? { ...state, items } : state
}

function updateTask(state: State, taskId: string, change: (item: TaskItem) => TaskItem): State {
  let changed = false
  const items = state.items.map((item) => {
    if (item.kind !== 'task' || item.taskId !== taskId) return item
    changed = true
    return change(item)
  })
  return changed ? { ...state, items } : state
}

function setDelivery(state: State, messageId: string, delivery: MessageDelivery): State {
  let changed = false
  const items = state.items.map((item) => {
    if (item.kind !== 'user' || item.messageId !== messageId || item.delivery === delivery) {
      return item
    }
    // A message that was taken in stays taken in, whatever arrives after.
    if (item.delivery === 'received') return item
    changed = true
    return { ...item, delivery }
  })
  return changed ? { ...state, items } : state
}

function hasTool(state: State, toolId: string): boolean {
  return state.items.some((item) => item.kind === 'tool' && item.toolId === toolId)
}

// When a run ends for any reason, cards still running or waiting become stopped,
// and so do tasks that did not end.
function stopOpenWork(state: State): State {
  const stopped = updateTool(
    state,
    (item) => item.state === 'running' || item.state === 'waiting',
    (item) => ({ ...item, state: 'stopped', permission: null })
  )
  const items = stopped.items.map((item) =>
    item.kind === 'task' && (item.status === 'running' || item.status === 'waiting')
      ? { ...item, status: 'stopped' as const }
      : item
  )
  return { ...stopped, items }
}

function newTool(
  toolId: string,
  name: string,
  taskId: string | null
): DistributiveOmit<ConversationItem, 'id'> {
  return {
    kind: 'tool',
    toolId,
    name,
    input: null,
    truncated: false,
    state: 'running',
    permission: null,
    taskId
  }
}

function applyEvent(state: State, event: AgentEvent): State {
  switch (event.type) {
    case 'text': {
      // Append to the current text item. A tool card or an agent card closes it, so
      // text after one starts a new item.
      const last = state.items[state.items.length - 1]
      if (last?.kind === 'text') {
        const items = state.items.slice(0, -1)
        items.push({ ...last, text: last.text + event.text })
        return { ...state, items }
      }
      // A new reply text takes the tag made for it, and starts counting thinking again.
      return {
        ...append(state, {
          kind: 'text',
          text: event.text,
          instant: false,
          meta: state.reply
        }),
        reply: state.reply && { ...state.reply, thoughtMs: 0 }
      }
    }

    case 'reply_start':
      return {
        ...state,
        reply: { model: event.model, level: event.level, thoughtMs: state.reply?.thoughtMs ?? 0 }
      }

    case 'thought':
      return {
        ...state,
        reply: {
          model: state.reply?.model ?? null,
          level: state.reply?.level ?? null,
          thoughtMs: (state.reply?.thoughtMs ?? 0) + event.ms
        }
      }

    case 'tool_start':
      return hasTool(state, event.toolId)
        ? state
        : append(state, newTool(event.toolId, event.name, event.taskId))

    case 'tool_input': {
      const withCard = hasTool(state, event.toolId)
        ? state
        : append(state, newTool(event.toolId, '', event.taskId))
      return updateTool(
        withCard,
        (item) => item.toolId === event.toolId,
        (item) => ({ ...item, input: event.input, truncated: event.truncated })
      )
    }

    case 'tool_end':
      return updateTool(
        state,
        (item) => item.toolId === event.toolId,
        (item) => ({ ...item, state: event.state, permission: null })
      )

    case 'permission_request': {
      const withCard = hasTool(state, event.toolId)
        ? state
        : append(state, newTool(event.toolId, event.name, event.taskId))
      return updateTool(
        withCard,
        (item) => item.toolId === event.toolId,
        (item) => ({
          ...item,
          name: item.name || event.name,
          input: item.input ?? event.input,
          truncated: item.input ? item.truncated : event.truncated,
          taskId: item.taskId ?? event.taskId,
          state: 'waiting',
          permission: {
            permissionId: event.permissionId,
            input: event.input,
            truncated: event.truncated,
            answering: false
          }
        })
      )
    }

    // Either answer puts the card back to running. Its final state comes from
    // tool_end (denied for a user's Deny), or from the run ending (stopped).
    case 'permission_resolved':
      return updateTool(
        state,
        (item) => item.permission?.permissionId === event.permissionId,
        (item) => ({ ...item, state: 'running', permission: null })
      )

    case 'task_start':
      if (state.items.some((item) => item.kind === 'task' && item.taskId === event.taskId)) {
        return state
      }
      return append(state, {
        kind: 'task',
        taskId: event.taskId,
        agent: event.agent,
        description: event.description,
        status: 'running',
        report: null
      })

    case 'task_end':
      return updateTask(state, event.taskId, (item) => ({
        ...item,
        status: event.status,
        report: event.status === 'stopped' ? item.report : event.report
      }))

    case 'message_state':
      return setDelivery(state, event.messageId, event.state)

    case 'notice':
      return append(state, { kind: 'notice', notice: { type: 'info', text: event.text } })

    case 'done':
      return { ...stopOpenWork(state), status: 'done', reply: null }

    case 'stopped':
      return {
        ...append(stopOpenWork(state), { kind: 'notice', notice: { type: 'stopped' } }),
        status: 'idle',
        reply: null
      }

    case 'error':
      return {
        ...append(stopOpenWork(state), {
          kind: 'notice',
          notice: { type: 'error', error: { code: event.code, message: event.message } }
        }),
        status: 'error',
        reply: null
      }
  }
}

function fromHistory(item: HistoryItem): DistributiveOmit<ConversationItem, 'id'> {
  switch (item.kind) {
    case 'user':
      return { ...item, messageId: null, delivery: 'received' }
    case 'text':
      return {
        kind: 'text',
        text: item.text,
        instant: true,
        // The saved chat keeps the model, not the level or the thinking time.
        meta: item.model ? { model: item.model, level: null, thoughtMs: 0 } : null
      }
    case 'tool':
      return { ...item, permission: null, taskId: null }
    case 'task':
      return {
        kind: 'task',
        taskId: item.taskId,
        agent: item.agent,
        description: item.description,
        status: item.status,
        report: item.report
      }
  }
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'start':
      return {
        ...append(state, {
          kind: 'user',
          text: action.prompt,
          call: action.call,
          messageId: action.messageId,
          delivery: action.queued ? 'queued' : 'received'
        }),
        status: 'running'
      }
    case 'began': {
      // The message started its own run: it is not queued, and a run is going now
      // even if the run it first looked like it joined has just ended.
      const taken = setDelivery(state, action.messageId, 'received')
      return taken.status === 'running' ? taken : { ...taken, status: 'running' }
    }
    case 'failed':
      return {
        ...append(state, { kind: 'notice', notice: { type: 'error', error: action.error } }),
        status: 'error'
      }
    case 'refused':
      // The message was not sent, so it is not waiting for anything.
      return append(setDelivery(state, action.messageId, 'received'), {
        kind: 'notice',
        notice: { type: 'error', error: action.error }
      })
    case 'answering':
      return updateTool(
        state,
        (item) => item.permission?.permissionId === action.permissionId,
        (item) => ({
          ...item,
          permission: item.permission && { ...item.permission, answering: action.answering }
        })
      )
    case 'loaded': {
      // Only into an empty conversation: anything said meanwhile wins.
      if (state.items.length > 0 || state.status === 'running') {
        return { ...state, historyFor: action.projectPath }
      }
      let next: State = {
        ...state,
        historyFor: action.projectPath,
        historyNote: action.history.unavailable
          ? 'unavailable'
          : action.history.truncated
            ? 'truncated'
            : null
      }
      for (const item of action.history.items) next = append(next, fromHistory(item))
      return next
    }
    case 'clear':
      return initialState
    case 'event':
      return applyEvent(state, action.event)
  }
}

function isTerminal(event: AgentEvent): boolean {
  return event.type === 'done' || event.type === 'stopped' || event.type === 'error'
}

export type Conversation = {
  items: ConversationItem[]
  status: ConversationStatus
  // True while a run is in progress, waiting for approval or not.
  running: boolean
  historyNote: 'truncated' | 'unavailable' | null
  send: (prompt: string, call?: CallTarget | null) => void
  stop: () => void
  answerPermission: (permissionId: string, decision: PermissionDecision) => void
  // Loads the project's saved conversation once, if nothing is in memory.
  loadHistory: (projectPath: string) => void
  // Clears what is shown, for a project switch. The saved session stays.
  clear: () => void
  // NEW CHAT: forgets the project's saved session too.
  newChat: () => Promise<AgentError | null>
}

// The main conversation, as an ordered list of items. Held in App, above the
// screens, so it survives switching screens. History comes back from the saved
// session after a restart.
export function useConversation(): Conversation {
  const [state, dispatch] = useReducer(reducer, initialState)

  // The run whose events we show: its requestId, or null when none is going. A
  // run ends with exactly one terminal event, which clears this.
  const liveRun = useRef<string | null>(null)
  // Sends whose answer has not come back. While any is out, events from a run we
  // do not know yet are kept in `early`: the send may be about to start that run.
  const sendsOut = useRef(0)
  const early = useRef<AgentEvent[]>([])
  const historyRequested = useRef<string | null>(null)

  const apply = useCallback((event: AgentEvent): void => {
    if (event.requestId !== liveRun.current) return
    dispatch({ type: 'event', event })
    if (isTerminal(event)) liveRun.current = null
  }, [])

  useEffect(() => {
    return window.myclaud.agent.onEvent((event) => {
      if (event.requestId === liveRun.current) apply(event)
      else if (sendsOut.current > 0) early.current.push(event)
    })
  }, [apply])

  // Called when a send comes back with the run its message is in.
  const adoptRun = useCallback(
    (requestId: string): void => {
      if (liveRun.current === requestId) return
      liveRun.current = requestId
      const mine = early.current.filter((event) => event.requestId === requestId)
      early.current = early.current.filter((event) => event.requestId !== requestId)
      mine.forEach(apply)
    },
    [apply]
  )

  const send = useCallback(
    (prompt: string, call?: CallTarget | null): void => {
      if (prompt.trim() === '') return

      // A message sent while a run is going goes into that run. Main decides: if
      // the run has just ended, the answer says the message started a new one.
      const messageId = crypto.randomUUID()
      const queued = liveRun.current !== null || sendsOut.current > 0
      sendsOut.current++
      dispatch({ type: 'start', prompt, call: call?.agent ?? null, messageId, queued })

      const finish = (): void => {
        sendsOut.current--
        if (sendsOut.current === 0) early.current = []
      }
      const failed = (error: AgentError): void => {
        // With a run going, only this message failed. Otherwise the send itself did.
        const runGoes = liveRun.current !== null || sendsOut.current > 0
        dispatch(runGoes ? { type: 'refused', messageId, error } : { type: 'failed', error })
      }

      window.myclaud.agent
        .send(prompt, call?.ref ?? null, messageId)
        .then((result) => {
          if (!result.ok) {
            finish()
            failed(result.error)
            return
          }
          // A new run: its message is not queued, and the status is running even
          // if the run this looked like joining ended in the meantime. This goes
          // before the run's events are applied, so a very short run still ends.
          if (!result.joined) dispatch({ type: 'began', messageId })
          adoptRun(result.requestId)
          finish()
        })
        .catch((err: unknown) => {
          finish()
          failed({
            code: 'sdk_error',
            message: err instanceof Error ? err.message : String(err)
          })
        })
    },
    [adoptRun]
  )

  const stop = useCallback((): void => {
    void window.myclaud.agent.stop()
  }, [])

  // Buttons stay disabled after one click until permission_resolved arrives. If main
  // no longer knows the request, enable them again.
  const answerPermission = useCallback(
    (permissionId: string, decision: PermissionDecision): void => {
      dispatch({ type: 'answering', permissionId, answering: true })
      window.myclaud.agent
        .answerPermission(permissionId, decision)
        .then((result) => {
          if (!result.ok) dispatch({ type: 'answering', permissionId, answering: false })
        })
        .catch(() => dispatch({ type: 'answering', permissionId, answering: false }))
    },
    []
  )

  const loadHistory = useCallback((projectPath: string): void => {
    if (historyRequested.current === projectPath) return
    historyRequested.current = projectPath
    window.myclaud.chat
      .history()
      .then((history) => dispatch({ type: 'loaded', projectPath, history }))
      .catch((err: unknown) => {
        console.error('Could not load the conversation:', err)
        dispatch({
          type: 'loaded',
          projectPath,
          history: { items: [], truncated: false, unavailable: true }
        })
      })
  }, [])

  const clear = useCallback((): void => {
    if (liveRun.current !== null || sendsOut.current > 0) return
    historyRequested.current = null
    dispatch({ type: 'clear' })
  }, [])

  const newChat = useCallback(async (): Promise<AgentError | null> => {
    if (liveRun.current !== null || sendsOut.current > 0) {
      return { code: 'busy', message: 'A run is already in progress.' }
    }
    const result = await window.myclaud.chat.reset()
    if (!result.ok) return result.error
    // Nothing to load for this project now: the conversation starts empty.
    dispatch({ type: 'clear' })
    return null
  }, [])

  const waiting =
    state.status === 'running' &&
    state.items.some((item) => item.kind === 'tool' && item.permission !== null)
  const status: ConversationStatus = waiting ? 'waiting' : state.status

  return {
    items: state.items,
    status,
    running: state.status === 'running',
    historyNote: state.historyNote,
    send,
    stop,
    answerPermission,
    loadHistory,
    clear,
    newChat
  }
}
