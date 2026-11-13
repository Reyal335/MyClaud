import type { MouseEvent } from 'react'
import { useWindowState } from '../hooks/useWindowState'
import type { Crumb } from './titleBarCrumb'
import AppIcon from './AppIcon'
import './TitleBar.css'

// The app name in capitals, as the code names the app everywhere else.
const APP_NAME = 'MYA'

type TitleBarProps = {
  crumb: Crumb
  // Threads running, and waiting for approval. A pill shows only above zero.
  running: number
  waiting: number
  // A thread started waiting since INBOX was last opened: WAITING is filled.
  waitingAlert: boolean
  onOpenInbox: () => void
}

// 12x12 glyphs, 2px strokes, drawn with crisp edges: no anti-aliasing.
const GLYPHS = {
  minimize: 'M1 9h10v2H1z',
  maximize: 'M1 1h10v2H1zM1 3h2v6H1zM9 3h2v6H9zM1 9h10v2H1z',
  restore:
    'M3 0h9v2H3zM10 2h2v7h-2zM3 2h2v1H3zM9 7h1v2H9zM0 3h9v2H0zM0 5h2v5H0zM7 5h2v5H7zM0 10h9v2H0z',
  close:
    'M1 1h2v2H1zM3 3h2v2H3zM5 5h2v2H5zM7 7h2v2H7zM9 9h2v2H9zM9 1h2v2H9zM7 3h2v2H7zM3 7h2v2H3zM1 9h2v2H1z'
}

function Glyph({ name }: { name: keyof typeof GLYPHS }): React.JSX.Element {
  return (
    <span className="title-bar__glyph">
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        shapeRendering="crispEdges"
        aria-hidden="true"
      >
        <path fill="currentColor" d={GLYPHS[name]} />
      </svg>
    </span>
  )
}

function Pill({
  kind,
  count,
  label,
  filled,
  onClick
}: {
  kind: 'running' | 'waiting'
  count: number
  label: string
  filled?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`title-bar__pill title-bar__pill--${kind}${filled ? ' title-bar__pill--filled' : ''}`}
      aria-label={`${count} ${label.toLowerCase()}`}
      onClick={onClick}
    >
      <span className="title-bar__dot" aria-hidden="true" />
      <span>
        {count}
        <span className="title-bar__pill-label"> {label}</span>
      </span>
    </button>
  )
}

// The pixel title bar from designs/12-title-bar.html: the app icon and name, where I am,
// how many threads are running or waiting, and (on Windows and Linux) our own window
// buttons. The whole bar drags the window; the pills and buttons opt out. macOS keeps
// Apple's buttons, so the bar leaves room for them and draws none of its own.
function TitleBar({
  crumb,
  running,
  waiting,
  waitingAlert,
  onOpenInbox
}: TitleBarProps): React.JSX.Element {
  const { maximized, focused, platform } = useWindowState()
  const mac = platform === 'darwin'
  const classes = ['title-bar']
  if (!focused) classes.push('title-bar--blurred')
  if (mac) classes.push('title-bar--mac')

  // Windows maximizes on a double-click in a drag region by itself. Linux may not, so
  // there a double-click on an empty part of the bar asks main to do it; main ignores
  // the request if the system has just done it.
  function handleDoubleClick(event: MouseEvent<HTMLElement>): void {
    if (platform !== 'linux') return
    if ((event.target as HTMLElement).closest('button')) return
    void window.mya.window.toggleMaximize('doubleClick').catch((err: unknown) => {
      console.error('Could not maximize the window:', err)
    })
  }

  return (
    <header className={classes.join(' ')} aria-label="Title bar" onDoubleClick={handleDoubleClick}>
      {mac && <div className="title-bar__traffic" aria-hidden="true" />}
      <div className="title-bar__brand">
        <AppIcon />
        <span className="title-bar__name">{APP_NAME}</span>
      </div>
      <span className="title-bar__divider" aria-hidden="true" />
      <span className="title-bar__crumb">
        {crumb.item ? (
          <>
            <span className="title-bar__screen">
              {crumb.screen} <span aria-hidden="true">/</span>{' '}
            </span>
            <span className="title-bar__item">{crumb.item.main}</span>
            {crumb.item.rest && <span className="title-bar__rest"> {crumb.item.rest}</span>}
          </>
        ) : (
          <span className="title-bar__screen-only">{crumb.screen}</span>
        )}
      </span>
      <span className="title-bar__gap" aria-hidden="true" />
      {(running > 0 || waiting > 0) && (
        <div className="title-bar__pills">
          {running > 0 && (
            <Pill kind="running" count={running} label="RUNNING" onClick={onOpenInbox} />
          )}
          {waiting > 0 && (
            <Pill
              kind="waiting"
              count={waiting}
              label="WAITING"
              filled={waitingAlert}
              onClick={onOpenInbox}
            />
          )}
        </div>
      )}
      {!mac && (
        <div className="title-bar__buttons">
          <button
            type="button"
            className="title-bar__button"
            aria-label="Minimize"
            onClick={() => void window.mya.window.minimize()}
          >
            <Glyph name="minimize" />
          </button>
          <button
            type="button"
            className="title-bar__button"
            aria-label={maximized ? 'Restore' : 'Maximize'}
            onClick={() => void window.mya.window.toggleMaximize()}
          >
            <Glyph name={maximized ? 'restore' : 'maximize'} />
          </button>
          <button
            type="button"
            className="title-bar__button title-bar__button--close"
            aria-label="Close"
            onClick={() => void window.mya.window.close()}
          >
            <Glyph name="close" />
          </button>
        </div>
      )}
    </header>
  )
}

export default TitleBar
