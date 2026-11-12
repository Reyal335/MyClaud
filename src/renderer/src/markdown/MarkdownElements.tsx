import { useEffect, useState, type ComponentProps, type MouseEvent } from 'react'
import type { ExtraProps } from 'react-markdown'
import { safeUrl } from './safeUrl'

// The elements the Markdown component draws in its own way. Styles are in
// components/Markdown.css, under .md.

// Syntax tree nodes, as far as these elements need them.
export type TreeNode = {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: TreeNode[]
  position?: { start: { offset?: number }; end: { offset?: number } }
}

function textOf(node: TreeNode | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.value ?? ''
  return (node.children ?? []).map(textOf).join('')
}

function stopClick(event: MouseEvent): void {
  // The dialogue box skips the typing on a click. A link or COPY should not.
  event.stopPropagation()
}

export function MarkdownLink({
  href,
  children
}: ComponentProps<'a'> & ExtraProps): React.JSX.Element {
  // urlTransform has already dropped every address that is not http or https.
  const url = href ? safeUrl(href) : null
  if (!url) return <span>{children}</span>
  // The full address is the title, so the link text cannot hide where it goes.
  return (
    <a href={url} title={url} target="_blank" rel="noreferrer noopener" onClick={stopClick}>
      {children}
    </a>
  )
}

// A paragraph that is nothing but one bold run, such as "**Summary**", is drawn
// as a level 3 heading: Claude often writes headings this way.
export function MarkdownParagraph({
  children,
  node
}: ComponentProps<'p'> & ExtraProps): React.JSX.Element {
  const parts = ((node as TreeNode | undefined)?.children ?? []).filter(
    (child) => !(child.type === 'text' && (child.value ?? '').trim() === '')
  )
  const boldOnly =
    parts.length === 1 && parts[0].type === 'element' && parts[0].tagName === 'strong'
  return <p className={boldOnly ? 'md__heading' : undefined}>{children}</p>
}

const COPIED_MS = 1500

export function MarkdownCodeBlock({
  children,
  node
}: ComponentProps<'pre'> & ExtraProps): React.JSX.Element {
  const code = ((node as TreeNode | undefined)?.children ?? []).find(
    (child) => child.type === 'element' && child.tagName === 'code'
  )
  const classes = code?.properties?.className
  const language =
    (Array.isArray(classes) ? classes : [])
      .map(String)
      .find((name) => name.startsWith('language-'))
      ?.slice('language-'.length) ?? null
  // The block's text ends with one newline that is not part of the code.
  const text = textOf(code).replace(/\n$/, '')
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    if (copy === 'idle') return
    const timer = setTimeout(() => setCopy('idle'), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copy])

  function handleCopy(event: MouseEvent): void {
    event.stopPropagation()
    navigator.clipboard.writeText(text).then(
      () => setCopy('copied'),
      () => setCopy('failed')
    )
  }

  return (
    <div className="md__code">
      <div className="md__code-head">
        {language && <span className="md__code-lang">{language}</span>}
        <button
          type="button"
          className="button button--secondary button--small md__copy"
          onClick={handleCopy}
        >
          {copy === 'copied' ? 'COPIED' : copy === 'failed' ? 'COPY FAILED' : 'COPY'}
        </button>
      </div>
      <pre className="md__pre">{children}</pre>
    </div>
  )
}

// A wide table scrolls sideways inside its own wrapper.
export function MarkdownTable({
  children
}: ComponentProps<'table'> & ExtraProps): React.JSX.Element {
  return (
    <div className="md__table">
      <table>{children}</table>
    </div>
  )
}

// Task list boxes are drawn, never real inputs, and cannot be clicked.
export function MarkdownTaskBox({
  checked,
  type
}: ComponentProps<'input'> & ExtraProps): React.JSX.Element | null {
  if (type !== 'checkbox') return null
  return (
    <span
      className={`md__box${checked ? ' md__box--checked' : ''}`}
      role="img"
      aria-label={checked ? 'Done' : 'Not done'}
    />
  )
}

// Never reached: images are replaced before rendering. Kept so no img is ever made.
export function MarkdownNoImage({ alt }: ComponentProps<'img'> & ExtraProps): React.JSX.Element {
  return <span>{alt ?? ''}</span>
}
