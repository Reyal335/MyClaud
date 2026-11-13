// What the popup shows, as a pure state machine: events in, one state out. No
// Electron and no clock of its own, so it can be tested with fake events and a
// fake time. popupWindow.ts feeds it and draws its view.

import type { PopupAction, PopupOpenTarget, PopupView, PopupWho, ToolInput } from '../shared/ipc'

export const FINISHED_MS = 6_000
export const ERROR_MS = 10_000
// An agent's report waits this long, in case the run ends with it.
export const HOLD_MS = 2_000
export const QUEUE_MAX = 10

// A pending permission request, from the main conversation or from inside an agent.
export type PopupRequest = {
  permissionId: string
  who: PopupWho
  label: string
  name: string
  input: ToolInput
  truncated: boolean
  projectPath: string
  fits: boolean
}

// A finished or error popup.
export type PopupNotice = {
  id: string
  kind: 'finished' | 'error'
  who: PopupWho
  text: string
  open: PopupOpenTarget
}

type Shown =
  | { kind: 'approval'; permissionId: string }
  | {
      kind: 'notice'
      notice: PopupNotice
      // TEST POPUP: shows with popups off and with the app in front.
      test: boolean
      // Time left on the countdown, and when it last started running (null while paused).
      remaining: number
      since: number | null
    }

export type PopupState = {
  enabled: boolean
  // The main window is not focused, or is minimized.
  background: boolean
  // The pointer is over the card.
  hover: boolean
  // Every pending request, oldest first, whether or not a popup shows it.
  requests: PopupRequest[]
  // Requests whose DETAILS were opened, so APPROVE may be offered.
  detailsOpened: string[]
  // Finished and error popups waiting their turn, in the order they happened.
  queue: PopupNotice[]
  // Agents that reported back less than HOLD_MS ago.
  held: { notice: PopupNotice; runId: string; until: number }[]
  shown: Shown | null
}

export type PopupEvent =
  | { type: 'background'; background: boolean }
  | { type: 'enabled'; enabled: boolean }
  | { type: 'request_opened'; request: PopupRequest }
  | { type: 'request_closed'; permissionId: string }
  // An agent's task ended as done or error.
  | { type: 'task_ended'; runId: string; notice: PopupNotice }
  // notice is null for a stopped run.
  | { type: 'run_ended'; runId: string; notice: PopupNotice | null }
  | { type: 'hover'; over: boolean }
  | { type: 'timer' }
  | { type: 'test'; notice: PopupNotice }
  // Acts main already checked with actAllowed. approve and deny change nothing
  // here: the request_closed that follows does.
  | { type: 'act'; id: string; action: PopupAction }

export function initialState(enabled = true): PopupState {
  return {
    enabled,
    background: false,
    hover: false,
    requests: [],
    detailsOpened: [],
    queue: [],
    held: [],
    shown: null
  }
}

function durationOf(notice: PopupNotice): number {
  return notice.kind === 'error' ? ERROR_MS : FINISHED_MS
}

function enqueue(state: PopupState, notice: PopupNotice): void {
  state.queue.push(notice)
  while (state.queue.length > QUEUE_MAX) state.queue.shift()
}

function canShow(state: PopupState): boolean {
  return state.enabled && state.background
}

function apply(state: PopupState, event: PopupEvent, now: number): void {
  switch (event.type) {
    case 'background':
      state.background = event.background
      // In front: nothing shows and nothing is kept for later.
      if (!event.background) {
        state.queue = []
        state.held = []
        if (!(state.shown?.kind === 'notice' && state.shown.test)) state.shown = null
      }
      return
    case 'enabled':
      state.enabled = event.enabled
      if (!event.enabled) {
        state.queue = []
        state.held = []
        if (!(state.shown?.kind === 'notice' && state.shown.test)) state.shown = null
      }
      return
    case 'request_opened':
      if (!state.requests.some((r) => r.permissionId === event.request.permissionId)) {
        state.requests.push(event.request)
      }
      return
    case 'request_closed':
      state.requests = state.requests.filter((r) => r.permissionId !== event.permissionId)
      state.detailsOpened = state.detailsOpened.filter((id) => id !== event.permissionId)
      if (state.shown?.kind === 'approval' && state.shown.permissionId === event.permissionId) {
        state.shown = null
      }
      return
    case 'task_ended':
      if (canShow(state)) {
        state.held.push({ notice: event.notice, runId: event.runId, until: now + HOLD_MS })
      }
      return
    case 'run_ended':
      // An agent that reported back as the run ended: the run's popup only.
      state.held = state.held.filter((held) => held.runId !== event.runId)
      if (event.notice && canShow(state)) enqueue(state, event.notice)
      return
    case 'hover': {
      if (event.over === state.hover) return
      state.hover = event.over
      const shown = state.shown
      if (shown?.kind !== 'notice') return
      if (event.over && shown.since !== null) {
        shown.remaining = Math.max(0, shown.remaining - (now - shown.since))
        shown.since = null
      } else if (!event.over && shown.since === null) {
        shown.since = now
      }
      return
    }
    case 'timer': {
      const due = state.held.filter((held) => held.until <= now)
      state.held = state.held.filter((held) => held.until > now)
      if (canShow(state)) for (const held of due) enqueue(state, held.notice)
      const shown = state.shown
      if (
        shown?.kind === 'notice' &&
        shown.since !== null &&
        shown.since + shown.remaining <= now
      ) {
        state.shown = null
      }
      return
    }
    case 'test': {
      const shown = state.shown
      if (shown?.kind === 'notice' && !shown.test) state.queue.unshift(shown.notice)
      state.shown = {
        kind: 'notice',
        notice: event.notice,
        test: true,
        remaining: FINISHED_MS,
        since: state.hover ? null : now
      }
      return
    }
    case 'act': {
      const shown = state.shown
      if (!shown || idOf(shown) !== event.id) return
      if (event.action === 'details' && shown.kind === 'approval') {
        if (!state.detailsOpened.includes(shown.permissionId)) {
          state.detailsOpened.push(shown.permissionId)
        }
      } else if (event.action === 'dismiss' && shown.kind === 'notice') {
        state.shown = null
      } else if (event.action === 'open') {
        state.shown = null
      }
      return
    }
  }
}

