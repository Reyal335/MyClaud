import { useCallback, useEffect, useRef, useState } from 'react'
import type { DefaultMascotEdits, MascotSummary } from '../../../shared/ipc'
import { DEFAULT_MASCOT_ID } from '../../../shared/mascotRules'

const NO_EDITS: DefaultMascotEdits = { edited: false, name: null, loops: {}, problem: null }

export type MascotsState = {
  // Uploaded mascots only. The screen adds the built-in default.
  mascots: MascotSummary[]
  // The user's edits to the built-in default.
  defaultMascot: DefaultMascotEdits
  activeId: string
  loaded: boolean
  error: string | null
  reload: () => Promise<void>
}

// The uploaded mascots. Reloads on mount, when the window regains focus (to
// pick up folders changed by hand), and when main says the active mascot changed.
export function useMascots(): MascotsState {
  const [mascots, setMascots] = useState<MascotSummary[]>([])
  const [defaultMascot, setDefaultMascot] = useState(NO_EDITS)
  const [activeId, setActiveId] = useState(DEFAULT_MASCOT_ID)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Only the latest request may update the list.
  const latest = useRef(0)

  const reload = useCallback((): Promise<void> => {
    const request = ++latest.current
    return window.myclaud.mascots.list().then(
      (result) => {
        if (request !== latest.current) return
        if (result.ok) {
          setMascots(result.mascots)
          setDefaultMascot(result.defaultMascot)
          setActiveId(result.activeId)
          setError(null)
        } else {
          setError(result.error.message)
        }
        setLoaded(true)
      },
      (err: unknown) => {
        console.error('Could not list mascots:', err)
        if (request !== latest.current) return
        setError('The mascots could not be loaded.')
        setLoaded(true)
      }
    )
  }, [])

  useEffect(() => {
    void reload()
    const onFocus = (): void => void reload()
    window.addEventListener('focus', onFocus)
    const unsubscribe = window.myclaud.mascots.onChanged(onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      unsubscribe()
    }
  }, [reload])

  return { mascots, defaultMascot, activeId, loaded, error, reload }
}
