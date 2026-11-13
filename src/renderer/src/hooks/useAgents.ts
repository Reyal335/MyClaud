import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentFolders, AgentSummary } from '../../../shared/ipc'

export type AgentsState = {
  agents: AgentSummary[]
  folders: AgentFolders | null
  loaded: boolean
  error: string | null
  reload: () => Promise<void>
}

// The agent list. Reloads on mount, when the window regains focus, and when the
// project changes. There is no file watcher.
export function useAgents(projectPath: string | null): AgentsState {
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [folders, setFolders] = useState<AgentFolders | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Only the latest request may update the list.
  const latest = useRef(0)

  const reload = useCallback((): Promise<void> => {
    const request = ++latest.current
    return window.mya.agents.list().then(
      (result) => {
        if (request !== latest.current) return
        if (result.ok) {
          setAgents(result.agents)
          setFolders(result.folders)
          setError(null)
        } else {
          setError(result.error.message)
        }
        setLoaded(true)
      },
      (err: unknown) => {
        console.error('Could not list agents:', err)
        if (request !== latest.current) return
        setError('The agents could not be loaded.')
        setLoaded(true)
      }
    )
  }, [])

  useEffect(() => {
    void reload()
    const onFocus = (): void => void reload()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [reload, projectPath])

  return { agents, folders, loaded, error, reload }
}
