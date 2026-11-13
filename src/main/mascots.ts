import { app, BrowserWindow, dialog, nativeImage, shell } from 'electron'
import { randomUUID } from 'crypto'
import type { Dirent } from 'fs'
import { mkdir, readdir, readFile, rm, stat, unlink, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import {
  IpcChannel,
  type ActiveMascotData,
  type DefaultMascotEdits,
  type MascotLoop,
  type MascotLoops,
  type MascotsErrorCode,
  type MascotSheetChange,
  type MascotsResult,
  type MascotSummary,
  type PickSheetResult,
  type SliceSheetResult
} from '../shared/ipc'
import { checkSlice, SLICE_EMPTY_MESSAGE } from '../shared/sliceRules'
import { cutFrames } from './sheetSlice'
import {
  canReverse,
  DEFAULT_MASCOT_ID,
  FRAME_SIZE,
  isEmojiLevel,
  isMascotState,
  isValidFps,
  MASCOT_STATES,
  mascotNameError,
  type MascotVoice,
  MAX_FPS,
  MAX_SHEET_BYTES,
  MAX_SOURCE_SIDE,
  MIN_FPS,
  SHEET_NOT_IMAGE,
  SHEET_NOT_PNG,
  sheetSizeProblem,
  sheetTooBigMessage,
  sourceTooLargeMessage,
  voiceEmojiError,
  voiceError,
  type MascotStateName
} from '../shared/mascotRules'
import { pngSize, readPngHeader, toPngDataUrl, type PngSize } from './png'
import { PendingFiles } from './pendingFiles'
import { renameWithRetry, writeFileSafely } from './safeWrite'
import { getActiveMascotId, setActiveMascotId } from './settings'

// Uploaded mascots. Each one is a folder userData/mascots/<uuid>/ holding
// manifest.json and one PNG per uploaded state (idle.png, thinking.png, ...).
// The built-in default is bundled with the renderer. The user's edits to it
// (name and loops) live in userData/mascots/default/ in the same format, and the
// renderer lays them over the bundled mascot; without that folder the bundled
// mascot is used as it is. The renderer names a mascot by id only; a path is
// built from an id once the id is checked to be "default" or a UUID.

const MANIFEST = 'manifest.json'
const MANIFEST_VERSION = 1
// Some editors save a byte order mark at the start of a file; JSON.parse rejects it.
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff)
const stripBom = (text: string): string => (text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
// A new mascot is built in .tmp-<uuid>/ and renamed into place when complete.
const TEMP_PREFIX = '.tmp-'

class MascotsFailure extends Error {
  constructor(
    readonly code: MascotsErrorCode,
    message: string
  ) {
    super(message)
  }
}

function fail(code: MascotsErrorCode, message: string): never {
  throw new MascotsFailure(code, message)
}

function invalid(message: string): never {
  fail('invalid', message)
}

function errorCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

// One mascot operation at a time, so a save, a delete, and a listing never interleave.
let queue: Promise<unknown> = Promise.resolve()

async function run<T extends object>(task: () => Promise<T>): Promise<MascotsResult<T>> {
  const result = queue.then(task, task)
  queue = result.catch(() => {})
  try {
    return { ok: true, ...(await result) }
  } catch (err) {
    if (err instanceof MascotsFailure) {
      return { ok: false, error: { code: err.code, message: err.message } }
    }
    console.error('[mascots]', err)
    return {
      ok: false,
      error: { code: 'io_error', message: 'The mascot files could not be read or written.' }
    }
  }
}

function mascotsDir(): string {
  return join(app.getPath('userData'), 'mascots')
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

// The only way a path is built from an id: a UUID for an uploaded mascot, or
// "default" for the folder that holds the user's edits to the built-in one.
function folderOf(id: string): string {
  if (id !== DEFAULT_MASCOT_ID && !isUuid(id)) invalid('That is not a mascot id.')
  return join(mascotsDir(), id)
}

async function isFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return false
    throw err
  }
}

