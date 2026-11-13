import {
  cloneElement,
  Fragment,
  isValidElement,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'
import renderMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  MarkdownCodeBlock,
  MarkdownLink,
  MarkdownNoImage,
  MarkdownParagraph,
  MarkdownTable,
  MarkdownTaskBox,
  type TreeNode
} from './MarkdownElements'
import { safeUrl } from './safeUrl'

// Markdown source to React elements, for components/Markdown.tsx. Each text is
// parsed once and cached. Typing cuts the element tree after N visible
// characters, so a typing tick never parses anything.
//
// Safety: no HTML plugin, so HTML in the text comes out as text. Only http and
// https addresses survive urlTransform. Images become text or a link before
// rendering, so no img element is ever made.

// --- Plugins ----------------------------------------------------------------

// Images: an http or https image becomes a link reading "[image: <alt>]", any
// other image its alt text. Inside a link it is text only, as links cannot nest.
function rehypeSafeContent() {
  return (tree: TreeNode): void => {
    const walk = (node: TreeNode, inLink: boolean): void => {
      const children = node.children
      if (!children) return
      for (let i = 0; i < children.length; i++) {
        const child = children[i]
        if (child.type !== 'element') continue
        if (child.tagName === 'img') {
          const alt = String(child.properties?.alt ?? '')
          const src = safeUrl(String(child.properties?.src ?? ''))
          children[i] =
            src && !inLink
              ? {
                  type: 'element',
                  tagName: 'a',
                  properties: { href: src },
                  children: [{ type: 'text', value: `[image: ${alt}]` }]
                }
              : { type: 'text', value: src ? `[image: ${alt}]` : alt }
          continue
        }
        walk(child, inLink || child.tagName === 'a')
      }
    }
    walk(tree, false)
    // HTML written as its own block shows as text. It gets a paragraph, so it has
    // the same spacing as the blocks around it.
    tree.children = (tree.children ?? []).map((child) =>
      child.type === 'raw'
        ? { type: 'element', tagName: 'p', properties: {}, children: [child] }
        : child
    )
  }
}

type Offsets = [number, number][]

// Records where each top-level block starts and ends in the source, so a reply
// that is still streaming can be split into finished blocks and the last one.
function remarkBlockOffsets(holder: { offsets: Offsets }) {
  return (tree: TreeNode): void => {
    holder.offsets = (tree.children ?? []).map((child) => [
      child.position?.start.offset ?? 0,
      child.position?.end.offset ?? 0
    ])
  }
}

const components: Components = {
  a: MarkdownLink,
  p: MarkdownParagraph,
  pre: MarkdownCodeBlock,
  table: MarkdownTable,
  input: MarkdownTaskBox,
  img: MarkdownNoImage
}

// --- Parsing, once per text --------------------------------------------------

export type Parsed = {
  element: ReactElement
  // Visible characters, as the typing counts them.
  length: number
  offsets: Offsets
}

const CACHE_SIZE = 200
const cache = new Map<string, Parsed>()

function parse(source: string): Parsed {
  const hit = cache.get(source)
  if (hit) {
    cache.delete(source)
    cache.set(source, hit)
    return hit
  }
  const holder: { offsets: Offsets } = { offsets: [] }
  // Markdown() is synchronous and uses no hooks, so it can run here and give
  // back the element tree, which the typing then cuts without parsing again.
  const element = renderMarkdown({
    children: source,
    remarkPlugins: [remarkGfm, [remarkBlockOffsets, holder]],
    rehypePlugins: [rehypeSafeContent],
    urlTransform: (url) => safeUrl(url),
    components
  })
  const parsed = { element, length: measure(element), offsets: holder.offsets }
  cache.set(source, parsed)
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
  return parsed
}

// --- Counting and cutting the element tree -------------------------------------

type AnyElement = ReactElement<{ children?: ReactNode; node?: TreeNode }>

// A table shows whole as soon as it is reached and counts as one character.
function isAtomic(element: AnyElement): boolean {
  return element.type === 'table' || element.props.node?.tagName === 'table'
}

// Line breaks between blocks are not visible and do not count.
function countOf(text: string): number {
  return /^\n*$/.test(text) ? 0 : text.length
}

const lengths = new WeakMap<object, number>()

function measure(node: ReactNode): number {
  if (typeof node === 'string') return countOf(node)
  if (typeof node === 'number') return String(node).length
  if (Array.isArray(node)) return node.reduce((sum: number, child) => sum + measure(child), 0)
  if (!isValidElement(node)) return 0
  const element = node as AnyElement
  const known = lengths.get(element)
  if (known !== undefined) return known
  const length = isAtomic(element) ? 1 : measure(element.props.children)
  lengths.set(element, length)
  return length
}

type CutState = { left: number; cursor: ReactNode; placed: boolean }

const CURSOR_KEY = 'md-cursor'

function withCursor(nodes: ReactNode[], state: CutState): ReactNode[] {
  state.placed = true
  return [...nodes, <Fragment key={CURSOR_KEY}>{state.cursor}</Fragment>]
}

// Puts the cursor after the last thing shown, inside the innermost element, so
// it sits at the end of the last line and not on a line of its own.
function appendCursor(node: ReactNode, state: CutState): ReactNode {
  if (!isValidElement(node)) return withCursor([node], state)
  const element = node as AnyElement
  const children = element.props.children
  if (isAtomic(element) || children === undefined || children === null) {
    return withCursor([element], state)
  }
  const list = Array.isArray(children) ? [...children] : [children]
  let last = list.length - 1
  while (last >= 0 && typeof list[last] === 'string' && countOf(list[last] as string) === 0) last--
  if (last < 0) return cloneElement(element, undefined, withCursor(list, state))
  // Line breaks after the last visible child stay, so the result matches the
  // same text drawn without a cursor.
  const after = list.slice(last + 1)
  if (isValidElement(list[last])) {
    list[last] = appendCursor(list[last], state)
    return cloneElement(element, undefined, [...list.slice(0, last + 1), ...after])
  }
  return cloneElement(element, undefined, [...withCursor(list.slice(0, last + 1), state), ...after])
}

