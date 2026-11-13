import { useId, useState, type FormEvent } from 'react'
import type { AddThemeResult, ThemeChoiceChange } from '../../../shared/ipc'
import {
  FADE_STEP,
  MAX_FADE,
  MAX_THEME_NAME_LENGTH,
  NONE_THEME,
  deleteThemeText,
  themeNameError,
  type ThemeChoice
} from '../../../shared/themes'
import { entryFor, type ThemeEntry } from '../themes/themeEntries'
import Dialog from './Dialog'
import ThemeBackdrop from './ThemeBackdrop'
import './ThemePicker.css'

type ThemePickerProps = {
  // None, Tokyo Night, and the uploads, oldest first.
  entries: ThemeEntry[]
  // The choice this chat shows now. It gets the ACTIVE tag.
  active: ThemeChoice
  // The chat has a choice of its own, so APPLY TO starts on THIS CHAT.
  ownChoice: boolean
  // Return a message to show when it failed, else null.
  onApply: (change: ThemeChoiceChange) => Promise<string | null>
  onAdd: () => Promise<AddThemeResult>
  onRename: (id: string, name: string) => Promise<string | null>
  onRemove: (id: string) => Promise<{ error: string | null; active: ThemeChoice | null }>
  onClose: () => void
}

type Scope = 'chat' | 'all'

// Sample text for the preview, from designs/11-chat-themes.html.
const SAMPLE_MINE = 'Review the auth changes.'
const SAMPLE_REPLY = 'I found 2 issues in src/auth.js.'

// What a tile says under its name.
const KIND_LABEL: Record<ThemeEntry['kind'], string> = {
  none: 'Plain navy',
  'built-in': 'Built-in',
  uploaded: 'Uploaded'
}

