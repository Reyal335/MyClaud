import { useState } from 'react'
import type { MyaPopupApi, PopupAction, PopupView, PopupWho } from '../../../shared/ipc'
import type { MascotStateName } from '../../../shared/mascotRules'
import AgentIcon from '../components/AgentIcon'
import Mascot from '../components/Mascot'
import { PermissionDetails } from '../components/PermissionRow'
import { AGENT_NAME } from '../conversation/agentName'
import { loopFor, type Mascot as MascotData } from '../mascots/types'
import './PopupCard.css'

type PopupCardProps = {
  view: PopupView
  mascot: MascotData
  api: MyaPopupApi
}

const MASCOT_STATES: Record<PopupView['kind'], MascotStateName> = {
  approval: 'asking',
  finished: 'talking',
  error: 'idle'
}

const MASCOT_LABELS: Record<PopupView['kind'], string> = {
  approval: 'asking permission',
  finished: 'talking',
  error: 'idle'
}

function nameOf(who: PopupWho): string {
  return who.kind === 'agent' ? who.name : AGENT_NAME
}

// The icon and name at the top of the bubble. The main conversation has no icon.
function Header({
  who,
  position
}: {
  who: PopupWho
  position?: { index: number; total: number }
}): React.JSX.Element {
  return (
    <span className="popup-card__header">
      {who.kind === 'agent' && <AgentIcon src={who.icon} size={16} label="" />}
      <span className="popup-card__name">{nameOf(who)}</span>
      {position && position.total > 1 && (
        <span className="popup-card__position">
          {position.index + 1} of {position.total}
        </span>
      )}
    </span>
  )
}

// One popup from designs/5-popup-notifications.html: the mascot on the left and
// the bubble on the right, with buttons below for an approval.
function PopupCard({ view, mascot, api }: PopupCardProps): React.JSX.Element {
  // APPROVE and DENY are disabled after one click until the popup changes. The
  // card is keyed by the popup's id, so this starts false for each popup.
  const [answered, setAnswered] = useState(false)
  const loop = loopFor(mascot, MASCOT_STATES[view.kind])

  const act = (action: PopupAction): void => {
    if (action === 'approve' || action === 'deny') setAnswered(true)
    api.act(view.id, action).catch((err: unknown) => console.error('The popup could not act:', err))
  }
  const hover = {
    onMouseEnter: () => api.hover(true),
    onMouseLeave: () => api.hover(false)
  }

  const mascotFrame = (
    <span className="popup-card__mascot">
      <Mascot
        src={loop.src}
        frames={loop.frames}
        fps={loop.fps}
        reverse={loop.reverse}
        scale={2}
        label={`${mascot.name}, ${MASCOT_LABELS[view.kind]}`}
      />
    </span>
  )

  if (view.kind !== 'approval') {
    const error = view.kind === 'error'
    return (
      <div
        className={`popup-card popup-card--${view.kind}`}
        role={error ? 'alert' : 'status'}
        {...hover}
      >
        {/* Clicking anywhere but the close button opens the app. */}
        <button type="button" className="popup-card__main" onClick={() => act('open')}>
          {mascotFrame}
          <span className="popup-card__bubble">
            <Header who={view.who} />
            <span className="popup-card__text">{view.text}</span>
            <span className={`popup-card__status popup-card__status--${view.kind}`}>
              <span className="popup-card__square" aria-hidden="true" />
              {error ? 'ERROR' : 'DONE'}
            </span>
          </span>
        </button>
        <button
          type="button"
          className="popup-card__close"
          aria-label="Close"
          onClick={() => act('dismiss')}
        >
          X
        </button>
      </div>
    )
  }

  const { request } = view
  // The whole request is on screen: short enough for the compact popup, or DETAILS is open.
  const shownInFull = view.fits || view.detailsOpen
  return (
    <div
      className="popup-card popup-card--approval"
      role="alertdialog"
      aria-label={`${nameOf(view.who)} needs approval`}
      {...hover}
    >
      <div className="popup-card__top">
        {mascotFrame}
        <div className="popup-card__bubble">
          <Header who={view.who} position={view.position} />
          <span className="popup-card__text">{view.label}</span>
        </div>
      </div>
      {shownInFull && (
        <div className="popup-card__details">
          <PermissionDetails
            name={request.name}
            request={request}
            projectPath={request.projectPath}
          />
        </div>
      )}
      {/* No shortcut and no automatic focus on APPROVE. */}
      <div className="popup-card__actions" role="group" aria-label="Permission request">
        {shownInFull ? (
          <button
            type="button"
            className="button button--primary"
            disabled={answered}
            onClick={() => act('approve')}
          >
            APPROVE
          </button>
        ) : (
          <button
            type="button"
            className="button popup-card__details-button"
            onClick={() => act('details')}
          >
            DETAILS
          </button>
        )}
        <button
          type="button"
          className="button button--secondary"
          disabled={answered}
          onClick={() => act('deny')}
        >
          DENY
        </button>
        <button type="button" className="button popup-card__open" onClick={() => act('open')}>
          OPEN
        </button>
      </div>
    </div>
  )
}

export default PopupCard
