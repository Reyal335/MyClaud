import { open } from 'fs/promises'

// Reads a PNG's size from its first bytes: the 8-byte signature, then the IHDR
// chunk, which always comes first and holds the width and height.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PNG_HEADER_LENGTH = 24

export type PngSize = { width: number; height: number }

// The first bytes of a file, enough for pngSize. Shorter if the file is shorter.
export async function readPngHeader(path: string): Promise<Buffer> {
  const file = await open(path, 'r')
  try {
    const header = Buffer.alloc(PNG_HEADER_LENGTH)
    const { bytesRead } = await file.read(header, 0, PNG_HEADER_LENGTH, 0)
    return header.subarray(0, bytesRead)
  } finally {
    await file.close()
  }
}

// The size in the header, or null when the bytes do not start a PNG. Works on
// a header from readPngHeader or on a whole file.
export function pngSize(bytes: Buffer): PngSize | null {
  const isPng =
    bytes.length >= PNG_HEADER_LENGTH &&
    bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) &&
    bytes.toString('latin1', 12, 16) === 'IHDR'
  if (!isPng) return null
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

export function toPngDataUrl(bytes: Buffer): string {
  return `data:image/png;base64,${bytes.toString('base64')}`
}
