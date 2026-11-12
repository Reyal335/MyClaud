// Markdown source to plain text, for short previews: the inbox row, the agent
// card in the history, and the popup's first line. Not a full parser, and no
// package: it removes the marks Claude and the agents use, one line per block.

const HARNESS_START = '[harness:'

export type HarnessSplit = {
  // The harness note, exactly as it arrived, or null when there is none.
  note: string | null
  // The rest of the text, with the note and the blank lines after it removed.
  body: string
}

// Claude Code's harness can put a note in square brackets in front of an agent's
// report, as its own first block. Only that exact shape is taken out: a first
// block that starts with "[harness:" and ends with "]". Nothing in it is changed.
export function splitHarnessNote(text: string): HarnessSplit {
  const start = text.length - text.trimStart().length
  if (!text.startsWith(HARNESS_START, start)) return { note: null, body: text }
  const rest = text.slice(start)
  const blank = /\r?\n[ \t]*\r?\n/.exec(rest)
  const block = (blank ? rest.slice(0, blank.index) : rest).trimEnd()
  if (!block.endsWith(']')) return { note: null, body: text }
  const body = blank ? rest.slice(blank.index).replace(/^\s*\n/, '') : ''
  return { note: block, body }
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/
const HEADING = /^ {0,3}#{1,6}(?:[ \t]+|$)/
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const SETEXT = /^ {0,3}(?:=+|-+)[ \t]*$/
const QUOTE = /^ {0,3}>[ \t]?/
const ITEM = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/
const TABLE_DELIMITER = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/

// Inline marks: code first (its content stays as written), then images, links,
// and emphasis. Underscores only count at word edges, so snake_case stays.
function inline(text: string): string {
  const parts = text.split(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/)
  let out = ''
  for (let i = 0; i < parts.length; i++) {
    if (i % 3 === 0) out += plainInline(parts[i])
    else if (i % 3 === 2) out += parts[i].trim() === '' ? parts[i] : parts[i].trim()
  }
  return out
}

function plainInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/!\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/\[\^([^\]]+)\]/g, '')
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, '$1')
    // Emphasis only around words, so a glob such as **/*.ts keeps its stars.
    .replace(
      /(\*\*|__)(?=[\p{L}\p{N}"'([])([\s\S]*?[\p{L}\p{N}"')\].!?:])\1/gu,
      (match, mark: string, inner: string, offset: number, all: string) =>
        mark === '__' && !edges(all, offset, match.length) ? match : inner
    )
    .replace(
      /(\*|_)(?=[\p{L}\p{N}"'([])([\s\S]*?[\p{L}\p{N}"')\].!?:])\1/gu,
      (match, mark: string, inner: string, offset: number, all: string) =>
        mark === '_' && !edges(all, offset, match.length) ? match : inner
    )
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')
    .replace(/\\([!-/:-@[-`{-~])/g, '$1')
}

// True when the match is not inside a word, as underscore emphasis requires.
function edges(all: string, offset: number, length: number): boolean {
  const before = all[offset - 1] ?? ' '
  const after = all[offset + length] ?? ' '
  return !/\w/.test(before) && !/\w/.test(after)
}

function tableRow(line: string): string {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => inline(cell.trim()))
    .filter((cell) => cell !== '')
    .join(' · ')
}

export function toPlainText(source: string): string {
  const lines = splitHarnessNote(source).body.split(/\r?\n/)
  const blocks: string[] = []
  let paragraph: string[] = []
  let fence: string | null = null
  let code: string[] = []

  const flush = (): void => {
    if (paragraph.length > 0) blocks.push(inline(paragraph.join(' ')))
    paragraph = []
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]

    if (fence !== null) {
      const close = FENCE.exec(raw)
      if (
        close &&
        close[1][0] === fence[0] &&
        close[1].length >= fence.length &&
        raw.trim() === close[1]
      ) {
        blocks.push(code.join(' '))
        code = []
        fence = null
      } else if (raw.trim() !== '') {
        code.push(raw.trim())
      }
      continue
    }

    const open = FENCE.exec(raw)
    if (open) {
      flush()
      fence = open[1]
      continue
    }

    let line = raw
    while (QUOTE.test(line)) line = line.replace(QUOTE, '')

    if (line.trim() === '') {
      flush()
      continue
    }
    if (RULE.test(line) && !(paragraph.length > 0 && SETEXT.test(line))) {
      flush()
      continue
    }
    if (paragraph.length > 0 && SETEXT.test(line)) {
      flush()
      continue
    }
    if (HEADING.test(line)) {
      flush()
      blocks.push(
        inline(
          line
            .replace(HEADING, '')
            .replace(/[ \t]+#+[ \t]*$/, '')
            .trim()
        )
      )
      continue
    }
    if (line.includes('|') && TABLE_DELIMITER.test(lines[i + 1] ?? '')) {
      flush()
      blocks.push(tableRow(line))
      i++
      while (i + 1 < lines.length && lines[i + 1].includes('|') && lines[i + 1].trim() !== '') {
        i++
        blocks.push(tableRow(lines[i]))
      }
      continue
    }
    if (ITEM.test(line)) {
      flush()
      paragraph.push(line.replace(ITEM, '').trim())
      continue
    }
    paragraph.push(line.trim())
  }
  flush()
  if (fence !== null && code.length > 0) blocks.push(code.join(' '))

  return blocks.filter((block) => block.trim() !== '').join('\n')
}
