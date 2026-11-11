import { FRAME_SIZE } from '../shared/mascotRules'

// The nearest-neighbour cut behind the sheet slicer. It works on a raw bitmap
// of 4 bytes per pixel and copies whole pixels: no smoothing, no blending, and
// it never reads the channels, so the platform's byte order does not matter.

// The source pixel (within one frame of `size` pixels) that output pixel `i`
// of a 64px frame takes: the one under the output pixel's centre. A 128px frame
// drawn as 2x2 blocks comes out as the 64px original; a 32px frame is doubled.
export function nearestSource(i: number, size: number): number {
  return Math.floor(((2 * i + 1) * size) / (2 * FRAME_SIZE))
}

// Cuts the picked cells out of `bitmap` (`width` pixels wide, square cells of
// `cellSize` pixels in `columns` columns) and lays them left to right, each
// scaled to 64x64, in one bitmap 64 pixels high. The caller checks the slice first.
export function cutFrames(
  bitmap: Buffer,
  width: number,
  columns: number,
  cellSize: number,
  cells: readonly number[]
): Buffer {
  const outWidth = FRAME_SIZE * cells.length
  const out = Buffer.alloc(outWidth * FRAME_SIZE * 4)
  const offsets = Array.from({ length: FRAME_SIZE }, (_, i) => nearestSource(i, cellSize))
  cells.forEach((cell, k) => {
    const left = (cell % columns) * cellSize
    const top = Math.floor(cell / columns) * cellSize
    for (let y = 0; y < FRAME_SIZE; y++) {
      const sourceRow = (top + offsets[y]) * width
      const outRow = y * outWidth + k * FRAME_SIZE
      for (let x = 0; x < FRAME_SIZE; x++) {
        const from = (sourceRow + left + offsets[x]) * 4
        bitmap.copy(out, (outRow + x) * 4, from, from + 4)
      }
    }
  })
  return out
}