function sheetFile(state: MascotStateName): string {
  return `${state}.png`
}

// Tells every window (the main one now, the popup in step 8) to load the active mascot again.
function broadcastChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IpcChannel.MascotsChanged)
  }
}

// --- Sheet rules ---------------------------------------------------------

type SheetCheck = { ok: true; frames: number; width: number } | { ok: false; message: string }

// All the rules, in order, on a whole file. The frame count comes from the width.
// The bytes are never changed.
function checkSheet(bytes: Buffer): SheetCheck {
  if (bytes.length > MAX_SHEET_BYTES)
    return { ok: false, message: sheetTooBigMessage(bytes.length) }
  const size = pngSize(bytes)
  if (!size) return { ok: false, message: SHEET_NOT_PNG }
  const problem = sheetSizeProblem(size.width, size.height)
  if (problem) return { ok: false, message: problem }
  if (!decodes(bytes, size)) return { ok: false, message: SHEET_NOT_IMAGE }
  return { ok: true, frames: size.width / FRAME_SIZE, width: size.width }
}

// Chromium does not load a URL longer than this.
const MAX_URL_LENGTH = 2 * 1024 * 1024

// A legal strip as a data: URL for the window. A strip is at most 1024x64, so a
// file too big for a data: URL is mostly extra chunks; the copy shown is then
// re-encoded without them. The stored file is never changed.
function stripUrl(bytes: Buffer): string {
  const url = toPngDataUrl(bytes)
  if (url.length <= MAX_URL_LENGTH) return url
  return toPngDataUrl(nativeImage.createFromBuffer(bytes).toPNG())
}

// True when the bytes decode to an image of the size the PNG header gives.
function decodes(bytes: Buffer, size: PngSize): boolean {
  const image = nativeImage.createFromBuffer(bytes)
  const decoded = image.isEmpty() ? null : image.getSize()
  return decoded !== null && decoded.width === size.width && decoded.height === size.height
}

// Picked and sliced sheets wait here until the mascot is saved. The dialog has
// five rows, and a replaced pick is discarded by the renderer, so a few slots are enough.
const pendingSheets = new PendingFiles<Buffer>(10)

// A sheet in another layout, waiting to be sliced. It stays until the dialog
// closes, so it can feed several states. The latest one is enough.
type SourceSheet = { bytes: Buffer; width: number; height: number }
const pendingSources = new PendingFiles<SourceSheet>(1)

export async function pickSheet(window: BrowserWindow | null): Promise<PickSheetResult> {
  const options: Electron.OpenDialogOptions = {
    title: 'Choose a spritesheet: a PNG strip or grid',
    properties: ['openFile'],
    filters: [{ name: 'PNG image', extensions: ['png'] }]
  }
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return { ok: true, canceled: true }

  const path = result.filePaths[0]
  const fileName = basename(path)
  const refuse = (message: string): PickSheetResult => ({
    ok: false,
    error: { code: 'invalid', message }
  })
  try {
    // Refusals, in order. Only the header and the file size are read before
    // the file is known to be a PNG under the size limit.
    const header = pngSize(await readPngHeader(path))
    if (!header) return refuse(SHEET_NOT_PNG)
    const { size } = await stat(path)
    if (size > MAX_SHEET_BYTES) return refuse(sheetTooBigMessage(size))
    if (header.width > MAX_SOURCE_SIDE || header.height > MAX_SOURCE_SIDE) {
      return refuse(sourceTooLargeMessage(header.width, header.height))
    }
    const bytes = await readFile(path)
    if (bytes.length > MAX_SHEET_BYTES) return refuse(sheetTooBigMessage(bytes.length))
    if (!decodes(bytes, header)) return refuse(SHEET_NOT_IMAGE)

    // A legal strip is used as it is; the slicer never opens.
    if (sheetSizeProblem(header.width, header.height) === null) {
      const check = checkSheet(bytes)
      if (!check.ok) return refuse(check.message)
      return {
        ok: true,
        canceled: false,
        kind: 'strip',
        token: pendingSheets.add(bytes),
        preview: stripUrl(bytes),
        frames: check.frames,
        width: check.width,
        fileName
      }
    }

    // Anything else is cut up in the slicer first.
    return {
      ok: true,
      canceled: false,
      kind: 'needs_slice',
      sourceToken: pendingSources.add({ bytes, width: header.width, height: header.height }),
      fileName,
      width: header.width,
      height: header.height,
      bytes
    }
  } catch (err) {
    console.error('Could not read the sheet:', err)
    return { ok: false, error: { code: 'io_error', message: 'The sheet file could not be read.' } }
  }
}

