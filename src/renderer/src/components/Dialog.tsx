import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import './Dialog.css'

type DialogProps = {
  title: string
  tone?: 'default' | 'danger'
  children: ReactNode
  // The buttons. The first one gets focus when the dialog opens.
  actions: ReactNode
  // Called on Escape.
  onClose: () => void
}

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

// A modal dialog: traps focus, closes on Escape, and gives focus back to the
// element that opened it.
function Dialog({
  title,
  tone = 'default',
  children,
  actions,
  onClose
}: DialogProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const first = ref.current?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? ref.current)?.focus()
    return () => {
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab' || !ref.current) return
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (items.length === 0) {
      event.preventDefault()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="dialog-backdrop">
      <div
        ref={ref}
        className={`dialog dialog--${tone}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h2 id={titleId} className="dialog__title">
          {title}
        </h2>
        <div className="dialog__body">{children}</div>
        <div className="dialog__actions">{actions}</div>
      </div>
    </div>
  )
}

export default Dialog
