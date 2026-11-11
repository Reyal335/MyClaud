import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { AgentError, AgentEvent, PermissionDecision, ToolInput } from '../../../shared/ipc'

export type ConversationStatus = 'idle' | 'running' | 'waiting' | 'done' | 'error'

export type ToolState = 'running' | 'waiting' | 'done' | 'failed' | 'denied' | 'stopped'

export type PermissionRequest = {
  permissionId: string
  input: ToolInput
  truncated: boolean
  // True after APPROVE or DENY was clicked, until permission_resolved arrives.
  answering: boolean
}

export type ConversationItem =
  | { kind: 'user'; id: number; text: string }
  | { kind: 'text'; id: number; text: string }
  | {
      kind: 'tool'
      id: number
      toolId: string
      name: string
      input: ToolInput | null
      truncated: boolean
      state: ToolState
      permission: PermissionRequest | null
    }
  | {
      kind: 'notice'
      id: number
      notice: { type: 'stopped' } | { type: 'error'; error: AgentError }
    }

type ToolItem = Extract<ConversationItem, { kind: 'tool' }>

// `status` here is never 'waiting': that is derived from pending permission requests.
type State = {
  items: ConversationItem[]
  status: Exclude<ConversationStatus, 'waiting'>
  nextId: number
}

type Action =
  | { type: 'start'; prompt: string }
  | { type: 'event'; event: AgentEvent }
  | { type: 'failed'; error: AgentError }
  | { type: 'answering'; permissionId: string; answering: boolean }
  | { type: 'reset' }

const initialState: State = { items: [], status: 'idle', nextId: 1 }

function append(state: State, item: DistributiveOmit<ConversationItem, 'id'>): State {
  return {
    ...state,
    items: [...state.items, { ...item, id: state.nextId } as ConversationItem],
    nextId: state.nextId + 1
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

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

function hasTool(state: State, toolId: string): boolean {
  return state.items.some((item) => item.kind === 'tool' && item.toolId === toolId)
}

// When a run ends for any reason, cards still running or waiting become stopped.
function stopOpenTools(state: State): State {
  return updateTool(
    state,
    (item) => item.state === 'running' || item.state === 'waiting',
    (item) => ({ ...item, state: 'stopped', permission: null })
  )
}

function newTool(toolId: string, name: string): DistributiveOmit<ConversationItem, 'id'> {
  return {
    kind: 'tool',
    toolId,
    name,
    input: null,
    truncated: false,
    state: 'running',
    permission: null
  }
}

function applyEvent(state: State, event: AgentEvent): State {
  switch (event.type) {
    case 'text': {
      // Append to the current text item. A tool card closes it, so text after a
      // tool call starts a new item.
      const last = state.items[state.items.length - 1]
      if (last?.kind === 'text') {
        const items = state.items.slice(0, -1)
        items.push({ ...last, text: last.text + event.text })
        return { ...state, items }
      }
      return append(state, { kind: 'text', text: event.text })
    }

    case 'tool_start':
      return hasTool(state, event.toolId) ? state : append(state, newTool(event.toolId, event.name))

    case 'tool_input': {
      const withCard = hasTool(state, event.toolId)
        ? state
        : append(state, newTool(event.toolId, ''))
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
        : append(state, newTool(event.toolId, event.name))
      return updateTool(
        withCard,
        (item) => item.toolId === event.toolId,
        (item) => ({
          ...item,
          name: item.name || event.name,
          input: item.input ?? event.input,
          truncated: item.input ? item.truncated : event.truncated,
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

    case 'done':
      return { ...stopOpenTools(state), status: 'done' }

    case 'stopped':
      return {
        ...append(stopOpenTools(state), { kind: 'notice', notice: { type: 'stopped' } }),
        status: 'idle'
      }

    case 'error':
      return {
        ...append(stopOpenTools(state), {
          kind: 'notice',
          notice: { type: 'error', error: { code: event.code, message: event.message } }
        }),
        status: 'error'
      }
  }
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'start':
      return { ...append(state, { kind: 'user', text: action.prompt }), status: 'running' }
    case 'failed':
      return {
        ...append(state, { kind: 'notice', notice: { type: 'error', error: action.error } }),
        status: 'error'
      }
    case 'answering':
      return updateTool(
        state,
        (item) => item.permission?.permissionId === action.permissionId,
        (item) => ({
          ...item,
          permission: item.permission && { ...item.permission, answering: action.answering }
        })
      )
    case 'reset':
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
  send: (prompt: string) => void
  stop: () => void
  answerPermission: (permissionId: string, decision: PermissionDecision) => void
  reset: () => void
}

// One conversation, as an ordered list of items. Held in App, above the screens,
// so it survives switching screens. In memory only.
export function useConversation(): Conversation {
  const [state, dispatch] = useReducer(reducer, initialState)

  // The run whose events we show. 'pending' while agent:send has not returned,
  // in which case events are buffered until the requestId is known.
  const currentRequest = useRef<string | 'pending' | null>(null)
  const buffered = useRef<AgentEvent[]>([])

  const apply = useCallback((event: AgentEvent): void => {
    if (event.requestId !== currentRequest.current) return
    dispatch({ type: 'event', event })
    if (isTerminal(event)) currentRequest.current = null
  }, [])

  useEffect(() => {
    return window.myclaud.agent.onEvent((event) => {
      if (currentRequest.current === 'pending') {
        buffered.current.push(event)
      } else {
        apply(event)
      }
    })
  }, [apply])

  const send = useCallback(
    (prompt: string): void => {
      if (prompt.trim() === '' || currentRequest.current !== null) return

      currentRequest.current = 'pending'
      buffered.current = []
      dispatch({ type: 'start', prompt })

      window.myclaud.agent
        .send(prompt)
        .then((result) => {
          const early = buffered.current
          buffered.current = []
          if (result.ok) {
            currentRequest.current = result.requestId
            early.forEach(apply)
          } else {
            currentRequest.current = null
            dispatch({ type: 'failed', error: result.error })
          }
        })
        .catch((err: unknown) => {
          buffered.current = []
          currentRequest.current = null
          dispatch({
            type: 'failed',
            error: { code: 'sdk_error', message: err instanceof Error ? err.message : String(err) }
          })
        })
    },
    [apply]
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

  const reset = useCallback((): void => {
    if (currentRequest.current === null) dispatch({ type: 'reset' })
  }, [])

  const waiting =
    state.status === 'running' &&
    state.items.some((item) => item.kind === 'tool' && item.permission !== null)
  const status: ConversationStatus = waiting ? 'waiting' : state.status

  return {
    items: state.items,
    status,
    running: state.status === 'running',
    send,
    stop,
    answerPermission,
    reset
  }
}