function idOf(shown: Shown): string {
  return shown.kind === 'approval' ? shown.permissionId : shown.notice.id
}

// Picks what shows now: an approval first (the oldest), then the notice already
// up, then the next one in the queue.
function settle(state: PopupState, now: number): void {
  if (canShow(state) && state.requests.length > 0) {
    const shown = state.shown
    if (shown?.kind === 'notice' && !shown.test) {
      // Replaced at once. It goes back to the front of its queue and gets its full time later.
      state.queue.unshift(shown.notice)
      while (state.queue.length > QUEUE_MAX) state.queue.pop()
    }
    state.shown = { kind: 'approval', permissionId: state.requests[0].permissionId }
  } else if (state.shown?.kind === 'approval') {
    state.shown = null
  }

  if (!state.shown && canShow(state)) {
    const next = state.queue.shift()
    if (next) {
      state.shown = {
        kind: 'notice',
        notice: next,
        test: false,
        remaining: durationOf(next),
        since: state.hover ? null : now
      }
    }
  }
  // A hidden popup cannot be hovered, and it may not hear the pointer leave.
  if (!state.shown) state.hover = false
}

function copy(state: PopupState): PopupState {
  return {
    ...state,
    requests: [...state.requests],
    detailsOpened: [...state.detailsOpened],
    queue: [...state.queue],
    held: [...state.held],
    shown: state.shown && { ...state.shown }
  }
}

export function step(state: PopupState, event: PopupEvent, now: number): PopupState {
  const next = copy(state)
  apply(next, event, now)
  settle(next, now)
  return next
}

export function viewOf(state: PopupState): PopupView | null {
  const shown = state.shown
  if (!shown) return null
  if (shown.kind === 'notice') {
    const { id, kind, who, text } = shown.notice
    return { id, kind, who, text }
  }
  const index = state.requests.findIndex((r) => r.permissionId === shown.permissionId)
  if (index < 0) return null
  const request = state.requests[index]
  return {
    id: request.permissionId,
    kind: 'approval',
    who: request.who,
    label: request.label,
    position: { index, total: state.requests.length },
    request: {
      name: request.name,
      input: request.input,
      truncated: request.truncated,
      projectPath: request.projectPath
    },
    fits: request.fits,
    detailsOpen: state.detailsOpened.includes(request.permissionId)
  }
}

// The buttons a popup offers. APPROVE only once the whole request has been shown.
export function offeredActions(view: PopupView): PopupAction[] {
  if (view.kind !== 'approval') return ['open', 'dismiss']
  return ['deny', 'open', view.fits || view.detailsOpen ? 'approve' : 'details']
}

// Main's check on every act from the popup page.
export function actAllowed(state: PopupState, id: unknown, action: unknown): boolean {
  const view = viewOf(state)
  return (
    view !== null &&
    typeof id === 'string' &&
    view.id === id &&
    offeredActions(view).includes(action as PopupAction)
  )
}

// Where OPEN goes for the popup on screen.
export function openTargetOf(state: PopupState): PopupOpenTarget {
  return state.shown?.kind === 'notice' ? state.shown.notice.open : { screen: 'chat' }
}

// When the next timer event is due, or null when nothing is counting down.
export function deadlineOf(state: PopupState): number | null {
  const times = state.held.map((held) => held.until)
  const shown = state.shown
  if (shown?.kind === 'notice' && shown.since !== null) times.push(shown.since + shown.remaining)
  return times.length > 0 ? Math.min(...times) : null
}

// The main window's taskbar button flashes while a request waits in the background.
export function flashOf(state: PopupState): boolean {
  return canShow(state) && state.requests.length > 0
}
