import type { MascotLoops } from '../../../shared/ipc'
import { MASCOT_STATES } from '../../../shared/mascotRules'
import { useStateCycle } from '../mascots/useStateCycle'
import Mascot from './Mascot'
import './MascotCard.css'

type MascotCardProps = {
  name: string
  loops: Partial<MascotLoops>
  // Shown in the error color, for a broken folder.
  problem: string | null
  builtIn: boolean
  active: boolean
  // Turns the buttons off while a change is being saved.
  busy: boolean
  // Each button is always there; one with no action given is disabled. So is
  // SET ACTIVE on the active card. DELETE takes the last slot when given, else RESET.
  onSetActive?: () => void
  onEdit?: () => void
  onReset?: () => void
  onDelete?: () => void
}

// One mascot in the gallery from designs/4-mascot-manager.html: its idle loop
// playing, the name, how many loops it has, and what can be done with it.
// CYCLE plays every state's loop in turn, CYCLE_STEP_MS each.
function MascotCard({
  name,
  loops,
  problem,
  builtIn,
  active,
  busy,
  onSetActive,
  onEdit,
  onReset,
  onDelete
}: MascotCardProps): React.JSX.Element {
  const count = MASCOT_STATES.filter((state) => loops[state]).length
  const idle = loops.idle
  const cycle = useStateCycle()
  const shownState = cycle.state ?? 'idle'
  // A state with no sheet plays the idle loop.
  const shown = loops[shownState] ?? idle
  const classes = ['mascot-card']
  if (active) classes.push('mascot-card--active')
  if (problem) classes.push('mascot-card--problem')

  return (
    <article className={classes.join(' ')} aria-label={name}>
      <div className="mascot-card__stage">
        {shown ? (
          <Mascot
            src={shown.src}
            frames={shown.frames}
            fps={shown.fps}
            reverse={shown.reverse}
            scale={2}
            label={`${name}, ${shownState} loop`}
          />
        ) : (
          <span className="mascot-card__broken" aria-hidden="true">
            !
          </span>
        )}
      </div>
      <div className="mascot-card__name">{name}</div>
      {idle && <div className="mascot-card__count">{count} of 5 loops</div>}
      {idle && (
        <div className="mascot-card__cycle" aria-live="polite">
          {cycle.state && (
            <>
              <span className="mascot-card__cycle-state">
                {cycle.state.toUpperCase()} {cycle.step}/{MASCOT_STATES.length}
              </span>
              {!loops[cycle.state] && (
                <span className="mascot-card__cycle-note">No sheet, plays idle</span>
              )}
            </>
          )}
        </div>
      )}
      {problem && (
        <p className="mascot-card__problem">
          <span className="mascot-card__problem-mark" aria-hidden="true">
            X
          </span>
          <span>{problem}</span>
        </p>
      )}
      {(active || builtIn) && (
        <div className="mascot-card__tags">
          {builtIn && <span className="mascot-card__tag">BUILT IN</span>}
          {active && <span className="mascot-card__tag mascot-card__tag--active">ACTIVE</span>}
        </div>
      )}
      {/* Four fixed slots in two columns. One that does not apply is disabled, not left out. */}
      <div className="mascot-card__actions">
        <button
          type="button"
          className="button button--secondary button--small"
          disabled={busy || !onSetActive || active}
          aria-label={active ? `${name} is the active mascot` : `Set active: ${name}`}
          onClick={onSetActive}
        >
          SET ACTIVE
        </button>
        <button
          type="button"
          className="button button--secondary button--small"
          disabled={busy || !onEdit}
          aria-label={`Edit ${name}`}
          onClick={onEdit}
        >
          EDIT
        </button>
        <button
          type="button"
          className="button button--secondary button--small"
          disabled={!idle}
          aria-label={cycle.state ? `Stop cycling ${name}` : `Cycle ${name} through every state`}
          onClick={cycle.state ? cycle.stop : cycle.start}
        >
          {cycle.state ? 'STOP' : 'CYCLE'}
        </button>
        {/* DELETE for a custom mascot, RESET for the built-in one. */}
        {onDelete ? (
          <button
            type="button"
            className="button button--danger button--small"
            disabled={busy}
            aria-label={`Delete ${name}`}
            onClick={onDelete}
          >
            DELETE
          </button>
        ) : (
          <button
            type="button"
            className="button button--danger button--small"
            disabled={busy || !onReset}
            aria-label={`Reset ${name} to the built-in version`}
            onClick={onReset}
          >
            RESET
          </button>
        )}
      </div>
    </article>
  )
}

export default MascotCard