export function discardSheet(token: string): void {
  pendingSheets.delete(token)
}

export function dropSources(): void {
  pendingSources.clear()
}

const SLICE_FAILED = 'The sheet could not be cut into frames.'

// Cuts the picked cells out of a source sheet into an ordinary strip of 64x64
// frames, which then waits behind a token like a picked sheet. Every argument
// is checked again; nothing is written to disk.
export function sliceSheet(
  rawToken: unknown,
  columns: unknown,
  rows: unknown,
  cells: unknown
): SliceSheetResult {
  const source = typeof rawToken === 'string' ? pendingSources.get(rawToken) : undefined
  if (!source) {
    return {
      ok: false,
      error: { code: 'not_found', message: 'This sheet is no longer loaded. Upload it again.' }
    }
  }
  const status = checkSlice(source.width, source.height, columns, rows, cells)
  if (!status.canUse) {
    const message = status.level === 'error' ? status.message : SLICE_EMPTY_MESSAGE
    return { ok: false, error: { code: 'invalid_slice', message } }
  }
  // checkSlice has proved these are whole numbers in range.
  const grid = { columns: columns as number, cells: cells as number[] }
  try {
    const bitmap = nativeImage.createFromBuffer(source.bytes).toBitmap()
    if (bitmap.length !== source.width * source.height * 4)
      throw new Error('Unexpected bitmap size')
    const cellSize = source.width / grid.columns
    const strip = cutFrames(bitmap, source.width, grid.columns, cellSize, grid.cells)
    const png = nativeImage
      .createFromBitmap(strip, { width: FRAME_SIZE * grid.cells.length, height: FRAME_SIZE })
      .toPNG()
    // The cut must pass the same rules as any picked sheet. If not, it is a bug in the cut.
    const check = checkSheet(png)
    if (!check.ok || check.frames !== grid.cells.length) {
      throw new Error(
        `Sliced sheet failed the sheet rules: ${check.ok ? 'frame count' : check.message}`
      )
    }
    return {
      ok: true,
      token: pendingSheets.add(png),
      frames: check.frames,
      preview: toPngDataUrl(png)
    }
  } catch (err) {
    console.error('[mascots] Could not slice the sheet:', err)
    return { ok: false, error: { code: 'io_error', message: SLICE_FAILED } }
  }
}

// --- Reading mascots -----------------------------------------------------

// `reverse` is only written when it is on, so a manifest from before the option (or
// one with it off) has no such field and reads as off.
type ManifestEntry = { file: string; frames: number; fps: number; reverse: boolean }
type ManifestStates = Partial<Record<MascotStateName, ManifestEntry>>

type ParsedManifest =
  | { ok: true; name: string; states: ManifestStates; voice: MascotVoice | null }
  | { ok: false; name: string | null; problem: string }

