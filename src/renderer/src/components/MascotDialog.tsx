import { useEffect, useId, useRef, useState } from 'react'
import type {
  MascotDraft,
  MascotLoops,
  MascotSheetChange,
  MascotSummary
} from '../../../shared/ipc'
import {
  canReverse,
  DEFAULT_FPS,
  DEFAULT_MASCOT_ID,
  fpsError,
  FRAME_SIZE,
  MASCOT_STATES,
  mascotNameError,
  MAX_FPS,
  MAX_MASCOT_NAME_LENGTH,
  MIN_FPS,
  parseFps,
  type MascotStateName
} from '../../../shared/mascotRules'
import { DEFAULT_MASCOT } from '../mascots/defaultMascot'
import Dialog from './Dialog'
import { startingGrid } from '../../../shared/sliceRules'
import Mascot from './Mascot'
import SheetSlicer, { type SliceGrid, type SliceSource } from './SheetSlicer'
import SheetStrip from './SheetStrip'
import './MascotDialog.css'

export type MascotDialogTarget =
  | { kind: 'new' }
  | { kind: 'edit'; mascot: Extract<MascotSummary, { problem: null }> }
  // The built-in mascot: `uploaded` holds only the loops the user uploaded for it.
  | { kind: 'default'; name: string; uploaded: Partial<MascotLoops> }

type MascotDialogProps = {
  target: MascotDialogTarget
  onDirtyChange: (dirty: boolean) => void
  onSaved: () => void
  // CANCEL and Escape. The screen asks before discarding changes.
  onCancel: () => void
}

type SlotSheet = {
  src: string
  frames: number
  width: number
  fileName: string
  // The default's bundled idle sheet: shown, but never saved or removed.
  builtIn: boolean
}

type Slot = {
  sheet: SlotSheet | null
  change: MascotSheetChange
  // The fps field's text, checked with parseFps.
  fps: string
  // REVERSE AT END: play forward, then back. Only means something with 3+ frames.
  reverse: boolean
  error: string | null
}

type Slots = Record<MascotStateName, Slot>

const BUILT_IN_IDLE = DEFAULT_MASCOT.loops.idle

// What an empty slot falls back to: for the default's idle row, the bundled
// idle sheet; otherwise nothing (the state plays the idle loop).
function fallbackSlot(
  isDefault: boolean,
  state: MascotStateName
): Pick<Slot, 'sheet' | 'fps' | 'reverse'> {
  if (isDefault && state === 'idle') {
    return {
      sheet: {
        src: BUILT_IN_IDLE.src,
        frames: BUILT_IN_IDLE.frames,
        width: BUILT_IN_IDLE.frames * FRAME_SIZE,
        fileName: 'built-in sheet',
        builtIn: true
      },
      fps: String(BUILT_IN_IDLE.fps),
      reverse: false
    }
  }
  return { sheet: null, fps: String(DEFAULT_FPS), reverse: false }
}

function initialSlots(loops: Partial<MascotLoops>, isDefault: boolean): Slots {
  const slots = {} as Slots
  for (const state of MASCOT_STATES) {
    const loop = loops[state]
    const base = loop
      ? {
          sheet: {
            src: loop.src,
            frames: loop.frames,
            width: loop.frames * FRAME_SIZE,
            fileName: `${state}.png`,
            builtIn: false
          },
          fps: String(loop.fps),
          reverse: loop.reverse
        }
      : fallbackSlot(isDefault, state)
    slots[state] = { ...base, change: { type: 'keep' }, error: null }
  }
  return slots
}

function targetName(target: MascotDialogTarget): string {
  if (target.kind === 'edit') return target.mascot.name
  if (target.kind === 'default') return target.name
  return ''
}

function targetLoops(target: MascotDialogTarget): Partial<MascotLoops> {
  if (target.kind === 'edit') return target.mascot.loops
  if (target.kind === 'default') return target.uploaded
  return {}
}

function framesText(frames: number): string {
  return `${frames} ${frames === 1 ? 'frame' : 'frames'}`
}

