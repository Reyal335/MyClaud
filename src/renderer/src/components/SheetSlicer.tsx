import { useEffect, useState, type CSSProperties } from 'react'
import { checkSlice, defaultPicks, MAX_GRID, SLICE_GRID_MESSAGE } from '../../../shared/sliceRules'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import './SheetSlicer.css'

export type SliceSource = {
  token: string
  fileName: string
  width: number
  height: number
  // A blob: URL of the sheet. The dialog makes it and revokes it.
  url: string
}

export type SliceGrid = { columns: number; rows: number }

type SheetSlicerProps = {
  source: SliceSource
  initialGrid: SliceGrid
  // The row's fps, or null while the field is not a valid number.
  fps: number | null
  // Makes the strip. Resolves to an error message, or null when it worked.
  onUse: (grid: SliceGrid, cells: number[]) => Promise<string | null>
  onCancel: () => void
}

// The largest the sheet is drawn, in CSS pixels, on each side.
const SHEET_BOX = 384
const PREVIEW_SIZE = 128
const LOOP_FRAME_SIZE = 64

const MARKS = { ok: 'OK', warning: '!', error: 'X' } as const

// Shows one cell of the source at `size` pixels. The sheet itself comes from
// the --slice-src variable set once on the slicer.
function cellStyle(grid: SliceGrid, cell: number, size: number): CSSProperties {
  return {
    width: size,
    height: size,
    backgroundSize: `${grid.columns * size}px ${grid.rows * size}px`,
    backgroundPosition: `${-(cell % grid.columns) * size}px ${-Math.floor(cell / grid.columns) * size}px`
  }
}

function framesText(count: number): string {
  return `${count} ${count === 1 ? 'FRAME' : 'FRAMES'}`
}

function formatSize(value: number): string {
  return String(Math.round(value * 10) / 10)
}

// What a typed columns or rows field holds: a whole number from 1 to MAX_GRID,
// or null for anything else (empty, partial, fractional, out of range).
function parseGridSize(text: string): number | null {
  if (text.trim() === '') return null
  const value = Number(text)
  return Number.isInteger(value) && value >= 1 && value <= MAX_GRID ? value : null
}

