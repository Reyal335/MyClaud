import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { AgentError, AgentEvent } from '../../../shared/ipc'

export type ConversationStatus = 'idle' | 'running' | 'done' | 'stopped' | 'error'

export type ConversationState = {
  prompt: string | null
  reply: string
  status: ConversationStatus
  error: AgentError | null
}

type Action =
  | { type: 'start'; prompt: string }
  | { type: 'event'; event: AgentEvent }
  | { type: 'failed'; error: AgentError }
  | { type: 'reset' }

const initialState: ConversationState = { prompt: null, reply: '', status: 'idle', error: null }

function reducer(state: ConversationState, action: Action): ConversationState {
  switch (action.type) {
    case 'start':
      return { prompt: action.prompt, reply: '', status: 'running', error: null }
    case 'failed':
      return { ...state, status: 'error', error: action.error }
    case 'reset':
      return initialState
    case 'event': {
      const { event } = action
      switch (event.type) {
        case 'text':
          return { ...state, reply: state.reply + event.text }
        case 'done':
          return { ...state, status: 'done' }
        case 'stopped':
          return { ...state, status: 'stopped' }
        case 'error':
          return { ...state, status: 'error', error: { code: event.code, message: event.message } }
      }
    }
  }
  return state
}

function isTerminal(event: AgentEvent): boolean {
  return event.type !== 'text'
}

export type Conversation = ConversationState & {
  running: boolean
  send: (prompt: string) => void
  stop: () => void
  reset: () => void
}

// One conversation. Held in App, above the screens, so a running reply
// survives switching screens.
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

  const reset = useCallback((): void => {
    if (currentRequest.current === null) dispatch({ type: 'reset' })
  }, [])

  return { ...state, running: state.status === 'running', send, stop, reset }
}