// Shows the first `state.left` visible characters of a node. Structure appears
// with its first character: an element is drawn only once one of its
// characters is. A part that fits whole is returned as it is, so React leaves
// it alone.
function cut(node: ReactNode, state: CutState): ReactNode {
  if (state.left <= 0) return null
  if (typeof node === 'string' || typeof node === 'number') {
    const text = String(node)
    const count = countOf(text)
    if (count === 0) return text
    if (count <= state.left) {
      state.left -= count
      return text
    }
    const part = text.slice(0, state.left)
    state.left = 0
    return part
  }
  if (!isValidElement(node)) return node
  const element = node as AnyElement
  const length = measure(element)
  if (length < state.left || isAtomic(element) || element.props.children === undefined) {
    state.left -= length
    return element
  }
  const children = element.props.children
  const list = Array.isArray(children) ? children : [children]
  const kept: ReactNode[] = []
  for (const child of list) {
    if (state.left <= 0) break
    kept.push(cut(child, state))
    if (state.left <= 0 && !state.placed) {
      const last = kept.pop()
      if (isValidElement(last)) kept.push(appendCursor(last, state))
      else kept.push(...withCursor([last], state))
    }
  }
  return cloneElement(element, undefined, kept)
}

// --- Blocks --------------------------------------------------------------------

export type MarkdownBlock = { key: number; parsed: Parsed }
export type MarkdownBlocks = { blocks: MarkdownBlock[]; length: number }

type Split = {
  resetKey: number | null
  source: string
  finished: MarkdownBlock[]
  tailStart: number
}

const BLANK_LINE = /\n[ \t]*\r?\n/

// Moves every finished top-level block out of the tail. A block is finished
// when a blank line follows it and another block has started: later text can no
// longer change it. Finished blocks are parsed once and left alone.
function advance(previous: Split | null, source: string, resetKey: number | null): Split {
  const fresh = !previous || previous.resetKey !== resetKey || !source.startsWith(previous.source)
  const finished = fresh ? [] : [...previous.finished]
  let tailStart = fresh ? 0 : previous.tailStart
  const tail = source.slice(tailStart)
  const { offsets } = parse(tail)
  let from = 0
  for (let i = 0; i + 1 < offsets.length; i++) {
    const gap = tail.slice(offsets[i][1], offsets[i + 1][0])
    if (!BLANK_LINE.test(gap)) continue
    const next = tail.lastIndexOf('\n', offsets[i + 1][0] - 1) + 1
    finished.push({ key: tailStart + from, parsed: parse(tail.slice(from, next)) })
    from = next
  }
  tailStart += from
  return { resetKey, source, finished, tailStart }
}

// Link reference and footnote definitions ("[x]: ..." or "[^1]: ...") are the
// only Markdown whose meaning crosses blocks. A text without them renders the
// same split into blocks as parsed whole, so a finished reply can keep its
// blocks and nothing is drawn again.
export function needsWholeParse(source: string): boolean {
  return /^ {0,3}\[[^\]\n]+\]:/m.test(source)
}

// The blocks of a text. `whole` parses it in one piece, as the history and the
// inbox do. Otherwise the text is still streaming, and only its last block is
// parsed again when it grows.
export function useMarkdownBlocks(
  source: string,
  resetKey: number | null,
  whole: boolean
): MarkdownBlocks {
  const [split, setSplit] = useState<Split | null>(null)
  let current = split
  if (!whole && (current === null || current.resetKey !== resetKey || current.source !== source)) {
    current = advance(current, source, resetKey)
    setSplit(current)
  }

  const tailStart = whole ? 0 : current!.tailStart
  const finished = whole ? null : current!.finished
  return useMemo(() => {
    const blocks = finished
      ? [...finished, { key: tailStart, parsed: parse(source.slice(tailStart)) }]
      : [{ key: 0, parsed: parse(source) }]
    return { blocks, length: blocks.reduce((sum, block) => sum + block.parsed.length, 0) }
  }, [source, tailStart, finished])
}

// The elements to draw: every block in full, or, while typing, the first
// `shown` visible characters with the cursor after the last one.
export function revealBlocks(
  { blocks, length }: MarkdownBlocks,
  shown: number | null,
  cursor: ReactNode
): ReactNode[] {
  if (shown === null) {
    return blocks.map((block) => <Fragment key={block.key}>{block.parsed.element}</Fragment>)
  }
  const state: CutState = { left: shown >= length ? Infinity : shown, cursor, placed: false }
  const out: ReactNode[] = []
  let lastKey: number | null = null
  let lastNode: ReactNode = null
  for (const block of blocks) {
    if (state.left <= 0) break
    if (lastKey !== null) out.push(<Fragment key={lastKey}>{lastNode}</Fragment>)
    lastKey = block.key
    lastNode = cut(block.parsed.element, state)
  }
  if (lastKey === null) return [<Fragment key={CURSOR_KEY}>{cursor}</Fragment>]
  if (!state.placed) lastNode = appendCursor(lastNode, state)
  out.push(<Fragment key={lastKey}>{lastNode}</Fragment>)
  return out
}