// The default's edits may leave out idle: the bundled idle sheet is used then.
function parseManifest(text: string, idleRequired: boolean): ParsedManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, name: null, problem: 'manifest.json is not valid JSON.' }
  }
  if (!isObject(parsed)) {
    return { ok: false, name: null, problem: 'manifest.json is not a mascot manifest.' }
  }
  const name =
    typeof parsed.name === 'string' && mascotNameError(parsed.name) === null
      ? parsed.name.trim()
      : null
  const broken = (problem: string): ParsedManifest => ({ ok: false, name, problem })

  if (parsed.version !== MANIFEST_VERSION) return broken('manifest.json has an unknown version.')
  if (name === null) return broken('manifest.json has no valid name.')
  if (!isObject(parsed.states)) return broken('manifest.json has no states.')

  const states: ManifestStates = {}
  for (const [key, value] of Object.entries(parsed.states)) {
    if (!isMascotState(key)) {
      return broken(`manifest.json lists an unknown state, "${key.slice(0, 40)}".`)
    }
    if (
      !isObject(value) ||
      value.file !== sheetFile(key) ||
      typeof value.frames !== 'number' ||
      !isValidFps(value.fps) ||
      (value.reverse !== undefined && typeof value.reverse !== 'boolean')
    ) {
      return broken(`manifest.json has a broken entry for ${key}.`)
    }
    states[key] = {
      file: value.file,
      frames: value.frames,
      fps: value.fps,
      reverse: value.reverse === true
    }
  }
  if (idleRequired && !states.idle) return broken('This mascot has no idle sheet.')

  let voice: MascotVoice | null = null
  if (parsed.voice !== undefined) {
    if (
      !isObject(parsed.voice) ||
      typeof parsed.voice.text !== 'string' ||
      voiceError(parsed.voice.text) !== null ||
      !isEmojiLevel(parsed.voice.emoji)
    ) {
      return broken('manifest.json has a broken voice.')
    }
    voice = { text: parsed.voice.text.trim(), emoji: parsed.voice.emoji }
  }

  return { ok: true, name, states, voice }
}

type LoadedSheet = { ok: true; bytes: Buffer; frames: number } | { ok: false; problem: string }

// Runs the sheet rules again on a stored sheet.
async function loadSheet(folder: string, file: string): Promise<LoadedSheet> {
  const path = join(folder, file)
  try {
    const { size } = await stat(path)
    if (size > MAX_SHEET_BYTES)
      return { ok: false, problem: `${file}: ${sheetTooBigMessage(size)}` }
    const bytes = await readFile(path)
    const check = checkSheet(bytes)
    if (!check.ok) return { ok: false, problem: `${file}: ${check.message}` }
    return { ok: true, bytes, frames: check.frames }
  } catch (err) {
    const missing = errorCode(err) === 'ENOENT'
    return { ok: false, problem: missing ? `${file} is missing.` : `${file} could not be read.` }
  }
}

type FolderContents =
  | { ok: true; name: string; loops: Partial<MascotLoops>; voice: MascotVoice | null }
  | { ok: false; name: string | null; problem: string }

// Reads a mascot folder and runs the sheet rules on every sheet. Never throws:
// anything wrong becomes the problem.
async function readMascotFolder(id: string, idleRequired: boolean): Promise<FolderContents> {
  const folder = folderOf(id)
  const problem = (name: string | null, reason: string): FolderContents => ({
    ok: false,
    name,
    problem: reason
  })

  let text: string
  try {
    text = await readFile(join(folder, MANIFEST), 'utf8')
  } catch (err) {
    const missing = errorCode(err) === 'ENOENT'
    return problem(null, missing ? 'manifest.json is missing.' : 'manifest.json could not be read.')
  }
  const manifest = parseManifest(stripBom(text), idleRequired)
  if (!manifest.ok) return problem(manifest.name, manifest.problem)

  const loops: Partial<Record<MascotStateName, MascotLoop>> = {}
  for (const state of MASCOT_STATES) {
    const entry = manifest.states[state]
    if (!entry) continue
    const sheet = await loadSheet(folder, entry.file)
    if (!sheet.ok) return problem(manifest.name, sheet.problem)
    // The image decides the frame count, whatever the manifest says.
    loops[state] = {
      src: stripUrl(sheet.bytes),
      frames: sheet.frames,
      fps: entry.fps,
      // It only means something with three or more frames, whatever the manifest says.
      reverse: entry.reverse && canReverse(sheet.frames)
    }
  }
  return { ok: true, name: manifest.name, loops, voice: manifest.voice }
}

