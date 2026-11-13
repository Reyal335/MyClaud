import { useCallback, useEffect, useRef, useState } from 'react'
import type { MascotSummary } from '../../../shared/ipc'
import { DEFAULT_MASCOT_ID } from '../../../shared/mascotRules'
import { useMascots } from '../hooks/useMascots'
import { usePopupsSetting } from '../hooks/usePopupsSetting'
import { DEFAULT_MASCOT, withDefaultEdits } from '../mascots/defaultMascot'
import MascotCard from '../components/MascotCard'
import MascotDialog, { type MascotDialogTarget } from '../components/MascotDialog'
import Dialog from '../components/Dialog'
import type { LeaveGuard } from './types'
import './MascotsScreen.css'

type MascotsScreenProps = {
  // Lets the app ask before leaving while the upload dialog has unsaved changes.
  setLeaveGuard: (guard: LeaveGuard | null) => void
}

type ConfirmState =
  | { kind: 'discard'; proceed: () => void }
  | { kind: 'delete'; id: string; name: string; active: boolean; busy: boolean }
  | { kind: 'reset'; name: string; busy: boolean }

// The MASCOTS screen from designs/4-mascot-manager.html: the gallery, with the
// built-in default first, and the upload dialog to add or edit a mascot.
function MascotsScreen({ setLeaveGuard }: MascotsScreenProps): React.JSX.Element {
  const { mascots, defaultMascot, activeId, loaded, error, reload } = useMascots()
  const popups = usePopupsSetting()
  // Broken edits are not shown: the bundled mascot is used until they are reset.
  const shownDefault = defaultMascot.problem
    ? DEFAULT_MASCOT
    : withDefaultEdits(defaultMascot.name, defaultMascot.loops)
  // The key opens a fresh dialog each time.
  const [editor, setEditor] = useState<{ key: number; target: MascotDialogTarget } | null>(null)
  const [dirty, setDirty] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const nonce = useRef(0)
  const titleRef = useRef<HTMLHeadingElement>(null)

  // Asks once before discarding unsaved changes in the dialog.
  const askBeforeLeaving = useCallback(
    (proceed: () => void): void => {
      if (dirty) setConfirm({ kind: 'discard', proceed })
      else proceed()
    },
    [dirty]
  )

  useEffect(() => {
    setLeaveGuard(dirty ? askBeforeLeaving : null)
    return () => setLeaveGuard(null)
  }, [dirty, askBeforeLeaving, setLeaveGuard])

  function openEditor(target: MascotDialogTarget): void {
    nonce.current += 1
    setActionError(null)
    setEditor({ key: nonce.current, target })
  }

  function closeEditor(): void {
    setEditor(null)
    setDirty(false)
  }

  async function setActive(id: string): Promise<void> {
    setBusy(true)
    setActionError(null)
    try {
      const result = await window.mya.mascots.setActive(id)
      if (!result.ok) setActionError(result.error.message)
    } catch (err) {
      console.error('Could not set the active mascot:', err)
      setActionError('The active mascot could not be changed.')
    }
    setBusy(false)
    void reload()
  }

  async function confirmDelete(id: string): Promise<void> {
    setConfirm((current) => (current?.kind === 'delete' ? { ...current, busy: true } : current))
    try {
      const result = await window.mya.mascots.remove(id)
      setActionError(result.ok ? null : result.error.message)
    } catch (err) {
      console.error('Could not delete the mascot:', err)
      setActionError('The mascot could not be deleted.')
    }
    setConfirm(null)
    await reload()
    // The card that held the DELETE button is gone, so focus the heading.
    titleRef.current?.focus()
  }

  async function confirmReset(): Promise<void> {
    setConfirm((current) => (current?.kind === 'reset' ? { ...current, busy: true } : current))
    try {
      const result = await window.mya.mascots.resetDefault()
      setActionError(result.ok ? null : result.error.message)
    } catch (err) {
      console.error('Could not reset the default mascot:', err)
      setActionError('The default mascot could not be reset.')
    }
    setConfirm(null)
    await reload()
    // The RESET button is gone now, so focus the heading.
    titleRef.current?.focus()
  }

  function editTarget(mascot: MascotSummary): MascotDialogTarget | null {
    return mascot.problem === null ? { kind: 'edit', mascot } : null
  }

  return (
    <section className="mascots" aria-labelledby="mascots-title">
      <div className="mascots__head">
        <h1 id="mascots-title" ref={titleRef} tabIndex={-1} className="mascots__title">
          MASCOTS
        </h1>
        <div className="mascots__popups">
          <button
            type="button"
            className="button button--small"
            aria-pressed={popups.on}
            disabled={!popups.loaded}
            onClick={() => popups.toggle()}
          >
            POPUPS {popups.on ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            className="button button--small button--secondary"
            onClick={() => popups.test()}
          >
            TEST POPUP
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="mascots__error">
          {error}
        </p>
      )}
      {actionError && (
        <p role="alert" className="mascots__error">
          {actionError}
        </p>
      )}

      <div className="mascots__gallery">
        <MascotCard
          name={shownDefault.name}
          loops={shownDefault.loops}
          problem={
            defaultMascot.problem
              ? `Your changes could not be loaded, so the built-in version is used. ${defaultMascot.problem}`
              : null
          }
          builtIn
          active={activeId === DEFAULT_MASCOT_ID}
          busy={busy || !loaded}
          onSetActive={() => void setActive(DEFAULT_MASCOT_ID)}
          onEdit={
            defaultMascot.problem
              ? undefined
              : () =>
                  openEditor({
                    kind: 'default',
                    name: shownDefault.name,
                    uploaded: defaultMascot.loops,
                    voice: defaultMascot.voice
                  })
          }
          onReset={
            defaultMascot.edited
              ? () => setConfirm({ kind: 'reset', name: shownDefault.name, busy: false })
              : undefined
          }
        />
        {mascots.map((mascot) => (
          <MascotCard
            key={mascot.id}
            name={mascot.name}
            loops={mascot.loops}
            problem={mascot.problem}
            builtIn={false}
            active={mascot.id === activeId}
            busy={busy}
            onSetActive={mascot.problem ? undefined : () => void setActive(mascot.id)}
            onEdit={
              mascot.problem
                ? undefined
                : () => {
                    const target = editTarget(mascot)
                    if (target) openEditor(target)
                  }
            }
            onDelete={() =>
              setConfirm({
                kind: 'delete',
                id: mascot.id,
                name: mascot.name,
                active: mascot.id === activeId,
                busy: false
              })
            }
          />
        ))}
        <button type="button" className="mascots__add" onClick={() => openEditor({ kind: 'new' })}>
          <span className="mascots__add-plus" aria-hidden="true">
            +
          </span>
          ADD MASCOT
        </button>
      </div>

      {editor && (
        <MascotDialog
          key={editor.key}
          target={editor.target}
          onDirtyChange={setDirty}
          onSaved={() => {
            closeEditor()
            void reload()
          }}
          onCancel={() => askBeforeLeaving(closeEditor)}
        />
      )}

      {confirm?.kind === 'discard' && (
        <Dialog
          title="DISCARD CHANGES?"
          onClose={() => setConfirm(null)}
          actions={
            <>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => setConfirm(null)}
              >
                KEEP EDITING
              </button>
              <button
                type="button"
                className="button button--danger"
                onClick={() => {
                  const { proceed } = confirm
                  setConfirm(null)
                  setDirty(false)
                  proceed()
                }}
              >
                DISCARD
              </button>
            </>
          }
        >
          <p>This mascot has unsaved changes. They will be lost, with any sheets not yet saved.</p>
        </Dialog>
      )}

      {confirm?.kind === 'delete' && (
        <Dialog
          title="DELETE MASCOT?"
          tone="danger"
          onClose={() => {
            if (!confirm.busy) setConfirm(null)
          }}
          actions={
            <>
              <button
                type="button"
                className="button button--secondary"
                disabled={confirm.busy}
                onClick={() => setConfirm(null)}
              >
                CANCEL
              </button>
              <button
                type="button"
                className="button button--danger"
                disabled={confirm.busy}
                onClick={() => void confirmDelete(confirm.id)}
              >
                DELETE
              </button>
            </>
          }
        >
          <p>
            Delete <strong>{confirm.name}</strong>? Its folder goes to the trash, with all its
            sheets.
          </p>
          {confirm.active && <p>It is the active mascot, so the default mascot takes over.</p>}
        </Dialog>
      )}

      {confirm?.kind === 'reset' && (
        <Dialog
          title="RESET DEFAULT MASCOT?"
          tone="danger"
          onClose={() => {
            if (!confirm.busy) setConfirm(null)
          }}
          actions={
            <>
              <button
                type="button"
                className="button button--secondary"
                disabled={confirm.busy}
                onClick={() => setConfirm(null)}
              >
                CANCEL
              </button>
              <button
                type="button"
                className="button button--danger"
                disabled={confirm.busy}
                onClick={() => void confirmReset()}
              >
                RESET
              </button>
            </>
          }
        >
          <p>
            Reset <strong>{confirm.name}</strong> to the built-in version? Your name and loops for
            it go to the trash.
          </p>
        </Dialog>
      )}
    </section>
  )
}

export default MascotsScreen
