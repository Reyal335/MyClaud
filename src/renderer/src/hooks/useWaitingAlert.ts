import { useState } from 'react'
import type { TaskSummary } from '../../../shared/ipc'

// True while a thread has started waiting for approval since INBOX was last opened. It
// fills the WAITING pill in the title bar. It is kept in memory only, so after a restart
// it starts false.
//
// It watches the tasks list the inbox already has. A thread counts as newly waiting when
// the previous list had it in another status (a new approval, including a second one on
// the same thread), or when it is a thread that started after this began watching. The
// first list, and threads that were already there (another project's, after a switch),
// are the baseline and never fill it. Opening INBOX clears it, and a thread that starts
// waiting while INBOX is open does not fill it: I am looking at it.
export function useWaitingAlert(
  tasks: TaskSummary[],
  loaded: boolean,
  inboxOpen: boolean
): boolean {
  const [alert, setAlert] = useState(false)
  // The list last looked at, and whether INBOX was open then. State, not refs, so the
  // comparison below can run while rendering, which is how React wants a value derived
  // from props to be kept.
  const [looked, setLooked] = useState<TaskSummary[] | null>(null)
  const [wasInboxOpen, setWasInboxOpen] = useState(inboxOpen)
  const [startedWatching] = useState(() => Date.now())

  if (inboxOpen !== wasInboxOpen) {
    setWasInboxOpen(inboxOpen)
    if (inboxOpen && alert) setAlert(false)
  }

  if (loaded && tasks !== looked) {
    setLooked(tasks)
    if (looked !== null && !inboxOpen) {
      const before = new Map(looked.map((task) => [task.id, task.status]))
      const newlyWaiting = tasks.some((task) => {
        if (task.status !== 'waiting') return false
        const was = before.get(task.id)
        return was === undefined ? task.startedAt >= startedWatching : was !== 'waiting'
      })
      if (newlyWaiting) setAlert(true)
    }
  }

  return alert
}
