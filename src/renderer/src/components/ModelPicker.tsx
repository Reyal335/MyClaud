import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  AUTO,
  AUTO_MODEL_DESCRIPTION,
  LEVEL_DESCRIPTIONS,
  LEVEL_LABELS,
  METER_BLOCKS,
  NO_LEVEL_LINE,
  choiceLabel,
  meterFill,
  modelBars,
  modelDescription,
  optionLabel,
  pickerLevels,
  resolveChoice,
  type ModelChoice,
  type ModelLists
} from '../../../shared/models'
import './ModelPicker.css'

type ModelPickerProps = {
  lists: ModelLists | null
  listFailed: boolean
  choice: ModelChoice
  asDefault: boolean
  onAsDefaultChange: (on: boolean) => void
  onPick: (next: ModelChoice) => void
  // The chat already has replies from Claude.
  hasReplies: boolean
  // The picker opened: a failed model list is tried again.
  onOpen: () => void
}

// The thinking meter: 4 blocks, filled for the level. AUTO shows alternating blocks.
function Meter({ effort, size }: { effort: string; size: 'small' | 'large' }): React.JSX.Element {
  const fill = meterFill(effort)
  return (
    <span className={`meter meter--${size}`} aria-hidden="true">
      {Array.from({ length: METER_BLOCKS }, (_, i) => {
        const on = fill === 'dotted' ? i % 2 === 0 : i < fill
        const kind = fill === 'dotted' ? (on ? 'dotted' : 'off') : on ? 'on' : 'off'
        return <span key={i} className={`meter__block meter__block--${kind}`} />
      })}
    </span>
  )
}

// POWER or SPEED: three blocks, `filled` of them lit. null leaves the space empty so
// the columns line up. `dotted` is AUTO's alternating blocks.
function Bars({
  kind,
  filled
}: {
  kind: 'power' | 'speed'
  filled: number | 'dotted' | null
}): React.JSX.Element {
  if (filled === null) return <span className="bars bars--none" aria-hidden="true" />
  return (
    <span className={`bars bars--${kind}`} aria-hidden="true">
      {[0, 1, 2].map((i) => {
        const on = filled === 'dotted' ? i !== 1 : i < filled
        return (
          <span
            key={i}
            className={`bars__block${on ? ' bars__block--on' : ''}${filled === 'dotted' ? ' bars__block--dotted' : ''}`}
          />
        )
      })}
    </span>
  )
}

