import {
  Document,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  type Node,
  type Pair,
  type Scalar,
  type YAMLMap
} from 'yaml'

// Reads and edits Claude Code agent files. Saving must leave everything the form
// does not show exactly as it was, and yaml's toString() reformats untouched lines
// (list indents, comment spacing, flow spacing, folded text). So the library
// produces the new text of a changed key, and only that key's lines are copied
// into the original file. Every other byte stays put.

const STRINGIFY_OPTIONS = { lineWidth: 0 }
const EDITED_KEYS = ['name', 'description', 'tools', 'model'] as const
type EditedKey = (typeof EDITED_KEYS)[number]

export type AgentEdits = {
  name: string
  description: string
  body: string
  tools: string[] | null
  model: string | null
}

export type ParsedAgentFile = {
  problem: string | null
  name: string | null
  description: string | null
  tools: string[] | null
  model: string | null
  // Read only, for the agent gate. Never written by Mya.
  permissionMode: string | null
  background: boolean
  otherFields: string[]
  body: string
}

type FileParts = { open: string; yaml: string; close: string; rest: string }

const BYTE_ORDER_MARK = String.fromCharCode(0xfeff)

function splitFile(text: string): FileParts | null {
  const bom = text.startsWith(BYTE_ORDER_MARK) ? BYTE_ORDER_MARK : ''
  const opening = /^---[ \t]*\r?\n/.exec(text.slice(bom.length))
  if (!opening) return null
  const open = bom + opening[0]
  const afterOpen = text.slice(open.length)
  const close = /^---[ \t]*(?:\r?\n|$)/m.exec(afterOpen)
  if (!close) return null
  return {
    open,
    yaml: afterOpen.slice(0, close.index),
    close: close[0],
    rest: afterOpen.slice(close.index + close[0].length)
  }
}

// The body as the form shows it: LF line endings, no blank lines around it.
export function normalizeBody(body: string): string {
  return body.replace(/\r\n/g, '\n').replace(/^\n+/, '').replace(/\n+$/, '')
}

// Commas inside parentheses belong to the entry, as in Agent(worker, researcher).
function splitToolList(value: string): string[] {
  const entries: string[] = []
  let depth = 0
  let current = ''
  for (const char of value) {
    if (char === '(') depth++
    else if (char === ')') depth = Math.max(0, depth - 1)
    if (char === ',' && depth === 0) {
      entries.push(current)
      current = ''
    } else {
      current += char
    }
  }
  entries.push(current)
  return entries.map((entry) => entry.trim()).filter((entry) => entry !== '')
}

function readTools(map: YAMLMap): string[] | null {
  const node = map.get('tools', true) as unknown
  if (isSeq(node)) {
    return node.items.flatMap((item) =>
      isScalar(item) && item.value !== null ? [String(item.value)] : []
    )
  }
  if (isScalar(node) && node.value !== null) return splitToolList(String(node.value))
  return null
}

function readModel(map: YAMLMap): string | null {
  const value = map.get('model') as unknown
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null
}