// The sheet slicer from designs/7-sheet-slicer.html: set the grid, click cells
// in play order, watch the loop, and USE the picked frames as a 64x64 strip.
function SheetSlicer({
  source,
  initialGrid,
  fps,
  onUse,
  onCancel
}: SheetSlicerProps): React.JSX.Element {
  const reducedMotion = usePrefersReducedMotion()
  const [grid, setGrid] = useState(initialGrid)
  // What the two number fields show. It follows the grid, except while the text
  // typed is not a valid size: then the grid keeps its last good value.
  const [draft, setDraft] = useState({
    columns: String(initialGrid.columns),
    rows: String(initialGrid.rows)
  })
  const [picks, setPicks] = useState(() => defaultPicks(initialGrid.columns, initialGrid.rows))
  const [playing, setPlaying] = useState(false)
  const [frame, setFrame] = useState(0)
  const [useError, setUseError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const status = checkSlice(source.width, source.height, grid.columns, grid.rows, picks)
  const draftInvalid = parseGridSize(draft.columns) === null || parseGridSize(draft.rows) === null
  const level = draftInvalid || useError ? 'error' : status.level
  const message = draftInvalid ? SLICE_GRID_MESSAGE : (useError ?? status.message)
  const canUse = status.canUse && !draftInvalid
  const cellCount = grid.columns * grid.rows
  const canPlay = picks.length > 0
  const animating = playing && !reducedMotion && picks.length > 1 && fps !== null
  const shown = picks.length > 0 ? frame % picks.length : 0

  useEffect(() => {
    if (!animating || fps === null) return
    const timer = window.setInterval(() => setFrame((f) => f + 1), 1000 / fps)
    return () => window.clearInterval(timer)
  }, [animating, fps])

  function changePicks(next: number[]): void {
    setPicks(next)
    setFrame(0)
    setUseError(null)
    if (next.length === 0) setPlaying(false)
  }

  function changeGrid(next: SliceGrid): void {
    if (!Number.isInteger(next.columns) || !Number.isInteger(next.rows)) return
    const columns = Math.min(MAX_GRID, Math.max(1, next.columns))
    const rows = Math.min(MAX_GRID, Math.max(1, next.rows))
    setGrid({ columns, rows })
    setPlaying(false)
    changePicks(defaultPicks(columns, rows))
  }

  function toggle(cell: number): void {
    changePicks(picks.includes(cell) ? picks.filter((c) => c !== cell) : [...picks, cell])
  }

  async function use(): Promise<void> {
    if (!canUse || busy) return
    setBusy(true)
    const error = await onUse(grid, picks)
    // On success the slicer closes; on failure it stays open with the message.
    if (error) {
      setUseError(error)
      setBusy(false)
    }
  }

  // Whole-number scale when the sheet fits the box, scaled down to fit when not.
  let scale = Math.min(SHEET_BOX / source.width, SHEET_BOX / source.height)
  if (scale >= 1) scale = Math.floor(scale)
  const drawnWidth = Math.max(1, Math.round(source.width * scale))
  const drawnHeight = Math.max(1, Math.round(source.height * scale))

  const rootStyle = { '--slice-src': `url("${source.url}")` } as CSSProperties
  const gridStyle = {
    gridTemplateColumns: `repeat(${grid.columns}, 1fr)`,
    gridTemplateRows: `repeat(${grid.rows}, 1fr)`
  }

  const stepper = (name: 'Columns' | 'Rows', key: keyof SliceGrid): React.JSX.Element => {
    const value = grid[key]
    const step = (to: number): void => {
      changeGrid({ ...grid, [key]: to })
      setDraft((current) => ({ ...current, [key]: String(to) }))
    }
    return (
      <div className="slicer__stepper-group" role="group" aria-label={name}>
        <span className="slicer__label">{name.toUpperCase()}</span>
        <div className="slicer__stepper">
          <button
            type="button"
            aria-label={`Fewer ${name.toLowerCase()}`}
            disabled={value <= 1}
            onClick={() => step(value - 1)}
          >
            -
          </button>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_GRID}
            step={1}
            value={draft[key]}
            aria-label={name}
            aria-invalid={parseGridSize(draft[key]) === null}
            onChange={(event) => {
              const text = event.target.value
              setDraft((current) => ({ ...current, [key]: text }))
              const typed = parseGridSize(text)
              // Only a real change resets the picks; anything else keeps the grid.
              if (typed !== null && typed !== value) changeGrid({ ...grid, [key]: typed })
            }}
            onBlur={() => setDraft((current) => ({ ...current, [key]: String(value) }))}
            onKeyDown={(event) => {
              // The slicer sits inside the dialog's form: Enter must not submit it.
              if (event.key === 'Enter') event.preventDefault()
            }}
          />
          <button
            type="button"
            aria-label={`More ${name.toLowerCase()}`}
            disabled={value >= MAX_GRID}
            onClick={() => step(value + 1)}
          >
            +
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="slicer" style={rootStyle}>
      <div className="slicer__head">
        <h3 className="slicer__title">SLICE SHEET</h3>
        <span className="slicer__note">
          Set the grid, then click cells in play order. Click a cell again to drop it.
        </span>
      </div>

      <div className="slicer__body">
        <div className="slicer__sheet-scroll">
          <div
            className={`slicer__sheet slicer__sheet--${status.level} slicer-checker`}
            style={{ width: drawnWidth + 8, height: drawnHeight + 8 }}
          >
            <div className="slicer__art" />
            <div className="slicer__cells" style={gridStyle}>
              {Array.from({ length: cellCount }, (_, cell) => {
                const at = picks.indexOf(cell)
                const row = Math.floor(cell / grid.columns) + 1
                const column = (cell % grid.columns) + 1
                return (
                  <button
                    key={cell}
                    type="button"
                    className={`slicer__cell${at >= 0 ? ' slicer__cell--on' : ''}`}
                    aria-pressed={at >= 0}
                    aria-label={`Frame ${cell + 1}, row ${row} column ${column}`}
                    onClick={() => toggle(cell)}
                  >
                    {at >= 0 && <span className="slicer__badge">{at + 1}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <div className="slicer__side">
          <div className="slicer__steppers">
            {stepper('Columns', 'columns')}
            {stepper('Rows', 'rows')}
          </div>
          <div className="slicer__note">
            Sheet {source.width}x{source.height} · {cellCount} {cellCount === 1 ? 'cell' : 'cells'}{' '}
            of{' '}
            <span className="slicer__strong">
              {formatSize(source.width / grid.columns)}x{formatSize(source.height / grid.rows)}
            </span>
          </div>
          <div
            className={`slicer__status slicer__status--${level}`}
            role={level === 'error' ? 'alert' : 'status'}
          >
            <span className="slicer__status-mark">{MARKS[level]}</span>
            <span>{message}</span>
          </div>

          <div className="slicer__preview-line">
            <div className="slicer__stack">
              <span className="slicer__label">PREVIEW</span>
              <div className="slicer__preview slicer-checker">
                {canPlay ? (
                  <div
                    className="slicer__px"
                    role="img"
                    aria-label="Loop preview"
                    style={cellStyle(grid, picks[shown], PREVIEW_SIZE)}
                  />
                ) : (
                  <div
                    className="slicer__px"
                    style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE }}
                  />
                )}
              </div>
            </div>
            <div className="slicer__stack">
              <span className="slicer__note">
                {canPlay
                  ? `Frame ${shown + 1} of ${picks.length} at ${fps ?? '-'} fps`
                  : 'Nothing to play'}
              </span>
              <button
                type="button"
                className="button button--small slicer__button"
                disabled={!canPlay || reducedMotion}
                title={
                  reducedMotion ? 'Reduced motion is on: the first frame is shown.' : undefined
                }
                onClick={() => {
                  setFrame(0)
                  setPlaying(!playing)
                }}
              >
                {playing ? 'STOP' : 'PLAY'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="slicer__stack slicer__frames-block">
        <div className="slicer__frames-head">
          <span className="slicer__label">LOOP FRAMES</span>
          <span className="slicer__note">
            {picks.length} of {cellCount} cells picked
          </span>
          <button
            type="button"
            className="button button--secondary button--small slicer__button slicer__push"
            onClick={() => changePicks(Array.from({ length: cellCount }, (_, i) => i))}
          >
            PICK ALL
          </button>
          <button
            type="button"
            className="button button--secondary button--small slicer__button"
            onClick={() => changePicks([])}
          >
            CLEAR
          </button>
        </div>
        {picks.length > 0 ? (
          <ol className="slicer__frames">
            {picks.map((cell, k) => (
              <li key={cell} className="slicer__frame">
                <div className="slicer__frame-box slicer-checker">
                  <div
                    className="slicer__px"
                    role="img"
                    aria-label={`Loop frame ${k + 1}`}
                    style={cellStyle(grid, cell, LOOP_FRAME_SIZE)}
                  />
                </div>
                <span className="slicer__note">{k + 1}</span>
              </li>
            ))}
          </ol>
        ) : (
          <div className="slicer__no-picks">No frames picked. Click a cell on the sheet.</div>
        )}
      </div>

      <div className="slicer__actions">
        <button
          type="button"
          className="button button--primary"
          disabled={!canUse || busy}
          onClick={() => void use()}
        >
          USE {framesText(picks.length)}
        </button>
        <button type="button" className="button button--secondary" onClick={onCancel}>
          CANCEL SLICE
        </button>
      </div>
    </div>
  )
}

export default SheetSlicer
