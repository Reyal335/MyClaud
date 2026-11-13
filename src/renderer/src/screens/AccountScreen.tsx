import { useRef, useState } from 'react'
import {
  WINDOW_NAMES,
  barView,
  limitAlerts,
  rowResetLine,
  showsUsage,
  spokenUsage,
  usagePanelNote,
  usageRows,
  valueText,
  valueTone,
  type AccountState,
  type UsageRow
} from '../../../shared/account'
import SegmentBar from '../components/SegmentBar'
import type { AccountStore } from '../hooks/useAccount'
import './AccountScreen.css'

const APP_NAME = 'Mya'

type AccountScreenProps = {
  store: AccountStore
}

function UsageRowView({ row, now }: { row: UsageRow; now: number }): React.JSX.Element {
  const names = WINDOW_NAMES[row.id]
  return (
    <div
      role="group"
      aria-label={`${names.spoken}: ${spokenUsage(row)}`}
      className="account__usage-row"
    >
      <div className="account__usage-head">
        <span className="account__usage-name">{names.screen}</span>
        <span className={`account__usage-value account__usage-value--${valueTone(row)}`}>
          {valueText(row, false)}
        </span>
      </div>
      <SegmentBar view={barView(row, 20)} segments={20} size="screen" />
      <span className="account__usage-reset">{rowResetLine(row, now)}</span>
    </div>
  )
}

function Fields({ account }: { account: AccountState }): React.JSX.Element | null {
  if (account.kind === 'signed_in') {
    return (
      <>
        <dl className="account__fields">
          <div className="account__field">
            <dt>EMAIL</dt>
            <dd className="account__email">{account.email ?? 'Not reported'}</dd>
          </div>
          <div className="account__field">
            <dt>PLAN</dt>
            <dd>
              <span className="account__plan">{account.plan}</span>
            </dd>
          </div>
          <div className="account__field">
            <dt>SIGNED IN WITH</dt>
            <dd>{account.signedInWith}</dd>
          </div>
        </dl>
        <p className="account__note">
          To switch accounts, open a terminal, run <code>claude</code>, and use <code>/login</code>.{' '}
          {APP_NAME} picks up the new account on its next run.
        </p>
      </>
    )
  }
  if (account.kind === 'api_key') {
    return (
      <>
        <dl className="account__fields account__fields--two">
          <div className="account__field">
            <dt>SIGNED IN WITH</dt>
            <dd>{account.signedInWith}</dd>
          </div>
          <div className="account__field">
            <dt>PLAN</dt>
            <dd>{account.plan}</dd>
          </div>
        </dl>
        <p className="account__note">
          {account.provider
            ? "Session and weekly limits don't apply, so the USAGE panel is hidden."
            : "Session and weekly limits don't apply. Usage is billed per token in the Claude Console, so the USAGE panel is hidden."}
        </p>
      </>
    )
  }
  return null
}

// The ACCOUNT screen from designs/13-account.html and 13b-account-states.html: who the
// agents run as, and how much of the session and weekly limits is used. Reached from the
// meter at the bottom of the sidebar.
function AccountScreen({ store }: AccountScreenProps): React.JSX.Element {
  const { data, now, checking, check } = store
  const { account } = data
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [checked, setChecked] = useState('')

  async function handleCheck(): Promise<void> {
    if (checking) return
    const next = await check()
    if (next === null || next.account.kind === 'unreadable') {
      setChecked("Couldn't read the account from Claude Code.")
    } else if (next.account.kind === 'signed_out') {
      setChecked('Still not signed in.')
    } else {
      setChecked('')
      // CHECK AGAIN is gone now, so focus moves to the heading.
      titleRef.current?.focus()
    }
  }

  const rows = usageRows(data.usage, now)
  const alerts = limitAlerts(rows, now)
  const canCheck = account.kind === 'signed_out' || account.kind === 'unreadable'

  return (
    <section className="account" aria-labelledby="account-title">
      <header className="account__head">
        <h1 id="account-title" ref={titleRef} tabIndex={-1} className="account__title">
          ACCOUNT
        </h1>
        <p className="account__subtitle">
          The Claude Code sign-in every agent in {APP_NAME} runs on.
        </p>
      </header>

      <div className="account__panels">
        <section className="account__panel" aria-label="Account">
          <div className="account__panel-head">
            <h2 className="account__panel-title">ACCOUNT</h2>
          </div>
          {account.kind === 'loading' && (
            <p className="account__text account__text--muted">Reading the account.</p>
          )}
          {account.kind === 'unreadable' && (
            <p className="account__text">Couldn&apos;t read the account from Claude Code.</p>
          )}
          {account.kind === 'signed_out' && (
            <>
              <p className="account__text">
                Not signed in to Claude Code, so agents can&apos;t run.
              </p>
              <ol className="account__steps">
                <li>Open a terminal.</li>
                <li>
                  Run <code>claude</code> and sign in with your Claude account.
                </li>
                <li>Come back and press CHECK AGAIN.</li>
              </ol>
            </>
          )}
          <Fields account={account} />
          {canCheck && (
            <div className="account__check-row">
              <button
                type="button"
                className="button button--primary account__check"
                aria-disabled={checking}
                onClick={() => void handleCheck()}
              >
                {checking ? 'CHECKING' : 'CHECK AGAIN'}
              </button>
              <p className="account__status" role="status">
                {checked}
              </p>
            </div>
          )}
        </section>

        {showsUsage(account) && (
          <section className="account__panel" aria-label="Usage">
            <div className="account__panel-head">
              <h2 className="account__panel-title">USAGE</h2>
              <button
                type="button"
                className="account__link"
                onClick={() =>
                  void window.mya.account.openUsagePage().catch((err: unknown) => {
                    console.error('Could not open the usage page:', err)
                  })
                }
              >
                VIEW DETAILS ON CLAUDE.AI &gt;
              </button>
            </div>
            {alerts.map((alert) => (
              <div key={alert.id} role="alert" className="account__alert">
                <span className="account__alert-mark" aria-hidden="true" />
                <span>
                  {alert.before}
                  {alert.time !== null && <strong>{alert.time}</strong>}
                  {alert.after}
                </span>
              </div>
            ))}
            {rows.map((row) => (
              <UsageRowView key={row.id} row={row} now={now} />
            ))}
            <p className="account__usage-note">{usagePanelNote(rows, now)}</p>
          </section>
        )}

        {showsUsage(account) && (
          <div className="account__legend">
            <span className="account__legend-item">
              <span className="account__swatch account__swatch--accent" />
              Under 80%
            </span>
            <span className="account__legend-item">
              <span className="account__swatch account__swatch--waiting" />
              80% and up
            </span>
            <span className="account__legend-item">
              <span className="account__swatch account__swatch--error" />
              Limit reached
            </span>
          </div>
        )}
      </div>
    </section>
  )
}

export default AccountScreen