// The model and thinking picker from designs/10-model-picker.html: a control at the
// left of the input row, and a dialog above the row. Picking applies at once.
function ModelPicker({
  lists,
  listFailed,
  choice,
  asDefault,
  onAsDefaultChange,
  onPick,
  hasReplies,
  onOpen
}: ModelPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const controlRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  // The model when the picker opened, to tell whether this visit switched models.
  const [openedWith, setOpenedWith] = useState(choice.model)

  const label = choiceLabel(choice, lists)
  const levels = pickerLevels(choice.model, lists)
  const takesLevel = levels.length > 0
  const selectedEffort = takesLevel ? choice.effort : AUTO
  const switched = hasReplies && choice.model !== openedWith

  function openPicker(): void {
    setOpenedWith(choice.model)
    setOpen(true)
    onOpen()
  }

  function close(returnFocus: boolean): void {
    setOpen(false)
    if (returnFocus) controlRef.current?.focus()
  }

  // Focus moves into the picker when it opens: onto the selected model.
  useEffect(() => {
    if (!open) return
    const selected = dialogRef.current?.querySelector<HTMLElement>(
      '.model-picker__row[aria-pressed="true"]'
    )
    const first = dialogRef.current?.querySelector<HTMLElement>('button, input')
    ;(selected ?? first)?.focus()
  }, [open])

  // A click anywhere outside closes it. Focus stays where the click put it.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent): void {
      const target = event.target as Node
      if (dialogRef.current?.contains(target) || controlRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
      return
    }
    // Arrow keys move through the model rows (up and down) and the level buttons
    // (left and right). Tab moves through everything too.
    const target = event.target as HTMLElement
    const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown'
    const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight'
    if (!vertical && !horizontal) return
    const group = target.closest<HTMLElement>(
      vertical ? '.model-picker__models' : '.model-picker__levels'
    )
    if (!group) return
    const buttons = [...group.querySelectorAll<HTMLElement>('button')]
    const index = buttons.indexOf(target)
    if (index < 0) return
    event.preventDefault()
    const step = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1
    buttons[(index + step + buttons.length) % buttons.length].focus()
  }

  function pickModel(model: string): void {
    // The level is made to fit the new model by the hook and by main.
    onPick(resolveChoice({ model, effort: choice.effort }, lists).choice)
  }

  return (
    <>
      <button
        ref={controlRef}
        type="button"
        className={`model-picker__control${open ? ' model-picker__control--open' : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => (open ? close(false) : openPicker())}
        onKeyDown={(event) => {
          if (open && event.key === 'Escape') {
            event.preventDefault()
            close(true)
          }
        }}
      >
        <Meter effort={choice.effort} size="small" />
        <span>{label.model}</span>
        <span className="model-picker__dot">·</span>
        <span className="model-picker__dot">THINK {label.level}</span>
        <span className="model-picker__caret" aria-hidden="true">
          v
        </span>
      </button>

      {open && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-label="Model and thinking"
          className="model-picker__dialog"
          onKeyDown={handleKeyDown}
        >
          <div className="model-picker__head">
            <h2 className="model-picker__title">MODEL</h2>
            <span className="model-picker__columns" aria-hidden="true">
              <span>POWER</span>
              <span>SPEED</span>
            </span>
          </div>

          <div className="model-picker__models" role="group" aria-label="Model">
            <ModelRow
              selected={choice.model === AUTO}
              name="AUTO"
              description={AUTO_MODEL_DESCRIPTION}
              power="dotted"
              speed="dotted"
              onClick={() => pickModel(AUTO)}
            />
            {lists?.models.map((option) => {
              const bars = modelBars(option)
              return (
                <ModelRow
                  key={option.value}
                  selected={choice.model === option.value}
                  name={optionLabel(option)}
                  description={modelDescription(option)}
                  power={bars ? bars.power : null}
                  speed={bars ? bars.speed : null}
                  onClick={() => pickModel(option.value)}
                />
              )
            })}
          </div>
          {listFailed && <p className="model-picker__error">Couldn&apos;t load the model list.</p>}

          <div className="model-picker__head model-picker__head--divided">
            <h2 className="model-picker__title">THINKING</h2>
            <Meter effort={choice.effort} size="large" />
          </div>

          <div className="model-picker__levels" role="group" aria-label="Thinking power">
            <LevelButton
              selected={selectedEffort === AUTO}
              label="AUTO"
              onClick={() => onPick({ model: choice.model, effort: AUTO })}
            />
            {levels.map((level) => (
              <LevelButton
                key={level}
                selected={selectedEffort === level}
                label={LEVEL_LABELS[level]}
                onClick={() => onPick({ model: choice.model, effort: level })}
              />
            ))}
          </div>
          <p className="model-picker__level-line">
            {takesLevel
              ? LEVEL_DESCRIPTIONS[
                  selectedEffort === AUTO
                    ? 'auto'
                    : (selectedEffort as keyof typeof LEVEL_DESCRIPTIONS)
                ]
              : NO_LEVEL_LINE}
          </p>

          <div className="model-picker__footer">
            <label className="model-picker__check">
              <input
                type="checkbox"
                checked={asDefault}
                onChange={(event) => onAsDefaultChange(event.target.checked)}
              />
              Use for new chats too
            </label>
            <button type="button" className="model-picker__done" onClick={() => close(true)}>
              DONE
            </button>
          </div>
          <p className="model-picker__note">
            Changes apply from your next message. Party agents you call keep the model set in their
            agent file.
          </p>
          {switched && (
            <p className="model-picker__note">
              Switching models re-reads the whole chat, which uses more of your plan.
            </p>
          )}
        </div>
      )}
    </>
  )
}

function ModelRow({
  selected,
  name,
  description,
  power,
  speed,
  onClick
}: {
  selected: boolean
  name: string
  description: string
  power: number | 'dotted' | null
  speed: number | 'dotted' | null
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`model-picker__row${selected ? ' model-picker__row--selected' : ''}`}
      onClick={onClick}
    >
      <span className="model-picker__row-text">
        <span className="model-picker__row-name">{name}</span>
        <span className="model-picker__row-description">{description}</span>
      </span>
      <Bars kind="power" filled={power} />
      <Bars kind="speed" filled={speed} />
    </button>
  )
}

function LevelButton({
  selected,
  label,
  onClick
}: {
  selected: boolean
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`model-picker__level${selected ? ' model-picker__level--selected' : ''}`}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

export default ModelPicker
