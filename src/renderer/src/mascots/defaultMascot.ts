import mascotSheet from '../assets/mascot.png'
import type { Mascot } from './types'

// The built-in mascot: one 64x64 frame, used for every state until uploads (step 6).
export const DEFAULT_MASCOT: Mascot = {
  name: 'Default',
  loops: {
    idle: { src: mascotSheet, frames: 1, fps: 1 }
  }
}
