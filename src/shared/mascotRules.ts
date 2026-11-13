// Rules for mascots and their spritesheets, used by the upload dialog for quick
// feedback and by the main process, which checks everything again.

// In the order the dialog shows them.
export const MASCOT_STATES = ['idle', 'thinking', 'talking', 'working', 'asking'] as const
export type MascotStateName = (typeof MASCOT_STATES)[number]

export function isMascotState(value: unknown): value is MascotStateName {
  return (MASCOT_STATES as readonly unknown[]).includes(value)
}

// The built-in mascot. It is bundled with the app, never stored in userData.
export const DEFAULT_MASCOT_ID = 'default'

export const FRAME_SIZE = 64
export const MAX_FRAMES = 16
const MB = 1024 * 1024
export const MAX_SHEET_MB = 3
export const MAX_SHEET_BYTES = MAX_SHEET_MB * MB
// The largest sheet the slicer accepts, on each side.
export const MAX_SOURCE_SIDE = 4096

export function sourceTooLargeMessage(width: number, height: number): string {
  return `Sheet must be at most ${MAX_SOURCE_SIDE} pixels on each side. This one is ${width}x${height}.`
}

// A loop can run forward and then back ("reverse at the end"). With one or two frames
// that is the same as looping, so it needs at least three.
export const MIN_REVERSE_FRAMES = 3

export function canReverse(frames: number): boolean {
  return frames >= MIN_REVERSE_FRAMES
}

// The frames of a loop in the order they play, as 0-based places in the strip. A loop
// that reverses at the end runs to the last frame, then back down to the second, then
// starts again: 0, 1, ..., n-1, n-2, ..., 1. The two end frames are each shown once, so
// the turn-around has no pause.
export function loopOrder(frames: number, reverse: boolean): number[] {
  const order = Array.from({ length: frames }, (_, i) => i)
  if (reverse && canReverse(frames)) {
    for (let i = frames - 2; i >= 1; i--) order.push(i)
  }
  return order
}

export const MIN_FPS = 1
export const MAX_FPS = 30
export const DEFAULT_FPS = 8

export const MAX_MASCOT_NAME_LENGTH = 40

export function isValidFps(fps: unknown): fps is number {
  return typeof fps === 'number' && Number.isInteger(fps) && fps >= MIN_FPS && fps <= MAX_FPS
}

// The fps field's text as a number, or null when it is not a whole number in range.
export function parseFps(text: string): number | null {
  if (!/^\d{1,2}$/.test(text.trim())) return null
  const fps = Number(text.trim())
  return isValidFps(fps) ? fps : null
}

export function fpsError(text: string): string | null {
  return parseFps(text) === null
    ? `FPS must be a whole number from ${MIN_FPS} to ${MAX_FPS}.`
    : null
}

export function mascotNameError(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed === '') return 'Name is required.'
  if (trimmed.length > MAX_MASCOT_NAME_LENGTH) {
    return `Name must be at most ${MAX_MASCOT_NAME_LENGTH} characters.`
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return 'Name cannot contain line breaks or tabs.'
  return null
}

// The sheet messages. The height message is the one in designs/DESIGN.md.
export const SHEET_NOT_PNG = 'Sheet must be a PNG file.'
export const SHEET_NOT_IMAGE = 'This file could not be read as an image.'

export function sheetTooBigMessage(bytes: number): string {
  // Rounded up, so a file just over the limit never reads as "3.0 MB".
  const mb = Math.ceil((bytes / MB) * 10) / 10
  return `Sheet must be under ${MAX_SHEET_MB} MB. This one is ${mb.toFixed(1)} MB.`
}

// Rules 2 to 4, in order: height, width, frame count. Null when the size is fine.
export function sheetSizeProblem(width: number, height: number): string | null {
  if (height !== FRAME_SIZE) return `Height must be ${FRAME_SIZE}px. Yours is ${height}px.`
  if (width === 0 || width % FRAME_SIZE !== 0) {
    return `Sheet width must be a multiple of ${FRAME_SIZE} pixels. This one is ${width}.`
  }
  const frames = width / FRAME_SIZE
  if (frames > MAX_FRAMES) {
    return `A sheet can have at most ${MAX_FRAMES} frames. This one has ${frames}.`
  }
  return null
}
