import { useCallback, useEffect, useRef, useState } from 'react'
import type { TaskSummary } from '../../../shared/ipc'

export type TasksStore = {
  tasks: TaskSummary[]
  loaded: boolean
  error: string | null
  // Tasks waiting for my approval: the INBOX nav count.
  waitingCount: number
  // Tasks running: the title bar's RUNNING count.
  runningCount: number
  reload: () => void
}

// The open project's tasks. Main keeps them, from the same agent stream the
// conversation shows, and says when they change, so CHAT and INBOX agree.
export function useTasks(projectPath: string | null): TasksStore {
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(0)

  const reload = useCallback((): void => {
    const request = ++latest.current
    window.mya.tasks.list().then(
      (result) => {
        if (request !== latest.current) return
        if (result.ok) {
          setTasks(result.tasks)
          setError(null)
        } else {
          setError(result.error.message)
        }
        setLoaded(true)
      },
      (err: unknown) => {
        console.error('Could not list tasks:', err)
        if (request !== latest.current) return
        setError('The tasks could not be loaded.')
        setLoaded(true)
      }
    )
  }, [])

  useEffect(() => {
    reload()
    return window.mya.tasks.onChanged(reload)
  }, [reload, projectPath])

  const waitingCount = tasks.filter((task) => task.status === 'waiting').length
  const runningCount = tasks.filter((task) => task.status === 'running').length
  return { tasks, loaded, error, waitingCount, runningCount, reload }
}
