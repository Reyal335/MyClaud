import type { MascotLoop, MascotLoops } from '../../../shared/ipc'
import type { MascotStateName } from '../../../shared/mascotRules'

export type { MascotLoop, MascotStateName }

// A mascot has one loop per state. idle is required; a state without a loop plays idle.
export type Mascot = {
  name: string
  loops: MascotLoops
}

// The one place a missing state falls back to the idle loop.
export function loopFor(mascot: Mascot, state: MascotStateName): MascotLoop {
  return mascot.loops[state] ?? mascot.loops.idle
}
