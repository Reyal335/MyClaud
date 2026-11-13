// Who I am signed in as, and how much of my plan's limits I have used. Types and the
// rules both sides share, with no Electron in them: main turns what Claude Code reports
// into these, and the window turns these into bars and sentences.
//
// Usage is never asked for. It arrives in the `rate_limit_event` messages Claude Code
// already sends during a run, and nothing here estimates a number it was not given.

export const USAGE_URL = 'https://claude.ai/settings/usage'

export type LimitStatus = 'allowed' | 'allowed_warning' | 'rejected'

// The two windows shown: the session (5 hours) and the week (7 days). Per-model weekly
// limits and extra usage are left out.
export type UsageWindowId = 'five_hour' | 'seven_day'
export const USAGE_WINDOWS: readonly UsageWindowId[] = ['five_hour', 'seven_day']

export type UsageWindow = {
  status: LimitStatus
  // When the window resets, in epoch milliseconds, or null when not reported.
  resetsAt: number | null
  // A whole number from 0 to 100, or null when Claude Code did not report one.
  percent: number | null
  // When the event that carried this arrived, in epoch milliseconds.
  updatedAt: number
}

export type UsageData = Record<UsageWindowId, UsageWindow | null>

export const NO_USAGE: UsageData = { five_hour: null, seven_day: null }

export type AccountState =
  // Not read yet.
  | { kind: 'loading' }
  // Claude Code could not be asked.
  | { kind: 'unreadable' }
  | { kind: 'signed_out' }
  | { kind: 'signed_in'; email: string | null; plan: string; signedInWith: string }
  // An API key or another provider instead of a Claude plan: no session or weekly limits.
  | { kind: 'api_key'; signedInWith: string; plan: string; provider: boolean }

export type AccountData = { account: AccountState; usage: UsageData }

export const LOADING_DATA: AccountData = { account: { kind: 'loading' }, usage: NO_USAGE }

