import type { ReactNode } from 'react'
import { revealBlocks, useMarkdownBlocks, type MarkdownBlocks } from '../markdown/markdownTree'
import './Markdown.css'

// Markdown written by Claude or an agent, in the app's own look (DESIGN.md,
// Markdown). The one place Markdown is drawn: CHAT replies, and the inbox's TASK
// and REPORT. Rendering happens here only; the stored text never changes.

type MarkdownProps = {
  // Inbox: lines of text at most about 78 characters wide.
  measure?: boolean
} & (
  | { source: string; blocks?: undefined; shown?: undefined; cursor?: undefined }
  | {
      source?: undefined
      // From useMarkdownBlocks, for the dialogue box while it types.
      blocks: MarkdownBlocks
      // Visible characters to show. Nothing after them is drawn yet.
      shown: number
      // Drawn right after the last character shown.
      cursor: ReactNode
    }
)

function Markdown(props: MarkdownProps): React.JSX.Element {
  const own = useMarkdownBlocks(props.source ?? '', null, true)
  const content = props.blocks
    ? revealBlocks(props.blocks, props.shown, props.cursor)
    : revealBlocks(own, null, null)
  return <div className={props.measure ? 'md md--measure' : 'md'}>{content}</div>
}

export default Markdown
