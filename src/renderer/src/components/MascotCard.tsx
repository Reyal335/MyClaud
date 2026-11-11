import type { MascotLoops } from '../../../shared/ipc'
import { MASCOT_STATES } from '../../../shared/mascotRules'
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
  // Each button shows only when its action is given. SET ACTIVE also hides on the active card.
  onSetActive?: () => void
  onEdit?: () => void
  onReset?: () => void
  onDelete?: () => void
}

// One mascot in the gallery from designs/4-mascot-manager.html: its idle loop
// playing, the name, how many loops it has, and what can be done with it.
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
  const classes = ['mascot-card']
  if (active) classes.push('mascot-card--active')
  if (problem) classes.push('mascot-card--problem')

  return (
    <article className={classes.join(' ')} aria-label={name}>
      <div className="mascot-card__stage">
        {idle ? (
          <Mascot
            src={idle.src}
            frames={idle.frames}
            fps={idle.fps}
            scale={2}
            label={`${name}, idle loop`}
          />
        ) : (
          <span className="mascot-card__broken" aria-hidden="true">
            !
          </span>
        )}
      </div>
      <div className="mascot-card__name">{name}</div>
      {idle && <div className="mascot-card__count">{count} of 5 loops</div>}
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
      <div className="mascot-card__actions">
        {onSetActive && !active && (
          <button
            type="button"
            className="button button--secondary button--small"
            disabled={busy}
            aria-label={`Set active: ${name}`}
            onClick={onSetActive}
          >
            SET ACTIVE
          </button>
        )}
        {onEdit && (
          <button
            type="button"
            className="button button--secondary button--small"
            disabled={busy}
            aria-label={`Edit ${name}`}
            onClick={onEdit}
          >
            EDIT
          </button>
        )}
        {onReset && (
          <button
            type="button"
            className="button button--danger button--small"
            disabled={busy}
            aria-label={`Reset ${name} to the built-in version`}
            onClick={onReset}
          >
            RESET
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            className="button button--danger button--small"
            disabled={busy}
            aria-label={`Delete ${name}`}
            onClick={onDelete}
          >
            DELETE
          </button>
        )}
      </div>
    </article>
  )
}

export default MascotCard
