import {
  WINDOW_NAMES,
  barView,
  meterLabel,
  meterNotes,
  usageRows,
  valueText,
  valueTone,
  type AccountData
} from '../../../shared/account'
import SegmentBar from './SegmentBar'
import './UsageMeter.css'

type UsageMeterProps = {
  data: AccountData
  now: number
  // ACCOUNT is the screen on show.
  active: boolean
  onOpen: () => void
}

// The meter at the bottom of the sidebar, on every screen. It is the way into ACCOUNT:
// the 5-hour and 7-day bars, or "Not signed in" or "API key" where there are no limits.
function UsageMeter({ data, now, active, onOpen }: UsageMeterProps): React.JSX.Element {
  const { account } = data
  let body: React.JSX.Element
  if (account.kind === 'signed_out') {
    body = <span className="usage-meter__text">Not signed in</span>
  } else if (account.kind === 'api_key') {
    body = <span className="usage-meter__text">API key</span>
  } else {
    const rows = usageRows(data.usage, now)
    body = (
      <>
        {rows.map((row) => (
          <span key={row.id} className="usage-meter__row">
            <span className="usage-meter__name">{WINDOW_NAMES[row.id].short}</span>
            <span className="usage-meter__bar">
              <SegmentBar view={barView(row, 10)} segments={10} size="meter" />
            </span>
            <span className={`usage-meter__value usage-meter__value--${valueTone(row)}`}>
              {valueText(row, true)}
            </span>
          </span>
        ))}
        {meterNotes(rows, now).map((note) => (
          <span key={note} className="usage-meter__note">
            {note}
          </span>
        ))}
      </>
    )
  }

  return (
    <button
      type="button"
      className={active ? 'usage-meter usage-meter--active' : 'usage-meter'}
      aria-current={active ? 'page' : undefined}
      aria-label={meterLabel(data, now)}
      onClick={onOpen}
    >
      <span className="usage-meter__title">ACCOUNT</span>
      {body}
    </button>
  )
}

export default UsageMeter