function readPermissionMode(map: YAMLMap): string | null {
  const value = map.get('permissionMode') as unknown
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

// background: true, as YAML writes it. Anything else means no.
function readBackground(map: YAMLMap): boolean {
  const value = map.get('background') as unknown
  return value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true')
}

function keyName(pair: Pair): string {
  return isScalar(pair.key) ? String(pair.key.value) : String(pair.key)
}

function parseYaml(yaml: string): { doc: Document.Parsed; map: YAMLMap } | { problem: string } {
  const doc = parseDocument(yaml)
  if (doc.errors.length > 0) {
    return {
      problem: `The frontmatter cannot be read: ${doc.errors[0].message.split('\n')[0].replace(/:$/, '.')}`
    }
  }
  // Editing works line by line, so the fields must be one per line.
  if (!isMap(doc.contents) || doc.contents.flow) {
    return { problem: 'The frontmatter is not a list of fields, one per line.' }
  }
  return { doc, map: doc.contents as YAMLMap }
}

const EMPTY_FIELDS = {
  name: null,
  description: null,
  tools: null,
  model: null,
  permissionMode: null,
  background: false,
  otherFields: [] as string[]
}

export function readAgentFile(text: string): ParsedAgentFile {
  const parts = splitFile(text)
  if (!parts) {
    return {
      ...EMPTY_FIELDS,
      problem: 'The file has no frontmatter between --- lines.',
      body: normalizeBody(text)
    }
  }
  const body = normalizeBody(parts.rest)
  const parsed = parseYaml(parts.yaml)
  if ('problem' in parsed) return { ...EMPTY_FIELDS, problem: parsed.problem, body }

  const { map } = parsed
  const rawName = map.get('name') as unknown
  const rawDescription = map.get('description') as unknown
  const name = typeof rawName === 'string' && rawName.trim() !== '' ? rawName : null
  const description =
    typeof rawDescription === 'string' && rawDescription.trim() !== '' ? rawDescription : null

  let problem: string | null = null
  if (name === null) problem = 'The name field is missing.'
  else if (description === null) problem = 'The description field is missing.'

  return {
    problem,
    name,
    description,
    tools: readTools(map),
    model: readModel(map),
    permissionMode: readPermissionMode(map),
    background: readBackground(map),
    otherFields: map.items.map(keyName).filter((key) => !EDITED_KEYS.includes(key as EditedKey)),
    body
  }
}

function sameList(a: string[] | null, b: string[] | null): boolean {
  if (a === null || b === null) return a === b
  return a.length === b.length && a.every((entry, i) => entry === b[i])
}

function dominantLineEnding(text: string): '\n' | '\r\n' {
  const crlf = text.match(/\r\n/g)?.length ?? 0
  const lf = (text.match(/\n/g)?.length ?? 0) - crlf
  return crlf > lf ? '\r\n' : '\n'
}

type LineSpan = { start: number; end: number; indent: string }

// The whole lines a top-level key and its value sit on, trailing comment included.
function pairLines(source: string, pair: Pair): LineSpan {
  const key = pair.key as Scalar
  const [keyStart, keyEnd] = key.range as [number, number, number]
  const valueRange = (pair.value as Node | null)?.range
  let last = valueRange ? Math.max(valueRange[1], keyEnd) : keyEnd
  while (last > keyEnd && /\s/.test(source[last - 1])) last--
  const start = keyStart === 0 ? 0 : source.lastIndexOf('\n', keyStart - 1) + 1
  const lineBreak = source.indexOf('\n', last)
  return {
    start,
    end: lineBreak === -1 ? source.length : lineBreak + 1,
    indent: source.slice(start, keyStart)
  }
}

function findPair(map: YAMLMap, key: string): Pair | undefined {
  return map.items.find((pair) => keyName(pair) === key)
}

function changedKeys(parsed: ParsedAgentFile, edits: AgentEdits): EditedKey[] {
  const changed: EditedKey[] = []
  if (parsed.name !== edits.name) changed.push('name')
  if (parsed.description !== edits.description) changed.push('description')
  if (!sameList(parsed.tools, edits.tools)) changed.push('tools')
  if (parsed.model !== edits.model) changed.push('model')
  return changed
}

// Sets the tools key, keeping the file's string or list form and any list comments.
function setTools(doc: Document.Parsed, map: YAMLMap, tools: string[]): void {
  const node = map.get('tools', true) as unknown
  if (isSeq(node)) {
    const existing = new Map(
      node.items.flatMap((item) => (isScalar(item) ? [[String(item.value), item] as const] : []))
    )
    node.items = tools.map((tool) => existing.get(tool) ?? doc.createNode(tool))
  } else {
    map.set('tools', tools.join(', '))
  }
}

function applyToDocument(
  doc: Document.Parsed,
  map: YAMLMap,
  edits: AgentEdits,
  changed: EditedKey[]
): void {
  for (const key of changed) {
    if (key === 'tools') {
      if (edits.tools === null) map.delete('tools')
      else setTools(doc, map, edits.tools)
    } else if (key === 'model') {
      if (edits.model === null) map.delete('model')
      else map.set('model', edits.model)
    } else {
      map.set(key, edits[key])
    }
  }
}

function editYaml(yaml: string, edits: AgentEdits, parsed: ParsedAgentFile, eol: string): string {
  const changed = changedKeys(parsed, edits)
  if (changed.length === 0) return yaml

  const result = parseYaml(yaml)
  if ('problem' in result) throw new Error(result.problem)
  const { doc, map } = result
  const originalValues = doc.toJS() as Record<string, unknown>
  const lastPair = map.items[map.items.length - 1]
  const appendAt = pairLines(yaml, lastPair).end
  const baseIndent = pairLines(yaml, map.items[0]).indent

  const spans = new Map(
    changed.flatMap((key) => {
      const pair = findPair(map, key)
      return pair ? [[key, pairLines(yaml, pair)] as const] : []
    })
  )

  applyToDocument(doc, map, edits, changed)

  const output = doc.toString(STRINGIFY_OPTIONS)
  const outputResult = parseYaml(output)
  if ('problem' in outputResult) throw new Error(outputResult.problem)

  const replacementFor = (key: EditedKey, indent: string): string | null => {
    const pair = findPair(outputResult.map, key)
    if (!pair) return null
    const span = pairLines(output, pair)
    return output
      .slice(span.start, span.end)
      .replace(/\n$/, '')
      .split('\n')
      .map((line) => (line === '' ? line : indent + line) + eol)
      .join('')
  }

  const splices: { start: number; end: number; text: string }[] = []
  for (const key of changed) {
    const span = spans.get(key)
    if (span) {
      splices.push({
        start: span.start,
        end: span.end,
        text: replacementFor(key, span.indent) ?? ''
      })
    } else {
      splices.push({ start: appendAt, end: appendAt, text: replacementFor(key, baseIndent) ?? '' })
    }
  }

  let next = yaml
  for (const splice of splices.sort((a, b) => b.start - a.start)) {
    next = next.slice(0, splice.start) + splice.text + next.slice(splice.end)
  }

  assertOnlyExpectedChanges(next, originalValues, edits, changed)
  return next
}

// A last check before anything reaches the disk: the edited text must parse, hold
// the new values, and hold the same values as before for every other key.
function assertOnlyExpectedChanges(
  yaml: string,
  originalValues: Record<string, unknown>,
  edits: AgentEdits,
  changed: EditedKey[]
): void {
  const parsed = parseYaml(yaml)
  if ('problem' in parsed) throw new Error(parsed.problem)
  const values = parsed.doc.toJS() as Record<string, unknown>
  const keep = (source: Record<string, unknown>): string =>
    JSON.stringify(Object.entries(source).filter(([key]) => !changed.includes(key as EditedKey)))
  const reread = readAgentFile(`---\n${yaml}---\n`)
  const correct =
    keep(values) === keep(originalValues) &&
    reread.name === edits.name &&
    reread.description === edits.description &&
    sameList(reread.tools, edits.tools) &&
    reread.model === edits.model
  if (!correct) throw new Error('This file cannot be edited safely.')
}

function editBody(rest: string, body: string, eol: string): string {
  if (normalizeBody(rest) === body) return rest
  if (body === '') return ''
  const withEol = body.replace(/\n/g, eol)
  if (normalizeBody(rest) === '') return eol + withEol + eol
  const leading = /^(?:\r?\n)*/.exec(rest)?.[0] ?? ''
  const trailing = /(?:\r?\n)*$/.exec(rest)?.[0] ?? ''
  return leading + withEol + trailing
}

// Applies the form's fields to a file. Throws if the file cannot be edited safely.
export function editAgentFile(text: string, edits: AgentEdits): string {
  const parts = splitFile(text)
  if (!parts) throw new Error('The file has no frontmatter between --- lines.')
  const parsed = readAgentFile(text)
  if (parsed.problem) throw new Error(parsed.problem)
  const eol = dominantLineEnding(text)
  const body = normalizeBody(edits.body)
  return (
    parts.open +
    editYaml(parts.yaml, { ...edits, body }, parsed, eol) +
    parts.close +
    editBody(parts.rest, body, eol)
  )
}

export function buildAgentFile(edits: AgentEdits): string {
  const fields: Record<string, string> = { name: edits.name, description: edits.description }
  if (edits.tools !== null) fields.tools = edits.tools.join(', ')
  if (edits.model !== null) fields.model = edits.model
  const yaml = new Document(fields).toString(STRINGIFY_OPTIONS)
  const body = normalizeBody(edits.body)
  return `---\n${yaml}---\n${body === '' ? '' : `\n${body}\n`}`
}
