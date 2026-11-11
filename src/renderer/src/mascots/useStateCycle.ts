import { useCallback, useEffect, useState } from 'react'
import { MASCOT_STATES } from '../../../shared/mascotRules'
import type { MascotStateName } from './types'

// How long each state shows during a cycle.
export const CYCLE_STEP_MS = 7000

export type StateCycle = {
  // The state showing now, or null when no cycle is running.
  state: MascotStateName | null
  // 1-based place of `state` in MASCOT_STATES, or 0 when no cycle is running.
  step: number
  start: () => void
  stop: () => void
}

// Plays every mascot state once, in MASCOT_STATES order, for CYCLE_STEP_MS each,
// then stops by itself.
export function useStateCycle(): StateCycle {
  const [index, setIndex] = useState<number | null>(null)

  useEffect(() => {
    if (index === null) return
    const timer = window.setTimeout(() => {
      setIndex(index + 1 < MASCOT_STATES.length ? index + 1 : null)
    }, CYCLE_STEP_MS)
    return () => window.clearTimeout(timer)
  }, [index])

  const start = useCallback(() => setIndex(0), [])
  const stop = useCallback(() => setIndex(null), [])

  return {
    state: index === null ? null : MASCOT_STATES[index],
    step: index === null ? 0 : index + 1,
    start,
    stop
  }
}
