import { readFile } from 'fs/promises'
import { renameWithRetry, writeFileSafely } from './safeWrite'

// Small JSON files in userData (chats.json, tasks.json). A missing file is empty.
// A file that cannot be parsed is kept aside as <name>.bad, never deleted, and
// the app carries on as if it were empty.

const BOM = String.fromCharCode(0xfeff)

function errorCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code
}

export async function readJsonFile(path: string): Promise<unknown> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return undefined
    throw err
  }
  try {
    return JSON.parse(text.startsWith(BOM) ? text.slice(1) : text) as unknown
  } catch {
    await setAside(path)
    return undefined
  }
}

// Moves a broken file aside as <name>.bad, replacing an older .bad file.
export async function setAside(path: string): Promise<void> {
  try {
    await renameWithRetry(path, `${path}.bad`)
    console.error(`[store] ${path} could not be read and was kept as ${path}.bad`)
  } catch (err) {
    console.error(`[store] Could not keep ${path} aside:`, err)
  }
}

export function writeJsonFile(path: string, value: unknown): Promise<void> {
  return writeFileSafely(path, `${JSON.stringify(value, null, 2)}\n`)
}

// One write at a time per file, in order.
export function serialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let queue: Promise<unknown> = Promise.resolve()
  return <T>(task: () => Promise<T>): Promise<T> => {
    const result = queue.then(task, task)
    queue = result.catch(() => {})
    return result
  }
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
