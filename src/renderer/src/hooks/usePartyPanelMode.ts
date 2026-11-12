import { useCallback, useEffect, useState } from 'react'
import type { PartyPanelMode } from '../../../shared/ipc'

// Below this window width the party panel starts as a rail, until I choose.
const WIDE_WINDOW = 1200

function byWidth(): PartyPanelMode {
  return window.innerWidth >= WIDE_WINDOW ? 'open' : 'rail'
}

// The party panel or its rail. Until I press the collapse button the window
// width decides; my choice is then saved in settings.json and wins at every width.
export function usePartyPanelMode(): { mode: PartyPanelMode; toggle: () => void } {
  const [saved, setSaved] = useState<PartyPanelMode | null>(null)
  const [width, setWidth] = useState<PartyPanelMode>(byWidth)

  useEffect(() => {
    let disposed = false
    window.myclaud.ui
      .getPartyPanel()
      .then((mode) => {
        if (!disposed && mode) setSaved((current) => current ?? mode)
      })
      .catch((err: unknown) => console.error('Could not read the party panel setting:', err))
    const onResize = (): void => setWidth(byWidth())
    window.addEventListener('resize', onResize)
    return () => {
      disposed = true
      window.removeEventListener('resize', onResize)
    }
  }, [])

  const mode = saved ?? width
  const toggle = useCallback((): void => {
    const next: PartyPanelMode = mode === 'open' ? 'rail' : 'open'
    setSaved(next)
    window.myclaud.ui
      .setPartyPanel(next)
      .catch((err: unknown) => console.error('Could not save the party panel setting:', err))
  }, [mode])

  return { mode, toggle }
}
