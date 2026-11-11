export type MascotStateName = 'idle' | 'thinking' | 'talking' | 'working' | 'asking'

// One spritesheet: a horizontal strip of 64x64 frames, played at `fps`.
export type MascotLoop = {
  src: string
  frames: number
  fps: number
}

// A mascot has one loop per state. idle is required; a state without a loop plays idle.
export type Mascot = {
  name: string
  loops: { idle: MascotLoop } & Partial<Record<Exclude<MascotStateName, 'idle'>, MascotLoop>>
}

export function loopFor(mascot: Mascot, state: MascotStateName): MascotLoop {
  return mascot.loops[state] ?? mascot.loops.idle
}
