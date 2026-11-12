import { useState } from 'react'
import './HarnessNote.css'

type HarnessNoteProps = {
  // The note exactly as Claude Code's harness wrote it.
  text: string
}

// The note Claude Code's harness can put in front of an agent's report. Shown
// above the report, closed to begin with, and always as plain text: nothing it
// describes is undone ("<\" stays "<\").
function HarnessNote({ text }: HarnessNoteProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="harness-note">
      <div className="harness-note__head">
        <span className="harness-note__label">HARNESS NOTE</span>
        <button
          type="button"
          className="button button--secondary button--small"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'HIDE' : 'SHOW'}
        </button>
      </div>
      {open && <pre className="harness-note__text">{text}</pre>}
    </div>
  )
}

export default HarnessNote
