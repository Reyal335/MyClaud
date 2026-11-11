import { DEFAULT_MASCOT } from './defaultMascot'
import type { Mascot } from './types'

// The mascot the app shows. Always the default for now; the mascot manager
// (step 6) changes only this hook.
export function useActiveMascot(): Mascot {
  return DEFAULT_MASCOT
}
