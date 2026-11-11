import { app, BrowserWindow, dialog } from 'electron'
import { randomBytes } from 'crypto'
import { mkdir, readFile, unlink } from 'fs/promises'
import { join } from 'path'
import type { AgentIconChange, PickIconResult } from '../shared/ipc'
import { writeFileSafely } from './safeWrite'
import { normalizePath, prunePathMap, readPathMap, writePathMap, type PathMap } from './pathMap'
import { pngSize, readPngHeader, toPngDataUrl } from './png'
import { PendingFiles } from './pendingFiles'

// Icons live in userData, never in the agent files: icon images in agent-icons/
// and the map from agent file path to icon filename in agent-icons.json.

const ICON_SIZE = 16
const NOT_PNG = 'Icon must be a PNG file.'
const ICON_FILE = /^[0-9a-f]{32}\.png$/

const MAP_FILE = 'agent-icons.json'

function iconsDir(): string {
  return join(app.getPath('userData'), 'agent-icons')
}

// A missing or corrupt map means no icons, never a crash.
function readMap(): Promise<PathMap> {
  return readPathMap(MAP_FILE, (file) => ICON_FILE.test(file))
}

function writeMap(map: PathMap): Promise<void> {
  return writePathMap(MAP_FILE, map)
}

async function deleteIconFile(file: string): Promise<void> {
  await unlink(join(iconsDir(), file)).catch(() => {})
}

// Reads the map, dropping entries whose agent file no longer exists. Returns the
// agent-path lookup used to fill in the list.
export async function loadIcons(): Promise<(agentPath: string) => Promise<string | null>> {
  const map = await readMap()
  for (const file of await prunePathMap(MAP_FILE, map)) await deleteIconFile(file)

  return async (agentPath) => {
    const file = map[normalizePath(agentPath)]
    if (!file) return null
    try {
      return toPngDataUrl(await readFile(join(iconsDir(), file)))
    } catch {
      return null
    }
  }
}

// Picked icons wait here until the agent is saved. There is one form, so one pick at a time.
const pendingIcons = new PendingFiles<Buffer>(1)

// Returns the message to show, or null if the header is a 16x16 PNG.
function iconProblem(header: Buffer): string | null {
  const size = pngSize(header)
  if (!size) return NOT_PNG
  const { width, height } = size
  if (width === ICON_SIZE && height === ICON_SIZE) return null
  return `Icon must be exactly 16x16. This one is ${width}x${height}.`
}

export async function pickIcon(window: BrowserWindow | null): Promise<PickIconResult> {
  const options: Electron.OpenDialogOptions = {
    title: 'Choose a 16x16 PNG icon',
    properties: ['openFile'],
    filters: [{ name: 'PNG image', extensions: ['png'] }]
  }
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return { ok: true, canceled: true }

  const path = result.filePaths[0]
  try {
    const problem = iconProblem(await readPngHeader(path))
    if (problem) return { ok: false, error: { code: 'invalid', message: problem } }
    const bytes = await readFile(path)
    const token = pendingIcons.add(bytes)
    return { ok: true, canceled: false, token, preview: toPngDataUrl(bytes) }
  } catch (err) {
    console.error('Could not read the icon:', err)
    return { ok: false, error: { code: 'io_error', message: 'The icon file could not be read.' } }
  }
}

export function discardIcon(token: string): void {
  pendingIcons.delete(token)
}

export function hasPendingIcon(token: string): boolean {
  return pendingIcons.has(token)
}

// Writes a picked icon to disk ahead of the agent save. Returns its filename, or
// null when the change does not add an icon.
export async function storePickedIcon(change: AgentIconChange): Promise<string | null> {
  if (change.type !== 'token') return null
  const bytes = pendingIcons.get(change.token)
  if (!bytes) return null
  await mkdir(iconsDir(), { recursive: true })
  const file = `${randomBytes(16).toString('hex')}.png`
  await writeFileSafely(join(iconsDir(), file), bytes)
  return file
}

export async function dropStoredIcon(file: string | null): Promise<void> {
  if (file) await deleteIconFile(file)
}

// Records an icon change once the agent file is saved. `fromPath` is where the
// agent was before (null for a new agent), so a moved agent keeps its icon.
export async function commitIconChange(
  fromPath: string | null,
  toPath: string,
  change: AgentIconChange,
  storedFile: string | null
): Promise<void> {
  const map = await readMap()
  const fromKey = fromPath === null ? null : normalizePath(fromPath)
  const toKey = normalizePath(toPath)
  const previous = fromKey === null ? undefined : map[fromKey]
  const replaced = map[toKey]

  if (fromKey !== null) delete map[fromKey]
  delete map[toKey]

  let current: string | undefined
  if (change.type === 'keep') current = previous
  else if (change.type === 'token' && storedFile) current = storedFile
  if (current) map[toKey] = current
  await writeMap(map)

  if (change.type === 'token') pendingIcons.delete(change.token)
  for (const old of new Set([previous, replaced])) {
    if (old && old !== current) await deleteIconFile(old)
  }
}

export async function forgetIcon(agentPath: string): Promise<void> {
  const map = await readMap()
  const key = normalizePath(agentPath)
  const file = map[key]
  if (!file) return
  delete map[key]
  await writeMap(map)
  await deleteIconFile(file)
}
