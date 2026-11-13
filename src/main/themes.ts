import { app, dialog, nativeImage, type BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { mkdir, readFile, stat, unlink } from 'fs/promises'
import { basename, join } from 'path'
import type { AddThemeResult, ThemeChoices, ThemesErrorCode, ThemesResult } from '../shared/ipc'
import {
  MAX_THEME_BYTES,
  NONE_THEME,
  THEME_NOT_IMAGE,
  THEME_TOO_BIG,
  TOKYO_NIGHT,
  isValidFade,
  themeNameError,
  themeNameFromFile,
  themeSizeProblem,
  type ThemeInfo
} from '../shared/themes'
import { dropThemeFromChats, getChatTheme, setChatTheme } from './chats'
import { extensionFor, headerSize, kindFromFile, sniffImage, toDataUrl } from './imageFile'
import { isObject, readJsonFile, serialQueue, writeJsonFile } from './jsonFile'
import { writeFileSafely } from './safeWrite'
import { getDefaultTheme, setDefaultTheme } from './settings'

// Uploaded chat themes: userData/themes/<id>.png or <id>.jpg, one image per theme,
// stored exactly as it was uploaded, and userData/themes/themes.json as
// { version: 1, themes: [{ id, name, file, addedAt }] }.
// The window names a theme by id only. Every id is checked against themes.json, and
// a file name is always the one main made from the id, never one the window sent.
// The built-in Tokyo Night is bundled with the window and has no file here.

const VERSION = 1
const ID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

type ThemeRecord = { id: string; name: string; file: string; addedAt: number }

// Read once, then shared: every call sees and changes the same list.
let loaded: Promise<ThemeRecord[]> | null = null
const queue = serialQueue()

function themesDir(): string {
  return join(app.getPath('userData'), 'themes')
}

function indexPath(): string {
  return join(themesDir(), 'themes.json')
}

function readRecord(raw: unknown): ThemeRecord | null {
  if (!isObject(raw)) return null
  const { id, name, file, addedAt } = raw
  if (typeof id !== 'string' || !ID_FORMAT.test(id)) return null
  // The file is always <id>.png or <id>.jpg: a different name in themes.json is not
  // trusted.
  if (file !== `${id}.png` && file !== `${id}.jpg`) return null
  if (typeof name !== 'string' || themeNameError(name) !== null) return null
  if (typeof addedAt !== 'number' || !Number.isFinite(addedAt)) return null
  return { id, name: name.trim(), file, addedAt }
}

function load(): Promise<ThemeRecord[]> {
  loaded ??= readAll()
  return loaded
}

async function readAll(): Promise<ThemeRecord[]> {
  const records: ThemeRecord[] = []
  try {
    const raw = await readJsonFile(indexPath())
    if (isObject(raw) && raw.version === VERSION && Array.isArray(raw.themes)) {
      for (const entry of raw.themes) {
        const record = readRecord(entry)
        if (record && !records.some((other) => other.id === record.id)) records.push(record)
      }
    }
  } catch (err) {
    console.error('[themes] Could not read themes.json:', err)
  }
  return records
}

async function save(records: ThemeRecord[]): Promise<void> {
  await mkdir(themesDir(), { recursive: true })
  await writeJsonFile(indexPath(), { version: VERSION, themes: records })
}

function failure(
  code: ThemesErrorCode,
  message: string
): { ok: false; error: { code: ThemesErrorCode; message: string } } {
  return { ok: false, error: { code, message } }
}

function info(record: ThemeRecord, bytes: Buffer): ThemeInfo {
  return {
    id: record.id,
    name: record.name,
    addedAt: record.addedAt,
    image: toDataUrl(bytes, kindFromFile(record.file))
  }
}

// The uploaded themes, oldest first. A theme whose picture file is gone is left out.
export function listThemes(): Promise<ThemesResult<{ themes: ThemeInfo[] }>> {
  return queue(async () => {
    try {
      const records = [...(await load())].sort((a, b) => a.addedAt - b.addedAt)
      const themes: ThemeInfo[] = []
      for (const record of records) {
        try {
          themes.push(info(record, await readFile(join(themesDir(), record.file))))
        } catch (err) {
          console.error(`[themes] The picture for "${record.name}" could not be read:`, err)
        }
      }
      return { ok: true, themes }
    } catch (err) {
      console.error('[themes] Could not list themes:', err)
      return failure('io_error', 'The themes could not be read.')
    }
  })
}

// Adds the PNG or JPG at `path`, stored as it is. The checks run in this order, and
// the first to fail is the message:
// 1. Not larger than 5 MB.
// 2. A real PNG or JPEG (the file's first bytes, not its extension).
// 3. The size, read with nativeImage: at least 160x100 and at most 6000 on each side.
//    An image nativeImage cannot read gets the message from step 2. Any aspect ratio
//    is accepted.
export async function importThemeFile(path: string): Promise<AddThemeResult> {
  const fileName = basename(path)
  try {
    if ((await stat(path)).size > MAX_THEME_BYTES) return failure('too_large', THEME_TOO_BIG)
    const bytes = await readFile(path)
    if (bytes.length > MAX_THEME_BYTES) return failure('too_large', THEME_TOO_BIG)

    const kind = sniffImage(bytes)
    if (!kind) return failure('not_image', THEME_NOT_IMAGE)

    // The size in the file's header comes first. Decoding costs memory in proportion to
    // the size the file claims, not to the size of the file, so a small file that claims
    // a huge picture is refused before nativeImage is asked to decode it.
    const claimed = headerSize(bytes, kind)
    if (!claimed) return failure('not_image', THEME_NOT_IMAGE)
    const claimedProblem = themeSizeProblem(fileName, claimed.width, claimed.height)
    if (claimedProblem) return failure(claimedProblem.code, claimedProblem.message)

    // The size nativeImage reads is the one that counts. An empty image is one it
    // could not decode.
    const image = nativeImage.createFromBuffer(bytes)
    if (image.isEmpty()) return failure('not_image', THEME_NOT_IMAGE)
    const { width, height } = image.getSize()
    const problem = themeSizeProblem(fileName, width, height)
    if (problem) return failure(problem.code, problem.message)

    return await queue(async (): Promise<AddThemeResult> => {
      const records = await load()
      const id = randomUUID()
      // Newer than every theme already added, so "oldest first" is the order added.
      const addedAt = Math.max(Date.now(), ...records.map((record) => record.addedAt + 1))
      const record: ThemeRecord = {
        id,
        name: themeNameFromFile(fileName),
        file: `${id}.${extensionFor(kind)}`,
        addedAt
      }
      await mkdir(themesDir(), { recursive: true })
      const target = join(themesDir(), record.file)
      await writeFileSafely(target, bytes)
      try {
        await save([...records, record])
      } catch (err) {
        await unlink(target).catch(() => {})
        throw err
      }
      records.push(record)
      return { ok: true, canceled: false, theme: info(record, bytes) }
    })
  } catch (err) {
    console.error('[themes] Could not add the theme:', err)
    return failure('io_error', 'The theme could not be added.')
  }
}

// ADD THEME: the file dialog, filtered to PNG and JPG, then the checks above.
export async function addTheme(window: BrowserWindow | null): Promise<AddThemeResult> {
  const options: Electron.OpenDialogOptions = {
    title: 'Choose a theme: a PNG or JPG',
    properties: ['openFile'],
    filters: [{ name: 'PNG or JPG image', extensions: ['png', 'jpg', 'jpeg'] }]
  }
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return { ok: true, canceled: true }
  return importThemeFile(result.filePaths[0])
}

export function renameTheme(
  rawId: unknown,
  rawName: unknown
): Promise<ThemesResult<{ name: string }>> {
  return queue(async () => {
    if (typeof rawId !== 'string' || typeof rawName !== 'string') {
      return failure('invalid', 'That is not a theme name.')
    }
    const problem = themeNameError(rawName)
    if (problem) return failure('invalid', problem)
    try {
      const records = await load()
      const record = records.find((entry) => entry.id === rawId)
      if (!record) return failure('not_found', 'This theme no longer exists.')
      const name = rawName.trim()
      if (record.name !== name) {
        await save(records.map((entry) => (entry === record ? { ...entry, name } : entry)))
        record.name = name
      }
      return { ok: true, name }
    } catch (err) {
      console.error('[themes] Could not rename the theme:', err)
      return failure('io_error', 'The theme could not be renamed.')
    }
  })
}

// A theme id that exists: none, the built-in, or an uploaded one.
function isKnown(records: ThemeRecord[], themeId: string): boolean {
  return themeId === NONE_THEME || themeId === TOKYO_NIGHT || records.some((r) => r.id === themeId)
}

// The open chat's own theme and the default, each made to fit the themes that exist:
// a chat's own theme that is gone is dropped, and a default that is gone is "none"
// with the same fade.
export async function themeChoices(
  projectPath: string | null
): Promise<ThemesResult<ThemeChoices>> {
  try {
    const records = await load()
    let fallback = await getDefaultTheme()
    if (!isKnown(records, fallback.themeId)) fallback = { themeId: NONE_THEME, fade: fallback.fade }
    const own = projectPath ? await getChatTheme(projectPath) : null
    const chat = own && isKnown(records, own.themeId) ? own : null
    return { ok: true, chat, default: fallback }
  } catch (err) {
    console.error('[themes] Could not read the theme choice:', err)
    return failure('io_error', 'The theme choice could not be read.')
  }
}

// APPLY. THIS CHAT saves the choice for the open chat only. ALL CHATS saves it as the
// default and clears the chat's own choice. Everything is checked again here.
export async function setThemeChoice(
  projectPath: string | null,
  raw: unknown
): Promise<ThemesResult<ThemeChoices>> {
  if (
    !isObject(raw) ||
    (raw.scope !== 'chat' && raw.scope !== 'all') ||
    typeof raw.themeId !== 'string' ||
    !isValidFade(raw.fade)
  ) {
    return failure('invalid', 'That is not a theme choice.')
  }
  try {
    const records = await load()
    if (!isKnown(records, raw.themeId)) return failure('not_found', 'This theme no longer exists.')
    const choice = { themeId: raw.themeId, fade: raw.fade }
    if (raw.scope === 'chat') {
      if (!projectPath) return failure('no_project', 'No project is open.')
      await setChatTheme(projectPath, choice)
    } else {
      await setDefaultTheme(choice)
      if (projectPath) await setChatTheme(projectPath, null)
    }
    return themeChoices(projectPath)
  } catch (err) {
    console.error('[themes] Could not save the theme choice:', err)
    return failure('io_error', 'The theme choice could not be saved.')
  }
}

// Deletes an uploaded theme. A chat that used it drops its own choice and uses the
// default. If the default used it, the default becomes "none" with the same fade.
export function removeTheme(
  rawId: unknown,
  projectPath: string | null
): Promise<ThemesResult<ThemeChoices>> {
  return queue(async () => {
    if (typeof rawId !== 'string') return failure('invalid', 'That is not a theme.')
    try {
      const records = await load()
      const record = records.find((entry) => entry.id === rawId)
      if (!record) return failure('not_found', 'This theme no longer exists.')
      await save(records.filter((entry) => entry !== record))
      records.splice(records.indexOf(record), 1)
      await unlink(join(themesDir(), record.file)).catch((err: unknown) => {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.error('[themes] Could not delete the picture:', err)
        }
      })
      await dropThemeFromChats(record.id)
      const fallback = await getDefaultTheme()
      if (fallback.themeId === record.id) {
        await setDefaultTheme({ themeId: NONE_THEME, fade: fallback.fade })
      }
      return themeChoices(projectPath)
    } catch (err) {
      console.error('[themes] Could not delete the theme:', err)
      return failure('io_error', 'The theme could not be deleted.')
    }
  })
}
