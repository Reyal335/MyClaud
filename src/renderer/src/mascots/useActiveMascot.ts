import { useEffect, useState } from 'react'
import type { ActiveMascotData } from '../../../shared/ipc'
import { DEFAULT_MASCOT_ID } from '../../../shared/mascotRules'
import { DEFAULT_MASCOT, withDefaultEdits } from './defaultMascot'
import type { Mascot } from './types'

function toMascot(data: ActiveMascotData): Mascot {
  if (data.id === DEFAULT_MASCOT_ID) return withDefaultEdits(data.name, data.loops)
  const { idle } = data.loops
  return data.name !== null && idle
    ? { name: data.name, loops: { ...data.loops, idle } }
    : DEFAULT_MASCOT
}

// The mascot the app shows: the one chosen on the MASCOTS screen. It is the
// bundled default until main answers and whenever anything fails. Main gives the
// default (with the user's edits) when the chosen mascot is missing or broken.
// Updates when main says the active mascot changed, so the conversation
// switches without a restart.
export function useActiveMascot(): Mascot {
  const [mascot, setMascot] = useState<Mascot>(DEFAULT_MASCOT)

  useEffect(() => {
    let disposed = false
    let latest = 0

    const load = (): void => {
      // Only the newest answer counts, if two requests overlap.
      const request = ++latest
      const apply = (next: Mascot): void => {
        if (!disposed && request === latest) setMascot(next)
      }
      window.myclaud.mascots
        .getActive()
        .then((result) => apply(result.ok ? toMascot(result.mascot) : DEFAULT_MASCOT))
        .catch((err: unknown) => {
          console.error('Could not load the active mascot:', err)
          apply(DEFAULT_MASCOT)
        })
    }

    let unsubscribe = (): void => {}
    try {
      unsubscribe = window.myclaud.mascots.onChanged(load)
      load()
    } catch (err) {
      console.error('Could not load the active mascot:', err)
    }
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  return mascot
}
