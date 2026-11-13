import { pngSize } from './png'

// PNG and JPEG files, recognised by their first bytes and not by the file name. Used
// for chat themes. The size is read from the file's header, which is cheap and never
// decodes the picture, so a small file that claims a huge size can be refused before
// anything is allocated for it.

export type ImageKind = 'png' | 'jpeg'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export function sniffImage(bytes: Buffer): ImageKind | null {
  if (bytes.length >= PNG_SIGNATURE.length && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return 'png'
  }
  // A JPEG starts with the start-of-image marker, then another marker.
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg'
  }
  return null
}

// The extension a stored theme gets.
export function extensionFor(kind: ImageKind): 'png' | 'jpg' {
  return kind === 'png' ? 'png' : 'jpg'
}

// The kind a stored file name says. Main made the name, so it can be trusted.
export function kindFromFile(file: string): ImageKind {
  return file.endsWith('.jpg') ? 'jpeg' : 'png'
}

export function toDataUrl(bytes: Buffer, kind: ImageKind): string {
  const mime = kind === 'png' ? 'image/png' : 'image/jpeg'
  return `data:${mime};base64,${bytes.toString('base64')}`
}

// Start-of-frame markers hold the size. C4 (huffman tables), C8 (reserved) and CC
// (arithmetic conditioning) sit in the same range but are not frames.
function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
}

// Walks a JPEG's segments up to its start-of-frame, which holds the height and width.
function jpegSize(bytes: Buffer): { width: number; height: number } | null {
  let at = 2
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null
    const marker = bytes[at + 1]
    // Fill bytes before a marker.
    if (marker === 0xff) {
      at += 1
      continue
    }
    // Markers with no length: a stray start of image, the restart markers, TEM.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2
      continue
    }
    // The end of the image, or the scan itself, before any frame: no size to find.
    if (marker === 0xd9 || marker === 0xda) return null
    const length = bytes.readUInt16BE(at + 2)
    if (length < 2) return null
    if (isStartOfFrame(marker)) {
      // marker (2), length (2), precision (1), height (2), width (2).
      if (at + 9 > bytes.length) return null
      return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) }
    }
    at += 2 + length
  }
  return null
}

// The size in the file's header, or null when it cannot be read.
export function headerSize(
  bytes: Buffer,
  kind: ImageKind
): { width: number; height: number } | null {
  return kind === 'png' ? pngSize(bytes) : jpegSize(bytes)
}
