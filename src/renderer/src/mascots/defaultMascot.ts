import mascotSheet from '../assets/mascot.png'
import type { MascotLoops } from '../../../shared/ipc'
import type { Mascot } from './types'

// The built-in mascot (id "default"): one 64x64 frame, bundled with the app.
// It cannot be deleted, and its bundled file never changes.
export const DEFAULT_MASCOT: Mascot = {
  name: 'Default',
  loops: {
    idle: { src: mascotSheet, frames: 1, fps: 1 }
  }
}

// The default as the user edited it: their name and loops laid over the bundled
// mascot. A null name keeps the built-in name; without an uploaded idle loop the
// bundled idle sheet plays.
export function withDefaultEdits(name: string | null, loops: Partial<MascotLoops>): Mascot {
  return {
    name: name ?? DEFAULT_MASCOT.name,
    loops: { ...loops, idle: loops.idle ?? DEFAULT_MASCOT.loops.idle }
  }
}
