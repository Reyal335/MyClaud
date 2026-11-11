// The sheet slicer's rules: one pure function used by the renderer, to show the
// status as cells are clicked, and by the main process, which checks every
// slice request again. Messages are the ones in designs/DESIGN.md.

import { FRAME_SIZE, MAX_FRAMES } from './mascotRules'

export const MAX_GRID = 16

export type SliceLevel = 'ok' | 'warning' | 'error'

export type SliceStatus = {
  level: SliceLevel
  // The first rule that fails, or the note about the frame size.
  message: string
  // True when a slice can be made: no rule fails and at least one cell is picked.
  canUse: boolean
}

export const SLICE_GRID_MESSAGE = `Columns and rows must be whole numbers from 1 to ${MAX_GRID}.`
export const SLICE_CELLS_MESSAGE = 'Each picked frame must be a cell in the grid, picked only once.'
// Only the main process sends this one: the slicer disables USE instead.
export const SLICE_EMPTY_MESSAGE = 'Pick at least one frame.'

function isGridSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_GRID
}

const error = (message: string): SliceStatus => ({ level: 'error', message, canUse: false })

// The note for a frame size that passed the rules. It never blocks.
function sizeNote(size: number): { level: SliceLevel; message: string } {
  if (size === FRAME_SIZE) return { level: 'ok', message: '64x64 frames, used as they are.' }
  if (size % FRAME_SIZE === 0 || FRAME_SIZE % size === 0) {
    return { level: 'ok', message: `${size}x${size} frames, scaled to 64x64.` }
  }
  return {
    level: 'warning',
    message: `${size}x${size} is not a multiple of 64. Scaled frames may look uneven.`
  }
}

// Checks a slice in order and reports the first rule that fails, with the real
// values; otherwise the note. `width` and `height` are the sheet's size, which
// the caller knows; everything else may come from outside and is checked.
export function checkSlice(
  width: number,
  height: number,
  columns: unknown,
  rows: unknown,
  cells: unknown
): SliceStatus {
  // 1. Grid size.
  if (!isGridSize(columns) || !isGridSize(rows)) return error(SLICE_GRID_MESSAGE)
  // 2, 3. The sheet divides evenly.
  if (width % columns !== 0) {
    return error(`Sheet width ${width} does not divide into ${columns} columns.`)
  }
  if (height % rows !== 0) {
    return error(`Sheet height ${height} does not divide into ${rows} rows.`)
  }
  // 4. Square frames.
  const frameWidth = width / columns
  const frameHeight = height / rows
  if (frameWidth !== frameHeight) {
    return error(`Frames must be square. ${columns} x ${rows} gives ${frameWidth}x${frameHeight}.`)
  }
  if (!Array.isArray(cells)) return error(SLICE_CELLS_MESSAGE)
  const note = sizeNote(frameWidth)
  // 5. Something is picked. No message of its own: the note shows, and USE is off.
  if (cells.length === 0) return { ...note, canUse: false }
  // 6. Loop length.
  if (cells.length > MAX_FRAMES) {
    return error(`A loop can have at most ${MAX_FRAMES} frames. ${cells.length} are picked.`)
  }
  // 7. Every cell is in the grid, once.
  const count = columns * rows
  const seen = new Set<number>()
  for (const cell of cells) {
    if (typeof cell !== 'number' || !Number.isInteger(cell) || cell < 0 || cell >= count) {
      return error(SLICE_CELLS_MESSAGE)
    }
    if (seen.has(cell)) return error(SLICE_CELLS_MESSAGE)
    seen.add(cell)
  }
  return { ...note, canUse: true }
}

// The grid the slicer opens with: 64px cells when the sheet allows it, else 1 by 1.
export function startingGrid(width: number, height: number): { columns: number; rows: number } {
  const columns = width / FRAME_SIZE
  const rows = height / FRAME_SIZE
  return isGridSize(columns) && isGridSize(rows) ? { columns, rows } : { columns: 1, rows: 1 }
}

// The picks after the grid changes: every cell in reading order when they fit
// in one loop, none when they do not.
export function defaultPicks(columns: number, rows: number): number[] {
  const count = columns * rows
  return count <= MAX_FRAMES ? Array.from({ length: count }, (_, i) => i) : []
}
