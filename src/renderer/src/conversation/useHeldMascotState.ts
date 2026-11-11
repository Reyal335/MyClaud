import { useEffect, useRef, useState } from 'react'
import type { MascotStateName } from '../mascots/types'

const HOLD_MS = 400

// Keeps each mascot state for at least HOLD_MS before leaving it, so quick
// changes do not flicker. asking is the exception: it shows at once.
export function useHeldMascotState(target: MascotStateName): MascotStateName {
  const [shown, setShown] = useState(target)
  const shownSince = useRef(0)

  useEffect(() => {
    if (target === shown) return
    const held = performance.now() - shownSince.current
    const wait = target === 'asking' ? 0 : Math.max(0, HOLD_MS - held)
    const timer = window.setTimeout(() => {
      shownSince.current = performance.now()
      setShown(target)
    }, wait)
    return () => window.clearTimeout(timer)
  }, [target, shown])

  return shown
}