// The theme picker from designs/11-chat-themes.html, as a modal over CHAT. It works
// on a draft: nothing about the chat changes until APPLY. CANCEL, Escape, and a click
// on the backdrop close without saving. Uploads, renames, and deletes are saved when
// they are made.
function ThemePicker({
  entries,
  active,
  ownChoice,
  onApply,
  onAdd,
  onRename,
  onRemove,
  onClose
}: ThemePickerProps): React.JSX.Element {
  const [draft, setDraft] = useState<ThemeChoice>(active)
  const [scope, setScope] = useState<Scope>(ownChoice ? 'chat' : 'all')
  const [addError, setAddError] = useState<string | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState<ThemeEntry | null>(null)
  const [deleting, setDeleting] = useState<ThemeEntry | null>(null)
  const tileGroup = useId()
  const scopeGroup = useId()
  const fadeId = useId()

  // The draft names a theme that is gone (deleted): it draws as none.
  const selected = entryFor(draft.themeId, entries)

  async function apply(): Promise<void> {
    setBusy(true)
    setApplyError(null)
    const error = await onApply({ scope, themeId: selected.id, fade: draft.fade })
    setBusy(false)
    if (error) setApplyError(error)
    else onClose()
  }

  async function add(): Promise<void> {
    // The error from the last attempt clears on the next one.
    setAddError(null)
    const result = await onAdd()
    if (!result.ok) setAddError(result.error.message)
    // A new theme becomes the draft selection.
    else if (!result.canceled) setDraft((current) => ({ ...current, themeId: result.theme.id }))
  }

  async function confirmDelete(entry: ThemeEntry): Promise<void> {
    const result = await onRemove(entry.id)
    setDeleting(null)
    if (result.error) {
      setApplyError(result.error)
      return
    }
    // The chat's theme may have fallen back: the draft follows it.
    setDraft((current) =>
      current.themeId === entry.id
        ? { ...current, themeId: result.active?.themeId ?? NONE_THEME }
        : current
    )
  }

  return (
    <>
      <Dialog
        title="CHAT THEME"
        subtitle="Background shown behind a conversation"
        size="wide"
        onClose={onClose}
        onBackdropClick={onClose}
        actions={
          <>
            <button
              type="button"
              className="button button--primary"
              disabled={busy}
              onClick={() => void apply()}
            >
              APPLY
            </button>
            <button type="button" className="button button--secondary" onClick={onClose}>
              CANCEL
            </button>
          </>
        }
      >
        <div className="theme-picker">
          <div className="theme-picker__list">
            <fieldset className="theme-picker__grid">
              <legend className="visually-hidden">Theme</legend>
              {entries.map((entry) => {
                const isSelected = entry.id === selected.id
                return (
                  <div key={entry.id} className="theme-picker__cell">
                    <label className={`theme-tile${isSelected ? ' theme-tile--selected' : ''}`}>
                      <span className="theme-tile__thumb" aria-hidden="true">
                        <ThemeBackdrop image={entry.image} fade={0} thumbnail />
                      </span>
                      <span className="theme-tile__name">
                        <input
                          type="radio"
                          name={tileGroup}
                          value={entry.id}
                          checked={isSelected}
                          data-autofocus={isSelected ? '' : undefined}
                          onChange={() =>
                            setDraft((current) => ({ ...current, themeId: entry.id }))
                          }
                        />
                        {entry.name}
                      </span>
                      <span className="theme-tile__kind">
                        {KIND_LABEL[entry.kind]}
                        {active.themeId === entry.id && (
                          <span className="theme-tile__active">ACTIVE</span>
                        )}
                      </span>
                    </label>
                    {isSelected && entry.kind === 'uploaded' && (
                      <div className="theme-tile__actions">
                        <button
                          type="button"
                          className="button button--secondary button--small"
                          onClick={() => setRenaming(entry)}
                        >
                          RENAME
                        </button>
                        <button
                          type="button"
                          className="button button--danger button--small"
                          onClick={() => setDeleting(entry)}
                        >
                          DELETE
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}

              <div className="theme-picker__cell theme-picker__cell--wide">
                <button type="button" className="theme-add" onClick={() => void add()}>
                  <span aria-hidden="true" className="theme-add__plus">
                    +
                  </span>
                  ADD THEME
                </button>
                {addError && (
                  <p role="alert" className="theme-picker__error">
                    {addError}
                  </p>
                )}
              </div>

              <div className="theme-picker__format">
                <span className="theme-picker__format-title">FORMAT</span>
                PNG or JPG, 160x100 to 6000x6000, up to 5 MB, any shape. Small pixel art keeps crisp
                pixels; bigger pictures scale smoothly. Anchored to the bottom edge.
              </div>
            </fieldset>
          </div>

          <div className="theme-picker__side">
            <h3 className="theme-picker__label">PREVIEW</h3>
            <div className="theme-picker__preview">
              <ThemeBackdrop image={selected.image} fade={draft.fade} />
              <div className="theme-picker__sample-box">
                <div className="theme-picker__sample theme-picker__sample--mine">{SAMPLE_MINE}</div>
                <div className="theme-picker__sample">{SAMPLE_REPLY}</div>
              </div>
            </div>

            <div className="theme-picker__row">
              <label htmlFor={fadeId} className="theme-picker__label">
                FADE STRENGTH
              </label>
              <output htmlFor={fadeId} className="theme-picker__value">
                {draft.fade}%
              </output>
            </div>
            <input
              id={fadeId}
              type="range"
              className="theme-picker__slider"
              min={0}
              max={MAX_FADE}
              step={FADE_STEP}
              value={draft.fade}
              aria-valuetext={`${draft.fade}%`}
              onChange={(event) =>
                setDraft((current) => ({ ...current, fade: Number(event.target.value) }))
              }
            />

            <fieldset className="theme-picker__scope">
              <legend className="theme-picker__label">APPLY TO</legend>
              <div className="theme-picker__scope-row">
                {(
                  [
                    ['chat', 'THIS CHAT'],
                    ['all', 'ALL CHATS']
                  ] as const
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className={`theme-scope${scope === value ? ' theme-scope--selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name={scopeGroup}
                      checked={scope === value}
                      onChange={() => setScope(value)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            {applyError && (
              <p role="alert" className="theme-picker__error">
                {applyError}
              </p>
            )}
          </div>
        </div>
      </Dialog>

      {renaming && (
        <RenameDialog
          entry={renaming}
          onSave={async (name) => {
            const error = await onRename(renaming.id, name)
            if (!error) setRenaming(null)
            return error
          }}
          onCancel={() => setRenaming(null)}
        />
      )}

      {deleting && (
        <Dialog
          title="DELETE THEME?"
          tone="danger"
          onClose={() => setDeleting(null)}
          actions={
            <>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => setDeleting(null)}
              >
                CANCEL
              </button>
              <button
                type="button"
                className="button button--danger"
                onClick={() => void confirmDelete(deleting)}
              >
                DELETE
              </button>
            </>
          }
        >
          <p>{deleteThemeText(deleting.name)}</p>
        </Dialog>
      )}
    </>
  )
}

// A small dialog for a new name: 1 to 24 characters, trimmed, not blank.
function RenameDialog({
  entry,
  onSave,
  onCancel
}: {
  entry: ThemeEntry
  onSave: (name: string) => Promise<string | null>
  onCancel: () => void
}): React.JSX.Element {
  const [name, setName] = useState(entry.name)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const formId = useId()
  const inputId = useId()

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    const problem = themeNameError(name)
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    const failed = await onSave(name)
    setBusy(false)
    if (failed) setError(failed)
  }

  return (
    <Dialog
      title="RENAME THEME"
      onClose={onCancel}
      actions={
        <>
          <button type="button" className="button button--secondary" onClick={onCancel}>
            CANCEL
          </button>
          <button type="submit" form={formId} className="button button--primary" disabled={busy}>
            SAVE
          </button>
        </>
      }
    >
      <form id={formId} className="theme-rename" onSubmit={(event) => void submit(event)}>
        <label htmlFor={inputId} className="theme-picker__label">
          NAME
        </label>
        <input
          id={inputId}
          className="theme-rename__input"
          type="text"
          value={name}
          maxLength={MAX_THEME_NAME_LENGTH}
          aria-invalid={error !== null}
          aria-describedby={error ? `${inputId}-error` : undefined}
          onChange={(event) => {
            setName(event.target.value)
            setError(null)
          }}
        />
        {error && (
          <p id={`${inputId}-error`} role="alert" className="theme-picker__error">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  )
}

export default ThemePicker