async function loadMascot(id: string): Promise<MascotSummary> {
  const contents = await readMascotFolder(id, true)
  if (!contents.ok) {
    return { id, name: contents.name ?? id, loops: {}, problem: contents.problem }
  }
  const { idle } = contents.loops
  if (!idle)
    return { id, name: contents.name, loops: {}, problem: 'This mascot has no idle sheet.' }
  return {
    id,
    name: contents.name,
    loops: { ...contents.loops, idle },
    voice: contents.voice,
    problem: null
  }
}

// The user's edits to the built-in default. No folder means no edits.
async function loadDefaultEdits(): Promise<DefaultMascotEdits> {
  if (!(await isFolder(folderOf(DEFAULT_MASCOT_ID)))) {
    return { edited: false, name: null, loops: {}, voice: null, problem: null }
  }
  const contents = await readMascotFolder(DEFAULT_MASCOT_ID, false)
  if (!contents.ok)
    return { edited: true, name: null, loops: {}, voice: null, problem: contents.problem }
  return {
    edited: true,
    name: contents.name,
    loops: contents.loops,
    voice: contents.voice,
    problem: null
  }
}

async function createdTime(path: string): Promise<number> {
  try {
    const info = await stat(path)
    return info.birthtimeMs || info.mtimeMs
  } catch {
    return 0
  }
}

// A build interrupted by a crash leaves a temporary folder. The queue means no
// build is running while this runs.
async function removeLeftovers(entries: Dirent[]): Promise<void> {
  for (const entry of entries) {
    const rest = entry.name.slice(TEMP_PREFIX.length)
    if (entry.isDirectory() && entry.name.startsWith(TEMP_PREFIX) && isUuid(rest)) {
      await rm(join(mascotsDir(), entry.name), { recursive: true, force: true }).catch(() => {})
    }
  }
}

export function listMascots(): Promise<
  MascotsResult<{ mascots: MascotSummary[]; defaultMascot: DefaultMascotEdits; activeId: string }>
> {
  return run(async () => {
    let entries: Dirent[]
    try {
      entries = await readdir(mascotsDir(), { withFileTypes: true })
    } catch (err) {
      if (errorCode(err) !== 'ENOENT') throw err
      entries = []
    }
    await removeLeftovers(entries)

    const ids = entries.filter((e) => e.isDirectory() && isUuid(e.name)).map((e) => e.name)
    const timed = await Promise.all(
      ids.map(async (id) => ({ id, time: await createdTime(join(mascotsDir(), id)) }))
    )
    timed.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id))

    const mascots: MascotSummary[] = []
    for (const { id } of timed) mascots.push(await loadMascot(id))

    const defaultMascot = await loadDefaultEdits()
    const saved = await getActiveMascotId()
    const active = mascots.find((mascot) => mascot.id === saved && mascot.problem === null)
    return { mascots, defaultMascot, activeId: active ? active.id : DEFAULT_MASCOT_ID }
  })
}

// The id, name, loops, and voice of the mascot to show now. A missing or broken
// mascot gives the default, and broken edits to the default give the bundled
// mascot, so there is always one. Shared by the active-mascot IPC call and by
// the system-prompt voice, so both resolve "active" the same way.
async function resolveActiveMascot(): Promise<{
  id: string
  name: string | null
  loops: Partial<MascotLoops>
  voice: MascotVoice | null
}> {
  const id = await getActiveMascotId()
  if (isUuid(id)) {
    const mascot = await loadMascot(id)
    if (mascot.problem === null) {
      return { id, name: mascot.name, loops: mascot.loops, voice: mascot.voice }
    }
  }
  const edits = await loadDefaultEdits()
  return { id: DEFAULT_MASCOT_ID, name: edits.name, loops: edits.loops, voice: edits.voice }
}

