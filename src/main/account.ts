import { app, BrowserWindow, shell } from 'electron'
import type { Query } from '@anthropic-ai/claude-agent-sdk'
import { IpcChannel } from '../shared/ipc'
import { USAGE_URL, classifyAccount, type AccountData, type AccountState } from '../shared/account'
import { FIXTURE_NAMES, fixtureData } from './accountFixtures'
import { withIdleQuery } from './idleQuery'
import { getUsage, noteSignedInAs, recordRateLimit } from './usage'

// Who I am signed in as, and the usage numbers. The account comes from the SDK's
// accountInfo(), which Claude Code answers from its start-up information: nothing is sent
// to a model and nothing is used from the plan. It is asked at startup, when a run
// starts, and when CHECK AGAIN is pressed. The email goes to the window that asks and is
// never logged.

const READ_TIMEOUT_MS = 30_000

let account: AccountState = { kind: 'loading' }
// Made-up values from MYCLAUD_ACCOUNT_FIXTURE, in an app that is not packaged.
let fixture: AccountData | null = null

export function accountData(): AccountData {
  return fixture ?? { account, usage: getUsage() }
}

function broadcast(): void {
  const data = accountData()
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IpcChannel.AccountChanged, data)
  }
}

function setAccount(next: AccountState): void {
  const changed = JSON.stringify(next) !== JSON.stringify(account)
  account = next
  // Another account signing in drops the numbers that belonged to the last one.
  const usageDropped = next.kind === 'signed_in' && noteSignedInAs(next.email)
  if (changed || usageDropped) broadcast()
}

function chooseFixture(): void {
  if (app.isPackaged) return
  const name = process.env['MYCLAUD_ACCOUNT_FIXTURE']
  if (!name) return
  fixture = fixtureData(name, Date.now())
  if (fixture) console.log(`[account] Showing the "${name}" fixture. Real values are ignored.`)
  else console.error(`[account] Unknown fixture. Choose one of: ${FIXTURE_NAMES.join(', ')}`)
}

// Called once at startup, after the saved usage is loaded. Nothing waits for it.
export function startAccount(): void {
  chooseFixture()
  void checkAccount()
}

let reading: Promise<AccountData> | null = null

// Reads the account again, through a query with no message in it. One read at a time:
// a second ask joins the first.
export function checkAccount(): Promise<AccountData> {
  if (fixture) return Promise.resolve(fixture)
  reading ??= readAccount().finally(() => {
    reading = null
  })
  return reading
}

async function readAccount(): Promise<AccountData> {
  try {
    const raw = await withIdleQuery(
      app.getPath('home'),
      (query) => query.accountInfo(),
      READ_TIMEOUT_MS,
      'Claude Code took too long to answer.'
    )
    setAccount(classifyAccount(raw))
  } catch (err) {
    console.error('[account] Could not read the account:', err instanceof Error ? err.message : err)
    setAccount({ kind: 'unreadable' })
  }
  return accountData()
}

// A run's own query can answer too, with no second Claude Code process. A failure here
// is not shown: the account stays as it was.
export function readAccountFromRun(query: Query): void {
  if (fixture) return
  query.accountInfo().then(
    (raw) => setAccount(classifyAccount(raw)),
    (err: unknown) => {
      console.warn(
        '[account] A run could not read the account:',
        err instanceof Error ? err.message : err
      )
    }
  )
}

// A `rate_limit_event` from a run's stream.
export function noteRateLimit(info: unknown): void {
  if (fixture) return
  if (recordRateLimit(info)) broadcast()
}

export function openUsagePage(): Promise<{ ok: boolean }> {
  return shell.openExternal(USAGE_URL).then(
    () => ({ ok: true }),
    (err: unknown) => {
      console.error(
        '[account] Could not open the usage page:',
        err instanceof Error ? err.message : err
      )
      return { ok: false }
    }
  )
}
