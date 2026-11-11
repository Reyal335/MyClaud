// Writes every app icon file from the pixel grid below. Run it with `npm run icon`.
// Each size is rendered on its own at a whole-number scale, so art pixels stay hard
// squares. Nothing is resampled from a larger image.

// Plain JavaScript, so there are no return types to write.
/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'

const ART = [
  '.......WWWW.....',
  '......WWWWWW....',
  '..WWW.WWWWWWW...',
  '.WWWWWWWWWWWWW..',
  '.WWWWWWWWWWWWWW.',
  'WWWWWWWWWWWWWWWW',
  'WWWWNNWWWWNNWWWW',
  'WWWWNNWWWWNNWWWW',
  'WWTTWWWNNWWWTTWW',
  'WWWWWWWWWWWWWWWW',
  '.WWWWWWWWWWWWWW.',
  '..TTTTTTTTTTTT..'
]

const ART_WIDTH = 16
const ART_HEIGHT = 12

const COLORS = {
  '.': [0x1c, 0x25, 0x41],
  W: [0xf2, 0xf4, 0xf8],
  N: [0x0b, 0x13, 0x2b],
  T: [0x5b, 0xc0, 0xbe]
}

// Icon size in pixels -> whole-number scale of one art pixel.
const SCALES = { 16: 1, 32: 2, 48: 2, 64: 3, 128: 6, 256: 12, 512: 24, 1024: 48 }

const ICO_SIZES = [16, 32, 48, 64, 256]

// .icns entry type -> PNG size. The "@2x" types reuse the same image as the
// matching plain size. The format has no standard PNG entry for 48.
const ICNS_ENTRIES = [
  ['icp4', 16],
  ['icp5', 32],
  ['ic11', 32],
  ['icp6', 64],
  ['ic12', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic13', 256],
  ['ic09', 512],
  ['ic14', 512],
  ['ic10', 1024]
]

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Opaque RGBA rows, each starting with PNG's filter byte (0 = none).
function renderRows(size) {
  const scale = SCALES[size]
  const offsetX = (size - ART_WIDTH * scale) / 2
  const offsetY = (size - ART_HEIGHT * scale) / 2
  const stride = 1 + size * 4
  const rows = Buffer.alloc(stride * size)

  for (let y = 0; y < size; y++) {
    const artY = Math.floor((y - offsetY) / scale)
    for (let x = 0; x < size; x++) {
      const artX = Math.floor((x - offsetX) / scale)
      const [r, g, b] = COLORS[ART[artY]?.[artX] ?? '.']
      const at = y * stride + 1 + x * 4
      rows[at] = r
      rows[at + 1] = g
      rows[at + 2] = b
      rows[at + 3] = 255
    }
  }
  return rows
}

function pngChunk(type, data) {
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([length, typeAndData, crc])
}

function encodePng(size) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bits per channel
  header[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(renderRows(size), { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

function encodeIco(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(ICO_SIZES.length, 4)

  const images = ICO_SIZES.map((size) => pngs.get(size))
  let offset = header.length + 16 * ICO_SIZES.length
  const entries = ICO_SIZES.map((size, i) => {
    const entry = Buffer.alloc(16)
    // A width or height of 0 means 256.
    entry[0] = size % 256
    entry[1] = size % 256
    entry.writeUInt16LE(1, 4) // color planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(images[i].length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += images[i].length
    return entry
  })
  return Buffer.concat([header, ...entries, ...images])
}

function encodeIcns(pngs) {
  const entries = ICNS_ENTRIES.map(([type, size]) => {
    const image = pngs.get(size)
    const entryHeader = Buffer.alloc(8)
    entryHeader.write(type, 0, 'latin1')
    entryHeader.writeUInt32BE(image.length + 8, 4)
    return Buffer.concat([entryHeader, image])
  })
  const body = Buffer.concat(entries)
  const fileHeader = Buffer.alloc(8)
  fileHeader.write('icns', 0, 'latin1')
  fileHeader.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([fileHeader, body])
}

const pngs = new Map(Object.keys(SCALES).map((size) => [Number(size), encodePng(Number(size))]))

const outputs = {
  'resources/icon.png': pngs.get(512),
  'build/icon.png': pngs.get(1024),
  'build/icon.ico': encodeIco(pngs),
  'build/icon.icns': encodeIcns(pngs)
}

for (const [file, data] of Object.entries(outputs)) {
  writeFileSync(join(ROOT, file), data)
  console.log(`${file} (${data.length} bytes)`)
}