// The upload dialog from designs/4-mascot-manager.html: a name and one row per
// state. Picked sheets wait in the main process until SAVE; any not saved are
// dropped when the dialog closes.
function MascotDialog({
  target,
  onDirtyChange,
  onSaved,
  onCancel
}: MascotDialogProps): React.JSX.Element {
  const id = useId()
  const formId = `${id}-form`
  const isDefault = target.kind === 'default'
  // The id to update, or null for a new mascot.
  const editId = target.kind === 'edit' ? target.mascot.id : isDefault ? DEFAULT_MASCOT_ID : null
  const [initial] = useState(() => ({
    name: targetName(target),
    slots: initialSlots(targetLoops(target), isDefault)
  }))
  const [name, setName] = useState(initial.name)
  const [nameTouched, setNameTouched] = useState(editId !== null)
  const [slots, setSlots] = useState(initial.slots)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  // The latest sheet picked in another layout. It stays loaded in the main
  // process until the dialog closes, so REUSE SHEET can slice it for other rows.
  // `grid` is the grid last confirmed for it.
  const [source, setSource] = useState<(SliceSource & { grid: SliceGrid | null }) | null>(null)
  // The one row that is slicing, with its own fps text for the preview. The key
  // gives each opening a fresh slicer.
  const [slicing, setSlicing] = useState<{
    state: MascotStateName
    fps: string
    // Whether the slicer opens with REVERSE AT END on.
    reverse: boolean
    key: number
  } | null>(null)
  const slicerOpenings = useRef(0)
  // The blob: URL the source sheet is shown from.
  const sourceUrl = useRef<string | null>(null)

  // Tokens of picked sheets not yet saved. Read through a ref so the latest
  // value is known after an await and on unmount.
  const pending = useRef(new Set<string>())
  const slotsRef = useRef(slots)
  useEffect(() => {
    slotsRef.current = slots
  }, [slots])

  // Closing the dialog drops picks that were not saved and every loaded source sheet.
  useEffect(
    () => () => {
      for (const token of pending.current) void window.myclaud.mascots.discardSheet(token)
      pending.current.clear()
      void window.myclaud.mascots.dropSources()
      if (sourceUrl.current) URL.revokeObjectURL(sourceUrl.current)
      sourceUrl.current = null
    },
    []
  )

  const nameError = mascotNameError(name)
  const filled = MASCOT_STATES.filter((state) => slots[state].sheet)
  const fpsValid = filled.every((state) => parseFps(slots[state].fps) !== null)
  // An open slicer counts as a change, so closing the dialog asks first.
  const dirty =
    slicing !== null ||
    name.trim() !== initial.name.trim() ||
    MASCOT_STATES.some(
      (state) =>
        slots[state].change.type !== 'keep' ||
        (slots[state].sheet !== null &&
          (slots[state].fps !== initial.slots[state].fps ||
            slots[state].reverse !== initial.slots[state].reverse))
    )
  const valid = nameError === null && slots.idle.sheet !== null && fpsValid
  const canSave = valid && dirty && !saving && slicing === null

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])

  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  function updateSlot(state: MascotStateName, patch: Partial<Slot>): void {
    setSlots((current) => ({ ...current, [state]: { ...current[state], ...patch } }))
  }

  function dropToken(change: MascotSheetChange): void {
    if (change.type !== 'token') return
    pending.current.delete(change.token)
    void window.myclaud.mascots.discardSheet(change.token)
  }

  // The speed a new sheet starts at: a replaced upload keeps its speed; an
  // empty slot (or the built-in idle) starts at the default.
  function startingFps(state: MascotStateName): string {
    const before = slotsRef.current[state]
    return before.sheet && !before.sheet.builtIn ? before.fps : String(DEFAULT_FPS)
  }

  // Likewise a replaced upload keeps REVERSE AT END; anything else starts with it off.
  function startingReverse(state: MascotStateName): boolean {
    const before = slotsRef.current[state]
    return Boolean(before.sheet && !before.sheet.builtIn && before.reverse)
  }

  // Puts a strip that waits in the main process behind `token` into a row.
  function fillSlot(
    state: MascotStateName,
    strip: { token: string; preview: string; frames: number; fileName: string },
    fps: string,
    reverse: boolean
  ): void {
    dropToken(slotsRef.current[state].change)
    pending.current.add(strip.token)
    updateSlot(state, {
      sheet: {
        src: strip.preview,
        frames: strip.frames,
        width: strip.frames * FRAME_SIZE,
        fileName: strip.fileName,
        builtIn: false
      },
      change: { type: 'token', token: strip.token },
      fps,
      reverse,
      error: null
    })
  }

  // Opens the slicer on the loaded source for one row. Only one row slices at
  // a time, so this closes any other slicer.
  function openSlicer(state: MascotStateName): void {
    slicerOpenings.current += 1
    setSlicing({
      state,
      fps: startingFps(state),
      reverse: startingReverse(state),
      key: slicerOpenings.current
    })
    updateSlot(state, { error: null })
  }

  async function pick(state: MascotStateName): Promise<void> {
    try {
      const result = await window.myclaud.mascots.pickSheet()
      // A refused sheet leaves the row as it was, slicer and all.
      if (!result.ok) {
        updateSlot(state, { error: result.error.message })
        return
      }
      if (result.canceled) return
      if (result.kind === 'strip') {
        // A legal strip is used as it is.
        fillSlot(state, result, startingFps(state), startingReverse(state))
        setSlicing((current) => (current?.state === state ? null : current))
        return
      }
      // Only the latest sheet is kept, so the previous one's URL is let go.
      if (sourceUrl.current) URL.revokeObjectURL(sourceUrl.current)
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(result.bytes)], { type: 'image/png' })
      )
      sourceUrl.current = url
      setSource({
        token: result.sourceToken,
        fileName: result.fileName,
        width: result.width,
        height: result.height,
        url,
        grid: null
      })
      openSlicer(state)
    } catch (err) {
      console.error('Could not pick a sheet:', err)
      updateSlot(state, { error: 'The sheet could not be opened.' })
    }
  }

  // USE N FRAMES: main cuts the strip; the row then holds it like an uploaded one.
  async function confirmSlice(
    state: MascotStateName,
    fps: string,
    grid: SliceGrid,
    cells: number[],
    reverse: boolean
  ): Promise<string | null> {
    if (!source) return 'This sheet is no longer loaded. Upload it again.'
    try {
      const result = await window.myclaud.mascots.sliceSheet(
        source.token,
        grid.columns,
        grid.rows,
        cells
      )
      if (!result.ok) return result.error.message
      fillSlot(
        state,
        { ...result, fileName: `${source.fileName} · sliced ${grid.columns} x ${grid.rows}` },
        fps,
        reverse
      )
      const token = source.token
      setSource((current) => (current?.token === token ? { ...current, grid } : current))
      setSlicing(null)
      return null
    } catch (err) {
      console.error('Could not slice the sheet:', err)
      return 'The sheet could not be cut into frames.'
    }
  }

  function remove(state: MascotStateName): void {
    const before = slotsRef.current[state]
    dropToken(before.change)
    // Removing a sheet that was never saved just empties the slot again. On the
    // default's idle row, the built-in sheet comes back.
    const savedSheet = initial.slots[state].sheet
    const saved = savedSheet !== null && !savedSheet.builtIn
    updateSlot(state, {
      ...fallbackSlot(isDefault, state),
      change: saved ? { type: 'remove' } : { type: 'keep' },
      error: null
    })
  }

  function toDraft(): MascotDraft {
    const states = {} as MascotDraft['states']
    for (const state of MASCOT_STATES) {
      const slot = slots[state]
      states[state] = {
        fps: parseFps(slot.fps) ?? DEFAULT_FPS,
        reverse: slot.sheet !== null && slot.reverse,
        sheet: slot.change
      }
    }
    return { name: name.trim(), states }
  }

  async function save(): Promise<void> {
    setNameTouched(true)
    if (!canSave) return
    setSaving(true)
    setFormError(null)
    try {
      const draft = toDraft()
      const result = editId
        ? await window.myclaud.mascots.update(editId, draft)
        : await window.myclaud.mascots.create(draft)
      if (result.ok) {
        // Saved sheets are no longer pending; main has already let go of them.
        pending.current.clear()
        onDirtyChange(false)
        onSaved()
        return
      }
      setFormError(result.error.message)
    } catch (err) {
      console.error('Could not save the mascot:', err)
      setFormError('The mascot could not be saved.')
    }
    setSaving(false)
  }

  function renderRow(state: MascotStateName): React.JSX.Element {
    const slot = slots[state]
    const { sheet } = slot
    const label = state.toUpperCase()
    const slicer = slicing?.state === state && source ? { ...slicing, source } : null
    // While slicing, the fps field sets the slicer preview's speed.
    const fpsText = slicer ? slicer.fps : slot.fps
    const fps = parseFps(fpsText)
    const oneFrame = !slicer && sheet?.frames === 1
    const fpsProblem = (slicer || sheet) && !oneFrame ? fpsError(fpsText) : null
    const rowClass = ['sheet-row']
    if (slicer) rowClass.push('sheet-row--slicing')
    else if (slot.error) rowClass.push('sheet-row--error')
    else if (!sheet) rowClass.push('sheet-row--empty')

    let meta = 'No sheet yet'
    if (slicer) {
      meta = `${slicer.source.fileName} · ${slicer.source.width}x${slicer.source.height} · slicing`
    } else if (sheet) {
      meta = `${sheet.fileName} · ${sheet.width}x${FRAME_SIZE} · ${framesText(sheet.frames)}`
    }

    return (
      <section key={state} className={rowClass.join(' ')} aria-label={`${state} loop`}>
        <div className="sheet-row__head">
          <span className={`sheet-row__state sheet-row__state--${state}`}>{label}</span>
          {state === 'idle' && <span className="sheet-row__required">required</span>}
          <span className="sheet-row__meta">{meta}</span>
          {/* Always FPS, UPLOAD or REPLACE, REUSE SHEET, REMOVE, in this order. A control
              that does not apply is disabled, so the buttons never move. */}
          <div className="sheet-row__controls">
            <label className="sheet-row__fps">
              FPS
              <input
                className="sheet-row__fps-input"
                type="number"
                inputMode="numeric"
                min={MIN_FPS}
                max={MAX_FPS}
                step={1}
                value={slicer || sheet ? fpsText : ''}
                disabled={!(slicer || sheet) || oneFrame}
                aria-label={`${state} FPS`}
                aria-invalid={Boolean(fpsProblem)}
                title={
                  oneFrame
                    ? 'A one-frame sheet does not animate.'
                    : !(slicer || sheet)
                      ? 'No sheet yet.'
                      : undefined
                }
                onChange={(event) => {
                  const value = event.target.value
                  if (slicer) setSlicing((current) => current && { ...current, fps: value })
                  else updateSlot(state, { fps: value })
                }}
              />
            </label>
            <button
              type="button"
              className="button button--small sheet-row__button"
              aria-label={`${sheet ? 'Replace' : 'Upload'} ${state} sheet`}
              onClick={() => void pick(state)}
            >
              {sheet ? 'REPLACE' : 'UPLOAD'}
            </button>
            <button
              type="button"
              className="button button--secondary button--small sheet-row__button sheet-row__button--wide"
              disabled={!source || Boolean(slicer)}
              aria-label={
                source ? `Reuse sheet ${source.fileName} for ${state}` : `Reuse sheet for ${state}`
              }
              title={
                source ? `Slice ${source.fileName} again for this state` : 'No sheet loaded yet.'
              }
              onClick={() => openSlicer(state)}
            >
              REUSE SHEET
            </button>
            {/* The default's idle row can drop an uploaded sheet: the built-in one comes back. */}
            <button
              type="button"
              className="button button--secondary button--small sheet-row__button"
              disabled={
                Boolean(slicer) || !sheet || sheet.builtIn || (state === 'idle' && !isDefault)
              }
              aria-label={`Remove ${state} sheet`}
              title={
                state === 'idle'
                  ? isDefault
                    ? 'Goes back to the built-in idle sheet.'
                    : 'Idle is required'
                  : undefined
              }
              onClick={() => remove(state)}
            >
              REMOVE
            </button>
          </div>
        </div>

        {slot.error && (
          <div role="alert" className="sheet-row__error">
            <span className="sheet-row__error-mark" aria-hidden="true">
              X
            </span>
            <span>{slot.error}</span>
          </div>
        )}

        {slicer ? (
          <SheetSlicer
            key={slicer.key}
            source={slicer.source}
            initialGrid={
              slicer.source.grid ?? startingGrid(slicer.source.width, slicer.source.height)
            }
            initialReverse={slicer.reverse}
            fps={fps}
            onUse={(grid, cells, reverse) => confirmSlice(state, slicer.fps, grid, cells, reverse)}
            onCancel={() => setSlicing(null)}
          />
        ) : sheet ? (
          <div className="sheet-row__body">
            <div className="sheet-row__loop">
              <Mascot
                src={sheet.src}
                frames={sheet.frames}
                fps={fps ?? 0}
                reverse={slot.reverse}
                scale={1}
                label={`${state} loop playing`}
              />
            </div>
            <SheetStrip
              src={sheet.src}
              frames={sheet.frames}
              label={`${state} sheet, ${framesText(sheet.frames)}`}
            />
          </div>
        ) : (
          <div className="sheet-row__placeholder">
            {state === 'idle' ? 'Idle is required' : 'Plays the idle loop'}
          </div>
        )}

        {!slicer && sheet && !sheet.builtIn && canReverse(sheet.frames) && (
          <label className="sheet-row__reverse">
            <input
              type="checkbox"
              checked={slot.reverse}
              aria-label={`${state} reverse at end`}
              onChange={(event) => updateSlot(state, { reverse: event.target.checked })}
            />
            REVERSE AT END
            <span className="sheet-row__reverse-note">Plays forward, then back.</span>
          </label>
        )}

        {fpsProblem && <p className="sheet-row__fps-error">{fpsProblem}</p>}
      </section>
    )
  }

  return (
    <Dialog
      title={isDefault ? 'EDIT DEFAULT MASCOT' : editId ? 'EDIT MASCOT' : 'ADD MASCOT'}
      size="wide"
      onClose={onCancel}
      actions={
        <>
          <button
            type="submit"
            form={formId}
            className="button button--primary"
            disabled={!canSave}
          >
            {saving ? 'SAVING...' : 'SAVE MASCOT'}
          </button>
          <button type="button" className="button button--secondary" onClick={onCancel}>
            CANCEL
          </button>
        </>
      }
    >
      <form
        id={formId}
        className="mascot-form"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <div className="mascot-form__field">
          <label htmlFor={`${id}-name`} className="mascot-form__label">
            NAME
          </label>
          <input
            id={`${id}-name`}
            className="mascot-form__input"
            type="text"
            value={name}
            placeholder="Name your mascot"
            maxLength={MAX_MASCOT_NAME_LENGTH}
            aria-invalid={nameTouched && nameError !== null}
            aria-describedby={`${id}-name-help`}
            onChange={(event) => {
              setNameTouched(true)
              setName(event.target.value)
            }}
          />
          <div id={`${id}-name-help`}>
            {nameTouched && nameError && <p className="mascot-form__error">{nameError}</p>}
          </div>
        </div>

        {isDefault && (
          <p className="mascot-form__note">
            This is the built-in mascot. Your name and loops are kept in the app&apos;s data folder
            and the built-in files never change. RESET on its card brings back the built-in version.
          </p>
        )}

        <div className="mascot-form__format">
          <span className="mascot-form__format-title">FORMAT</span>
          <br />
          One spritesheet per state, as a strip or a grid. PNG under 3 MB. A strip of 64x64 frames
          is used as it is. Any other sheet opens the slicer: set columns and rows, then pick the
          frames for the loop. Frames must be square and are scaled to 64x64. Up to 16 frames per
          loop. Idle is required; a state with no sheet plays the idle loop.
        </div>

        <div className="mascot-form__loops-head">
          <span className="mascot-form__label">ANIMATION LOOPS</span>
          <span className="mascot-form__count">{filled.length} of 5 uploaded</span>
        </div>

        {MASCOT_STATES.map(renderRow)}

        {formError && (
          <div role="alert" className="mascot-form__alert">
            {formError}
          </div>
        )}
      </form>
    </Dialog>
  )
}

export default MascotDialog
