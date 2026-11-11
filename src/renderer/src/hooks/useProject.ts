import { useCallback, useEffect, useState } from 'react'
import type { ProjectInfo } from '../../../shared/ipc'

export type ProjectState = {
  project: ProjectInfo | null
  // False until the saved project has been read, so the UI does not flash "no project".
  loaded: boolean
  // Resolves to the newly opened project, or null when cancelled.
  openProject: () => Promise<ProjectInfo | null>
}

export function useProject(): ProjectState {
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.myclaud.project
      .get()
      .then((saved) => {
        if (!cancelled) setProject(saved)
      })
      .catch((err: unknown) => {
        console.error('Could not load the project:', err)
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const openProject = useCallback(async (): Promise<ProjectInfo | null> => {
    const opened = await window.myclaud.project.open()
    if (opened) setProject(opened)
    return opened
  }, [])

  return { project, loaded, openProject }
}
