// Pure helpers for a run that stays open while I keep typing. No Electron and no
// SDK here, so they can be tested with fake events.
//
// A run reads its messages from an input queue. The first message starts the
// run; every later one is pushed into the queue while the run is going. The
// SDK's result message does not end the run by itself: the run ends when main
// closes the queue after a result that leaves nothing waiting.

export type InputQueue<T> = {
  // Adds a message. False when the queue is closed: nothing was added, and the
  // caller must start a new run for it.
  push: (item: T) => boolean
  // After this the SDK's input ends once what is queued has been read.
  close: () => void
  readonly closed: boolean
  readonly iterable: AsyncIterable<T>
}

export function createInputQueue<T>(): InputQueue<T> {
  const items: T[] = []
  let wake: (() => void) | null = null
  let closed = false

  async function* read(): AsyncGenerator<T> {
    for (;;) {
      if (items.length > 0) {
        yield items.shift() as T
        continue
      }
      if (closed) return
      await new Promise<void>((resolve) => {
        wake = resolve
      })
    }
  }

  return {
    push(item) {
      if (closed) return false
      items.push(item)
      wake?.()
      return true
    },
    close() {
      closed = true
      wake?.()
    },
    get closed() {
      return closed
    },
    iterable: read()
  }
}

// Messages I sent into a run that was already going. Each one waits ('queued')
// until Claude Code takes it into a turn ('received'), and is done when a result
// says it was answered. The first message of a run is not tracked: it starts the run.
export type MessageTracker = {
  add: (id: string) => void
  // Claude Code started a turn with this message, or took it into the turn in
  // progress. True when it was queued until now.
  started: (id: string) => boolean
  // These messages were answered. Returns the ones whose receipt was not yet
  // reported, so the caller can report it now.
  answered: (ids: readonly string[]) => string[]
  // Claude Code dropped it before answering. True when the id was waiting.
  cancelled: (id: string) => boolean
  // Messages not yet answered: the run must stay open while this is above zero.
  readonly waiting: number
  // The run ended. Returns the messages Claude never took in, and forgets everything.
  undelivered: () => string[]
}

// Puts a message into a run that is going, and starts tracking it. False when the
// queue is closed: the message was not added and the caller starts a new run for
// it. Synchronous, so the run cannot close between the check and the push.
export function pushToRun<T>(
  input: InputQueue<T>,
  messages: MessageTracker,
  item: T,
  id: string
): boolean {
  if (!input.push(item)) return false
  messages.add(id)
  return true
}

// What a turn's result does to the run. `answered` is the result's own list of
// the messages it answered; `ok` is false for a failed turn.
//
// - A failed turn ends the run: the queue closes, and messages still waiting are
//   not delivered.
// - A good turn closes the queue only when nothing is waiting. A message pushed
//   before this point is waiting, so its turn still comes. One pushed after it
//   finds the queue closed and starts a new run.
//
// Returns the messages whose receipt was not yet reported, and whether the run
// must stop reading.
export function settleResult<T>(
  input: InputQueue<T>,
  messages: MessageTracker,
  answered: readonly string[],
  ok: boolean
): { late: string[]; finished: boolean } {
  const late = messages.answered(answered)
  if (!ok) {
    input.close()
    return { late, finished: true }
  }
  if (messages.waiting === 0) input.close()
  return { late, finished: false }
}

export function createMessageTracker(): MessageTracker {
  const state = new Map<string, 'queued' | 'received'>()
  return {
    add(id) {
      state.set(id, 'queued')
    },
    started(id) {
      if (state.get(id) !== 'queued') return false
      state.set(id, 'received')
      return true
    },
    answered(ids) {
      const late: string[] = []
      for (const id of ids) {
        const current = state.get(id)
        if (current === undefined) continue
        if (current === 'queued') late.push(id)
        state.delete(id)
      }
      return late
    },
    cancelled(id) {
      return state.delete(id)
    },
    get waiting() {
      return state.size
    },
    undelivered() {
      const lost = [...state].filter(([, value]) => value === 'queued').map(([id]) => id)
      state.clear()
      return lost
    }
  }
}
