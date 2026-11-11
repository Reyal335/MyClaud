import { app } from 'electron'
import { access, readFile } from 'fs/promises'
import { join, resolve } from 'path'
import { writeFileSafely } from './safeWrite'

// A JSON file in userData that maps agent file paths to a value the app keeps
// for that agent (an icon filename, a role). Agent files themselves are never
// given fields of our own.

export type PathMap = Record<string, string>

// The one form of a path used in the maps, so drive-letter case and slashes match.
export function normalizePath(path: string): string {
  const resolved = resolve(path).replace(/\\/g, '/')
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function mapFile(name: string): string {
  return join(app.getPath('userData'), name)
}

// A missing or corrupt map is an empty map, never a crash. Entries whose value
// fails `isValid` are dropped.
export async function readPathMap(
  name: string,
  isValid: (value: string) => boolean
): Promise<PathMap> {
  try {
    const parsed: unknown = JSON.parse(await readFile(mapFile(name), 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string' && isValid(entry[1])
      )
    )
  } catch {
    return {}
  }
}

export async function writePathMap(name: string, map: PathMap): Promise<void> {
  await writeFileSafely(mapFile(name), JSON.stringify(map, null, 2))
}

// True only when the agent file is really gone, not when it cannot be checked.
export async function isGone(path: string): Promise<boolean> {
  try {
    await access(path)
    return false
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    return code === 'ENOENT' || code === 'ENOTDIR'
  }
}

// Drops entries whose agent file no longer exists. Returns the removed values.
export async function prunePathMap(name: string, map: PathMap): Promise<string[]> {
  const removed: string[] = []
  for (const [agentPath, value] of Object.entries(map)) {
    if (await isGone(agentPath)) {
      delete map[agentPath]
      removed.push(value)
    }
  }
  if (removed.length > 0) await writePathMap(name, map)
  return removed
}
