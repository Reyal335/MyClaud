import { app } from 'electron'
import { createHash } from 'crypto'
import { join } from 'path'
import {
  NO_USAGE,
  USAGE_WINDOWS,
  parseUsageWindow,
  windowsFromEvent,
  type UsageData
} from '../shared/account'
import { isObject, readJsonFile, serialQueue, writeJsonFile } from './jsonFile'

// The latest session (5 hour) and weekly (7 day) numbers, kept in userData/usage.json so
// they are back after a restart. They come only from the rate_limit_event messages a run
// already streams: nothing is ever requested to refresh them.
//
// The file also holds a short fingerprint of the signed-in email, never the email, so
// numbers that belong to one account are dropped when another one signs in.

const FILE_VERSION = 1
const FINGERPRINT_LENGTH = 16

type StoredUsage = UsageData & { version: number; account: string | null }

let usage: UsageData = NO_USAGE
let fingerprint: string | null = null
const enqueue = serialQueue()

function usagePath(): string {
  return join(app.getPath('userData'), 'usage.json')
}

export function getUsage(): UsageData {
  return usage
}

// Called once at startup. A missing or damaged file is no usage yet.
export async function loadUsage(): Promise<void> {
  try {
    const raw = await readJsonFile(usagePath())
    if (!isObject(raw)) return
    usage = {
      five_hour: parseUsageWindow(raw.five_hour),
      seven_day: parseUsageWindow(raw.seven_day)
    }
    fingerprint = typeof raw.account === 'string' && raw.account !== '' ? raw.account : null
  } catch (err) {
    console.error('[usage] Could not read usage.json:', err instanceof Error ? err.message : err)
  }
}

function save(): void {
  const stored: StoredUsage = { version: FILE_VERSION, account: fingerprint, ...usage }
  void enqueue(() => writeJsonFile(usagePath(), stored)).catch((err: unknown) => {
    console.error('[usage] Could not save usage.json:', err instanceof Error ? err.message : err)
  })
}

// Takes the windows one event carries. Returns whether anything changed.
export function recordRateLimit(info: unknown, now: number = Date.now()): boolean {
  const windows = windowsFromEvent(info, now)
  const next: UsageData = { ...usage }
  let changed = false
  for (const id of USAGE_WINDOWS) {
    const window = windows[id]
    if (window) {
      next[id] = window
      changed = true
    }
  }
  if (!changed) return false
  usage = next
  save()
  return true
}

// The signed-in email, seen. If it is another account than the saved numbers belong to,
// they are dropped. Returns whether they were.
export function noteSignedInAs(email: string | null): boolean {
  if (email === null) return false
  const current = createHash('sha256').update(email.toLowerCase()).digest('hex')
  const next = current.slice(0, FINGERPRINT_LENGTH)
  if (next === fingerprint) return false
  const switched = fingerprint !== null
  fingerprint = next
  if (switched) usage = NO_USAGE
  save()
  return switched
}