// Session and weekly limits only exist on a Claude plan.
export function showsUsage(account: AccountState): boolean {
  return account.kind !== 'signed_out' && account.kind !== 'api_key'
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ----- What Claude Code reports about the account -----

const PLAN_FALLBACK = 'Claude plan'
const LOGIN_METHOD = 'Claude Code login'
const MAX_PLAN_LENGTH = 24

// "Claude Pro" is shown as PRO, "Claude Max" as MAX. Nothing, or something that does not
// look like a plan (an API account reports "Claude API"), is "Claude plan".
export function planLabel(subscriptionType: unknown): string {
  if (typeof subscriptionType !== 'string') return PLAN_FALLBACK
  const name = subscriptionType
    .trim()
    .replace(/^claude\s+/i, '')
    .trim()
  if (name === '' || name.length > MAX_PLAN_LENGTH || /\b(api|console)\b/i.test(name)) {
    return PLAN_FALLBACK
  }
  return name.toUpperCase()
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

// Turns the answer of the SDK's accountInfo() into what the window shows. Read from real
// answers: signed in gives an email, a plan and apiProvider "firstParty"; with no login it
// gives only tokenSource "none" and the provider.
export function classifyAccount(raw: unknown): AccountState {
  if (!isObject(raw)) return { kind: 'unreadable' }

  const keySource = text(raw.apiKeySource)
  if (keySource !== null && keySource !== 'none') {
    return {
      kind: 'api_key',
      signedInWith: `API key (${keySource})`,
      plan: 'Claude Console',
      provider: false
    }
  }

  const provider = text(raw.apiProvider)
  if (provider !== null && provider !== 'firstParty') {
    return {
      kind: 'api_key',
      signedInWith: `Provider: ${provider}`,
      plan: 'Not a Claude plan',
      provider: true
    }
  }

  const email = text(raw.email)
  const tokenSource = text(raw.tokenSource)
  // A login with no email can still be a login: only "none" means there is none.
  if (email === null && (tokenSource === null || tokenSource === 'none')) {
    return { kind: 'signed_out' }
  }
  return {
    kind: 'signed_in',
    email,
    plan: planLabel(raw.subscriptionType),
    signedInWith: LOGIN_METHOD
  }
}

// ----- What Claude Code reports about the limits -----

function limitStatus(value: unknown): LimitStatus | null {
  return value === 'allowed' || value === 'allowed_warning' || value === 'rejected' ? value : null
}

// Claude Code reports reset times in epoch seconds. Anything that is already milliseconds
// is kept as it is.
function toMillis(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return value < 1e12 ? Math.round(value * 1000) : Math.round(value)
}

// Utilization is a fraction of the window: 0.52 is 52%. It can go past 1 when usage runs
// over a cap, so it stops at 100. Never a guess: no number, no percent.
function toPercent(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return Math.min(100, Math.round(value * 100))
}

// What one `rate_limit_event`'s info says about the session and weekly windows. The
// per-window block (`unifiedWindows`) is used when present, and the event's own fields
// when they name the window. A window the event says nothing about is left out.
export function windowsFromEvent(info: unknown, now: number): Partial<UsageData> {
  if (!isObject(info)) return {}
  const unified = isObject(info.unifiedWindows) ? info.unifiedWindows : {}
  const out: Partial<UsageData> = {}

  for (const id of USAGE_WINDOWS) {
    const own = info.rateLimitType === id
    const block = unified[id]
    if (isObject(block)) {
      out[id] = {
        status: limitStatus(block.status) ?? (own ? limitStatus(info.status) : null) ?? 'allowed',
        resetsAt: toMillis(block.resetsAt) ?? (own ? toMillis(info.resetsAt) : null),
        percent: toPercent(block.utilization),
        updatedAt: now
      }
    } else if (own) {
      const status = limitStatus(info.status)
      if (status === null) continue
      out[id] = {
        status,
        resetsAt: toMillis(info.resetsAt),
        percent: toPercent(info.utilization),
        updatedAt: now
      }
    }
  }
  return out
}

// A saved window, checked. Anything that is not a window reads as none.
export function parseUsageWindow(raw: unknown): UsageWindow | null {
  if (!isObject(raw)) return null
  const status = limitStatus(raw.status)
  if (status === null) return null
  const { resetsAt, percent, updatedAt } = raw
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return null
  const goodMillis = typeof resetsAt === 'number' && Number.isFinite(resetsAt) && resetsAt > 0
  const goodPercent =
    typeof percent === 'number' && Number.isInteger(percent) && percent >= 0 && percent <= 100
  return {
    status,
    resetsAt: goodMillis ? Math.round(resetsAt) : null,
    percent: goodPercent ? percent : null,
    updatedAt
  }
}

// ----- Rows: one window, ready to draw -----

// none:     nothing reported yet, or the window has reset since.
// percent:  an exact percent.
// rejected: the limit is reached, even if the percent is missing.
// near:     no percent, but Claude Code says 80% or more is used.
// under:    no percent, and nothing says the limit is near.
export type RowKind = 'none' | 'percent' | 'rejected' | 'near' | 'under'

export type UsageRow = {
  id: UsageWindowId
  kind: RowKind
  percent: number | null
  resetsAt: number | null
  updatedAt: number | null
  // The window had a value and its reset time has passed.
  wasReset: boolean
}

export function usageRow(id: UsageWindowId, window: UsageWindow | null, now: number): UsageRow {
  const none = (wasReset: boolean): UsageRow => ({
    id,
    kind: 'none',
    percent: null,
    resetsAt: window?.resetsAt ?? null,
    updatedAt: window?.updatedAt ?? null,
    wasReset
  })
  if (window === null) return none(false)
  if (window.resetsAt !== null && window.resetsAt <= now) return none(true)

  const kind: RowKind =
    window.status === 'rejected'
      ? 'rejected'
      : window.percent !== null
        ? 'percent'
        : window.status === 'allowed_warning'
          ? 'near'
          : 'under'
  return {
    id,
    kind,
    percent: kind === 'percent' ? window.percent : null,
    resetsAt: window.resetsAt,
    updatedAt: window.updatedAt,
    wasReset: false
  }
}

export function usageRows(usage: UsageData, now: number): UsageRow[] {
  return USAGE_WINDOWS.map((id) => usageRow(id, usage[id], now))
}

export const WINDOW_NAMES: Record<
  UsageWindowId,
  { screen: string; spoken: string; short: string; word: string }
> = {
  five_hour: { screen: 'SESSION (5 HR)', spoken: 'Session (5 hr)', short: '5H', word: 'Session' },
  seven_day: { screen: 'WEEKLY (7 DAY)', spoken: 'Weekly (7 day)', short: '7D', word: 'Weekly' }
}

export type Tone = 'accent' | 'waiting' | 'error'

// Under 80 is --accent, 80 to 99 is --waiting, 100 is --error.
function toneForPercent(percent: number): Tone {
  return percent >= 100 ? 'error' : percent >= 80 ? 'waiting' : 'accent'
}

export type BarView = {
  // How many segments are filled, and in what color.
  filled: number
  tone: Tone | null
  // Empty segments are dashed when there is no percent to show.
  dashed: boolean
}

// `segments` is 20 on the ACCOUNT screen (5% each) and 10 in the sidebar meter (10% each).
export function barView(row: UsageRow, segments: number): BarView {
  switch (row.kind) {
    case 'rejected':
      return { filled: segments, tone: 'error', dashed: false }
    case 'percent': {
      const percent = row.percent ?? 0
      return {
        filled: Math.round(percent / (100 / segments)),
        tone: toneForPercent(percent),
        dashed: false
      }
    }
    case 'near':
      // 16 of 20: the 80% line.
      return { filled: Math.round(segments * 0.8), tone: 'waiting', dashed: false }
    default:
      return { filled: 0, tone: null, dashed: true }
  }
}

// The value beside a bar. The sidebar has less room, so it says less.
export function valueText(row: UsageRow, compact: boolean): string {
  switch (row.kind) {
    case 'rejected':
      return '100%'
    case 'percent':
      return `${row.percent}%`
    case 'near':
      return compact ? '80%+' : 'NEAR LIMIT'
    case 'under':
      return compact ? '--' : 'UNDER 80%'
    default:
      return '--'
  }
}

export type ValueTone = 'text' | 'muted' | 'waiting' | 'error'

export function valueTone(row: UsageRow): ValueTone {
  switch (row.kind) {
    case 'rejected':
      return 'error'
    case 'near':
      return 'waiting'
    case 'percent': {
      const tone = toneForPercent(row.percent ?? 0)
      return tone === 'accent' ? 'text' : tone
    }
    default:
      return 'muted'
  }
}

// For screen readers: the bars are hidden from them, so this says what they show.
export function spokenUsage(row: UsageRow): string {
  switch (row.kind) {
    case 'rejected':
      return 'limit reached'
    case 'percent':
      return `${row.percent} percent used`
    case 'near':
      return 'near its limit, 80 percent or more used'
    case 'under':
      return 'under 80 percent used'
    default:
      return 'no percent reported yet'
  }
}

// ----- Times -----

// Newer ICU puts a narrow no-break space before AM and PM. A plain space reads the same
// and keeps the text easy to compare.
const ODD_SPACES = new RegExp(`[${String.fromCharCode(0x202f)}${String.fromCharCode(0xa0)}]`, 'g')

function plain(value: string): string {
  return value.replace(ODD_SPACES, ' ')
}

function clock(at: Date): string {
  return plain(at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

// "7:30 PM" when it is today, else "Mon, Nov 16, 8:00 AM". Local time.
export function resetTime(resetsAt: number, now: number): string {
  const at = new Date(resetsAt)
  if (sameDay(at, new Date(now))) return clock(at)
  const day = plain(
    at.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  )
  return `${day}, ${clock(at)}`
}

// "2 h 18 min", "42 min", "3 h". Rounded up, so it never says 0.
function untilText(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

// "Resets at 7:30 PM, in 2 h 18 min" today, else "Resets Mon, Nov 16, 8:00 AM".
export function resetLine(resetsAt: number, now: number): string {
  if (sameDay(new Date(resetsAt), new Date(now))) {
    return `Resets at ${resetTime(resetsAt, now)}, in ${untilText(resetsAt - now)}`
  }
  return `Resets ${resetTime(resetsAt, now)}`
}

// The line under a bar on the ACCOUNT screen.
export function rowResetLine(row: UsageRow, now: number): string {
  if (row.wasReset) return 'Reset. A new number comes with your next reply.'
  if (row.updatedAt === null) return 'Updates after a reply.'
  if (row.resetsAt === null) return 'Reset time not reported.'
  return resetLine(row.resetsAt, now)
}

function agoText(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? '1 day ago' : `${days} days ago`
}

// ----- Sentences -----

export type LimitAlert = {
  id: UsageWindowId
  // "Session limit reached. Agents can't start new replies until " then the bold time,
  // then ".". With no reset time reported: "... until it resets." and no time.
  before: string
  time: string | null
  after: string
}

// One alert for each window at its limit, session first.
export function limitAlerts(rows: UsageRow[], now: number): LimitAlert[] {
  return rows
    .filter((row) => row.kind === 'rejected')
    .map((row) => {
      const lead = `${WINDOW_NAMES[row.id].word} limit reached. Agents can't start new replies until `
      return row.resetsAt === null
        ? { id: row.id, before: `${lead}it resets.`, time: null, after: '' }
        : { id: row.id, before: lead, time: resetTime(row.resetsAt, now), after: '.' }
    })
}

// The footer of the USAGE panel.
export function usagePanelNote(rows: UsageRow[], now: number): string {
  const updated = rows.map((row) => row.updatedAt).filter((at): at is number => at !== null)
  if (updated.length === 0) return 'No usage reported yet. Updates after a reply.'
  const last = `Last update ${agoText(Math.max(0, now - Math.max(...updated)))}.`
  if (rows.some((row) => row.kind === 'under')) {
    return `Claude Code reports exact percentages only near a limit. The reset times are exact. ${last}`
  }
  return `Updated after each reply. ${last}`
}

// ----- The sidebar meter -----

// The lines under the meter's bars.
export function meterNotes(rows: UsageRow[], now: number): string[] {
  const notes = rows
    .filter((row) => row.kind === 'rejected' && row.resetsAt !== null)
    .map((row) => `${WINDOW_NAMES[row.id].word} resets ${resetTime(row.resetsAt as number, now)}`)
  if (notes.length > 0) return notes
  const known = rows.some((row) => row.kind === 'percent' || row.kind === 'near')
  return known ? [] : ['Updates after a reply']
}

// The meter's aria-label, since its bars are hidden from screen readers.
export function meterLabel(data: AccountData, now: number): string {
  const { account } = data
  if (account.kind === 'signed_out') return 'Account. Not signed in.'
  if (account.kind === 'api_key') return 'Account. API key.'
  const [session, weekly] = usageRows(data.usage, now)
  const sentence = (row: UsageRow, word: string): string => `${word} ${spokenUsage(row)}`
  return `Account. ${sentence(session, 'Session')}, ${sentence(weekly, 'weekly')}.`
}
