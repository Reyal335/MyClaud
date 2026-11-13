import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import './Dialog.css'

type DialogProps = {
  title: string
  // A short line beside the title, in a smaller, quieter style.
  subtitle?: string
  tone?: 'default' | 'danger'
  // Wide dialogs hold a whole form and scroll inside when the window is short.
  size?: 'default' | 'wide'
  children: ReactNode
  // The buttons. The first one gets focus when the dialog opens.
  actions: ReactNode
  // Called on Escape.
  onClose: () => void
  // Called when the dimmed backdrop outside the dialog is clicked. Leave it out for
  // a dialog that only Escape or its buttons may close.
  onBackdropClick?: () => void
}

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

// The elements Tab can stop on. A group of radio buttons is one stop: the checked
// one, or the first when none is checked.
function tabStops(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => {
    if (!(element instanceof HTMLInputElement) || element.type !== 'radio' || element.name === '') {
      return true
    }
    const group = [
      ...root.querySelectorAll<HTMLInputElement>(
        `input[type="radio"][name="${CSS.escape(element.name)}"]`
      )
    ]
    return element === (group.find((radio) => radio.checked) ?? group[0])
  })
}

// A modal dialog: traps focus, closes on Escape, and gives focus back to the
// element that opened it. Focus goes to the element marked data-autofocus when there
// is one, else the first thing it can reach.
function Dialog({
  title,
  subtitle,
  tone = 'default',
  size = 'default',
  children,
  actions,
  onClose,
  onBackdropClick
}: DialogProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const subtitleId = useId()

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const first =
      ref.current?.querySelector<HTMLElement>('[data-autofocus]') ??
      (ref.current ? tabStops(ref.current)[0] : undefined)
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
    const items = tabStops(ref.current)
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
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        // Only a press that starts on the backdrop itself, not one that starts in the
        // dialog and is released outside it.
        if (event.target === event.currentTarget) onBackdropClick?.()
      }}
    >
      <div
        ref={ref}
        className={`dialog dialog--${tone}${size === 'wide' ? ' dialog--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {subtitle ? (
          <div className="dialog__header">
            <h2 id={titleId} className="dialog__title">
              {title}
            </h2>
            <span id={subtitleId} className="dialog__subtitle">
              {subtitle}
            </span>
          </div>
        ) : (
          <h2 id={titleId} className="dialog__title">
            {title}
          </h2>
        )}
        <div className="dialog__body">{children}</div>
        <div className="dialog__actions">{actions}</div>
      </div>
    </div>
  )
}

export default Dialog