// The mascot to show.
export function getActiveMascot(): Promise<MascotsResult<{ mascot: ActiveMascotData }>> {
  return run(async () => {
    const { id, name, loops } = await resolveActiveMascot()
    return { mascot: { id, name, loops } }
  })
}

// The active mascot's name and voice, for the agent run's system-prompt append.
// Goes through the same queue as every other mascot read, and never throws: a
// missing or broken mascot gives no voice rather than failing the caller.
export function getActiveVoice(): Promise<{ name: string | null; voice: MascotVoice | null }> {
  return run(async () => {
    const { name, voice } = await resolveActiveMascot()
    return { name, voice }
  }).then((result) =>
    result.ok ? { name: result.name, voice: result.voice } : { name: null, voice: null }
  )
}

// --- Changing mascots ----------------------------------------------------

type CleanDraft = {
  name: string
  states: Record<MascotStateName, { fps: number; reverse: boolean; sheet: MascotSheetChange }>
  voice: MascotVoice | null
}

function readSheetChange(raw: unknown): MascotSheetChange | null {
  if (!isObject(raw)) return null
  if (raw.type === 'keep' || raw.type === 'remove') return { type: raw.type }
  if (raw.type === 'token' && typeof raw.token === 'string') {
    return { type: 'token', token: raw.token }
  }
  return null
}

// Checks every field of a draft from the renderer.
function readDraft(raw: unknown): CleanDraft {
  if (!isObject(raw)) invalid('The mascot details are missing.')
  if (typeof raw.name !== 'string') invalid('Name is required.')
  const nameError = mascotNameError(raw.name)
  if (nameError) invalid(nameError)
  if (!isObject(raw.states)) invalid('The mascot loops are missing.')
  for (const key of Object.keys(raw.states)) {
    if (!isMascotState(key)) invalid(`Unknown state "${key.slice(0, 40)}".`)
  }

  const states = {} as CleanDraft['states']
  for (const state of MASCOT_STATES) {
    const entry = raw.states[state]
    if (!isObject(entry)) invalid(`The ${state} loop is missing.`)
    if (!isValidFps(entry.fps)) {
      invalid(`FPS for ${state} must be a whole number from ${MIN_FPS} to ${MAX_FPS}.`)
    }
    if (typeof entry.reverse !== 'boolean') invalid(`The ${state} reverse setting is not valid.`)
    const sheet = readSheetChange(entry.sheet)
    if (!sheet) invalid(`The ${state} sheet change is not valid.`)
    if (sheet.type === 'token' && !pendingSheets.has(sheet.token)) {
      invalid(`The ${state} sheet is no longer available. Upload it again.`)
    }
    states[state] = { fps: entry.fps, reverse: entry.reverse, sheet }
  }

  let voice: MascotVoice | null = null
  if (raw.voice !== null) {
    if (!isObject(raw.voice) || typeof raw.voice.text !== 'string') {
      invalid('The mascot voice is missing.')
    }
    const textError = voiceError(raw.voice.text)
    if (textError) invalid(textError)
    if (!isEmojiLevel(raw.voice.emoji)) {
      invalid(voiceEmojiError(raw.voice.emoji) ?? 'Emoji level is not valid.')
    }
    voice = { text: raw.voice.text.trim(), emoji: raw.voice.emoji }
  }

  return { name: raw.name.trim(), states, voice }
}

type SavePlan = {
  states: ManifestStates
  writes: { state: MascotStateName; bytes: Buffer }[]
  removals: MascotStateName[]
  tokens: string[]
}

