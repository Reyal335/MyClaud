import type { ToolInput } from './ipc'
import { relativePath } from './toolLabel'

// Whether a request is short enough for the compact approval popup to show it in
// full, so APPROVE can be offered without DETAILS. One rule for main (which
// refuses an early approve) and the popup page (which shows the buttons).
//
// 40 characters, not 44: the card is 340 wide, and at 12px IBM Plex Mono is
// 7.2px a character, so 44 would need 317px of the 292px inside the block.
export const POPUP_LINE_CHARS = 40
export const POPUP_MAX_LINES = 4

function stringField(input: ToolInput, key: string): string {
  const value = input[key]
  return typeof value === 'string' ? value : ''
}

function linesOf(text: string): string[] {
  // An empty block shows "(empty)" on one line.
  return text === '' ? ['(empty)'] : text.replace(/\r\n/g, '\n').split('\n')
}

// One part of step 3's details: the path line, a labelled block, or the note.
type Part = { kind: 'path' | 'block' | 'note'; lines: string[] }

// The text step 3's details component shows for this request, part by part.
function partsOf(name: string, input: ToolInput, projectPath: string | null): Part[] {
  const path = relativePath(stringField(input, 'file_path'), projectPath)
  switch (name) {
    case 'Bash': {
      const description = stringField(input, 'description')
      const parts: Part[] = [{ kind: 'block', lines: linesOf(stringField(input, 'command')) }]
      if (description !== '') parts.push({ kind: 'note', lines: linesOf(description) })
      return parts
    }
    case 'Edit':
      return [
        { kind: 'path', lines: [path] },
        { kind: 'block', lines: linesOf(stringField(input, 'old_string')) },
        { kind: 'block', lines: linesOf(stringField(input, 'new_string')) }
      ]
    case 'Write':
      return [
        { kind: 'path', lines: [path] },
        { kind: 'block', lines: linesOf(stringField(input, 'content')) }
      ]
    default:
      return [{ kind: 'block', lines: linesOf(JSON.stringify(input, null, 2)) }]
  }
}

// Columns a line takes: a tab is 8, anything outside printable ASCII counts as 2,
// since wide characters are wider than one cell of the monospace font.
function width(line: string): number {
  let columns = 0
  for (const char of line) {
    if (char === '\t') columns += 8
    else if (char < ' ' || char > '~') columns += 2
    else columns += 1
  }
  return columns
}

export function fitsPopup(
  name: string,
  input: ToolInput,
  truncated: boolean,
  projectPath: string | null
): boolean {
  if (truncated) return false
  const lines = partsOf(name, input, projectPath).flatMap((part) => part.lines)
  return lines.length <= POPUP_MAX_LINES && lines.every((line) => width(line) <= POPUP_LINE_CHARS)
}

// Pixel sizes of step 3's details as the popup draws them (popup.css): every
// line is 12px text at line height 1.5, a block has a 12px label, a 6px gap, and
// 20px of padding and border, and parts are 10px apart.
const LINE = 18
const LABEL = 12 + 6
const BLOCK_CHROME = 20
const PART_GAP = 10

// The height of the details in the compact popup, for a request that fits.
export function popupDetailsHeight(
  name: string,
  input: ToolInput,
  projectPath: string | null
): number {
  const parts = partsOf(name, input, projectPath)
  const heights = parts.map((part) =>
    part.kind === 'block'
      ? LABEL + BLOCK_CHROME + part.lines.length * LINE
      : part.lines.length * LINE
  )
  return heights.reduce((sum, height) => sum + height, 0) + PART_GAP * (parts.length - 1)
}
