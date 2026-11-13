import type { AccountData, AccountState, UsageData, UsageWindow } from '../shared/account'

// Made-up account and usage values, so every look of the ACCOUNT screen and the sidebar
// meter can be seen without using any of a real plan. Chosen with the
// MYA_ACCOUNT_FIXTURE environment variable, and only in an app that is not packaged
// (see account.ts). While one is chosen, real reads and real events are ignored and
// usage.json is not written.

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export const FIXTURE_NAMES = [
  'normal',
  'warning',
  'limit',
  'nopercent',
  'nearnopercent',
  'nothing',
  'reset',
  'signedout',
  'apikey',
  'unreadable'
] as const

const SIGNED_IN: AccountState = {
  kind: 'signed_in',
  email: 'you@example.com',
  plan: 'PRO',
  signedInWith: 'Claude Code login'
}

function window(
  now: number,
  status: UsageWindow['status'],
  percent: number | null,
  resetsIn: number
): UsageWindow {
  return { status, percent, resetsAt: now + resetsIn, updatedAt: now - 2 * MINUTE }
}

function usage(session: UsageWindow | null, weekly: UsageWindow | null): UsageData {
  return { five_hour: session, seven_day: weekly }
}

// `now` is when the app started: times are relative to it, so "Last update" counts up.
export function fixtureData(name: string, now: number): AccountData | null {
  const session = 2 * HOUR + 18 * MINUTE
  const weekly = 3 * DAY
  switch (name) {
    case 'normal':
      return {
        account: SIGNED_IN,
        usage: usage(window(now, 'allowed', 52, session), window(now, 'allowed', 61, weekly))
      }
    case 'warning':
      return {
        account: SIGNED_IN,
        usage: usage(
          window(now, 'allowed_warning', 86, session),
          window(now, 'allowed', 61, weekly)
        )
      }
    case 'limit':
      return {
        account: SIGNED_IN,
        usage: usage(window(now, 'rejected', 100, 42 * MINUTE), window(now, 'allowed', 64, weekly))
      }
    case 'nopercent':
      return {
        account: SIGNED_IN,
        usage: usage(window(now, 'allowed', null, session), window(now, 'allowed', null, weekly))
      }
    case 'nearnopercent':
      return {
        account: SIGNED_IN,
        usage: usage(
          window(now, 'allowed_warning', null, session),
          window(now, 'allowed', null, weekly)
        )
      }
    case 'nothing':
      return { account: SIGNED_IN, usage: usage(null, null) }
    case 'reset':
      // Both windows have a value, and their reset time has passed.
      return {
        account: SIGNED_IN,
        usage: usage(window(now, 'allowed', 52, -MINUTE), window(now, 'allowed', 61, -HOUR))
      }
    case 'signedout':
      return { account: { kind: 'signed_out' }, usage: usage(null, null) }
    case 'apikey':
      return {
        account: {
          kind: 'api_key',
          signedInWith: 'API key (ANTHROPIC_API_KEY)',
          plan: 'Claude Console',
          provider: false
        },
        usage: usage(null, null)
      }
    case 'unreadable':
      return { account: { kind: 'unreadable' }, usage: usage(null, null) }
    default:
      return null
  }
}