// What to write, keep, and remove. Picked sheets are checked again here. The
// default's edits may have no idle: the bundled idle sheet is used then.
function planSave(
  draft: CleanDraft,
  existing: Partial<MascotLoops> | null,
  idleRequired: boolean
): SavePlan {
  const plan: SavePlan = { states: {}, writes: [], removals: [], tokens: [] }
  for (const state of MASCOT_STATES) {
    const { fps, reverse, sheet } = draft.states[state]
    const current = existing?.[state]
    const file = sheetFile(state)
    if (sheet.type === 'token') {
      const bytes = pendingSheets.get(sheet.token)
      if (!bytes) invalid(`The ${state} sheet is no longer available. Upload it again.`)
      const check = checkSheet(bytes)
      if (!check.ok) invalid(`${state}: ${check.message}`)
      plan.writes.push({ state, bytes })
      plan.tokens.push(sheet.token)
      plan.states[state] = {
        file,
        frames: check.frames,
        fps,
        reverse: reverse && canReverse(check.frames)
      }
    } else if (sheet.type === 'keep' && current) {
      plan.states[state] = {
        file,
        frames: current.frames,
        fps,
        reverse: reverse && canReverse(current.frames)
      }
    } else if (sheet.type === 'remove' && current) {
      plan.removals.push(state)
    }
  }
  if (idleRequired && !plan.states.idle) fail('no_idle', 'Idle is required. Upload an idle sheet.')
  return plan
}

// Builds a whole mascot folder in a temporary folder, manifest last, then
// renames it into place, so a half-written folder never appears.
async function writeNewFolder(
  target: string,
  name: string,
  voice: MascotVoice | null,
  plan: SavePlan
): Promise<void> {
  const dir = mascotsDir()
  await mkdir(dir, { recursive: true })
  const temp = join(dir, `${TEMP_PREFIX}${randomUUID()}`)
  await mkdir(temp)
  try {
    for (const { state, bytes } of plan.writes) {
      await writeFile(join(temp, sheetFile(state)), bytes)
    }
    await writeFileSafely(join(temp, MANIFEST), manifestText(name, voice, plan.states))
    await renameWithRetry(temp, target)
  } catch (err) {
    await rm(temp, { recursive: true, force: true }).catch(() => {})
    throw err
  }
}

// Changes an existing folder: new sheets first, each through a temporary file,
// then the manifest, then removed sheets.
async function writeExistingFolder(
  folder: string,
  name: string,
  voice: MascotVoice | null,
  plan: SavePlan
): Promise<void> {
  for (const { state, bytes } of plan.writes) {
    await writeFileSafely(join(folder, sheetFile(state)), bytes)
  }
  await writeFileSafely(join(folder, MANIFEST), manifestText(name, voice, plan.states))
  // The manifest no longer lists removed sheets, so a failure here only leaves a stray file.
  for (const state of plan.removals) {
    await unlink(join(folder, sheetFile(state))).catch((err: unknown) => {
      if (errorCode(err) !== 'ENOENT') console.error('[mascots] Could not remove a sheet:', err)
    })
  }
}

// What is written for a state: `reverse` is left out when it is off.
type StoredEntry = Omit<ManifestEntry, 'reverse'> & { reverse?: true }

function manifestText(name: string, voice: MascotVoice | null, states: ManifestStates): string {
  // States in the dialog's order. `reverse` is written only when it is on.
  const ordered: Partial<Record<MascotStateName, StoredEntry>> = {}
  for (const state of MASCOT_STATES) {
    const entry = states[state]
    if (!entry) continue
    const { reverse, ...rest } = entry
    ordered[state] = reverse ? { ...rest, reverse: true } : rest
  }
  // `voice` is written only when set, right after `name`.
  const manifest = {
    version: MANIFEST_VERSION,
    name,
    ...(voice ? { voice } : {}),
    states: ordered
  }
  return `${JSON.stringify(manifest, null, 2)}\n`
}

// An id the renderer sent for an uploaded mascot. The default cannot be changed.
function uploadedId(raw: unknown, action: string): string {
  if (raw === DEFAULT_MASCOT_ID) invalid(`The built-in mascot cannot be ${action}.`)
  if (!isUuid(raw)) invalid('That is not a mascot id.')
  return raw
}

async function assertExists(id: string): Promise<void> {
  try {
    if ((await stat(folderOf(id))).isDirectory()) return
  } catch (err) {
    if (errorCode(err) !== 'ENOENT') throw err
  }
  fail('not_found', 'This mascot no longer exists.')
}

export function createMascot(rawDraft: unknown): Promise<MascotsResult<{ id: string }>> {
  return run(async () => {
    const draft = readDraft(rawDraft)
    const plan = planSave(draft, null, true)
    const id = randomUUID()
    await writeNewFolder(folderOf(id), draft.name, draft.voice, plan)
    for (const token of plan.tokens) pendingSheets.delete(token)
    return { id }
  })
}

// Edits to the built-in default go to mascots/default/, never to the bundled files.
async function updateDefault(rawDraft: unknown): Promise<{ id: string }> {
  const edits = await loadDefaultEdits()
  if (edits.problem !== null) {
    invalid(`The default mascot's changes cannot be loaded. ${edits.problem} Reset it first.`)
  }
  const draft = readDraft(rawDraft)
  const plan = planSave(draft, edits.loops, false)
  const folder = folderOf(DEFAULT_MASCOT_ID)
  if (edits.edited) await writeExistingFolder(folder, draft.name, draft.voice, plan)
  else await writeNewFolder(folder, draft.name, draft.voice, plan)
  for (const token of plan.tokens) pendingSheets.delete(token)
  // The default also stands in for a missing or broken active mascot, so always tell.
  broadcastChanged()
  return { id: DEFAULT_MASCOT_ID }
}

export function updateMascot(
  rawId: unknown,
  rawDraft: unknown
): Promise<MascotsResult<{ id: string }>> {
  return run(async () => {
    if (rawId === DEFAULT_MASCOT_ID) return updateDefault(rawDraft)
    const id = uploadedId(rawId, 'edited')
    await assertExists(id)
    const existing = await loadMascot(id)
    if (existing.problem !== null) invalid(`This mascot cannot be edited. ${existing.problem}`)
    const draft = readDraft(rawDraft)
    const plan = planSave(draft, existing.loops, true)
    await writeExistingFolder(folderOf(id), draft.name, draft.voice, plan)
    for (const token of plan.tokens) pendingSheets.delete(token)

    if ((await getActiveMascotId()) === id) broadcastChanged()
    return { id }
  })
}

export function removeMascot(rawId: unknown): Promise<MascotsResult> {
  return run(async () => {
    const id = uploadedId(rawId, 'deleted')
    await assertExists(id)
    await shell.trashItem(folderOf(id))
    if ((await getActiveMascotId()) === id) {
      await setActiveMascotId(DEFAULT_MASCOT_ID)
      broadcastChanged()
    }
    return {}
  })
}

// Moves the default's edits to the trash. The bundled mascot is used again.
export function resetDefaultMascot(): Promise<MascotsResult> {
  return run(async () => {
    const folder = folderOf(DEFAULT_MASCOT_ID)
    if (await isFolder(folder)) {
      await shell.trashItem(folder)
      broadcastChanged()
    }
    return {}
  })
}

export function setActiveMascot(rawId: unknown): Promise<MascotsResult> {
  return run(async () => {
    const id = rawId === DEFAULT_MASCOT_ID ? DEFAULT_MASCOT_ID : uploadedId(rawId, 'changed')
    if (id !== DEFAULT_MASCOT_ID) {
      await assertExists(id)
      const mascot = await loadMascot(id)
      if (mascot.problem !== null) invalid(`This mascot cannot be set active. ${mascot.problem}`)
    }
    await setActiveMascotId(id)
    broadcastChanged()
    return {}
  })
}
