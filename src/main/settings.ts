import { app } from 'electron'
import { readFile, stat } from 'fs/promises'
import { basename, join } from 'path'
import type { PartyPanelMode, ProjectInfo } from '../shared/ipc'
import { DEFAULT_MASCOT_ID } from '../shared/mascotRules'
import { AUTO, type ModelChoice } from '../shared/models'
import { writeFileSafely } from './safeWrite'

type RawSettings = Record<string, unknown>

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

// A missing or corrupt file means empty settings, never a crash.
async function readSettings(): Promise<RawSettings> {
  try {
    const parsed: unknown = JSON.parse(await readFile(settingsPath(), 'utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as RawSettings
    }
  } catch {
    // Fall through to empty settings.
  }
  return {}
}

// One read-change-write at a time, so two settings never overwrite each other.
// Keys this version does not know are kept.
let queue: Promise<unknown> = Promise.resolve()

function updateSettings(patch: RawSettings): Promise<void> {
  const task = async (): Promise<void> => {
    const next = { ...(await readSettings()), ...patch }
    await writeFileSafely(settingsPath(), JSON.stringify(next, null, 2))
  }
  const result = queue.then(task, task)
  queue = result.catch(() => {})
  return result
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

export function toProjectInfo(path: string): ProjectInfo {
  return { path, name: basename(path) || path }
}

// The project open in this app session. Loaded once at startup.
let currentProject: ProjectInfo | null = null

export async function loadProject(): Promise<void> {
  const { projectPath } = await readSettings()
  currentProject =
    typeof projectPath === 'string' && (await isDirectory(projectPath))
      ? toProjectInfo(projectPath)
      : null
}

export function getProject(): ProjectInfo | null {
  return currentProject
}

export async function setProject(path: string): Promise<ProjectInfo> {
  currentProject = toProjectInfo(path)
  try {
    await updateSettings({ projectPath: path })
  } catch (err) {
    // The project still opens for this session; it just won't be remembered.
    console.error('Could not save settings:', err instanceof Error ? err.message : err)
  }
  return currentProject
}

// The chosen mascot's id as saved. The caller checks it still exists and works.
export async function getActiveMascotId(): Promise<string> {
  const { activeMascotId } = await readSettings()
  return typeof activeMascotId === 'string' ? activeMascotId : DEFAULT_MASCOT_ID
}

export function setActiveMascotId(id: string): Promise<void> {
  return updateSettings({ activeMascotId: id })
}

// The party panel as I last left it with its collapse button, or null before I
// have chosen.
export async function getPartyPanel(): Promise<PartyPanelMode | null> {
  const { partyPanel } = await readSettings()
  return partyPanel === 'open' || partyPanel === 'rail' ? partyPanel : null
}

export function setPartyPanel(mode: PartyPanelMode): Promise<void> {
  return updateSettings({ partyPanel: mode })
}

// The model and thinking choice a new chat starts from. AUTO and AUTO until I save
// one with "Use for new chats too". A value that is not text reads as AUTO.
export async function getDefaultChoice(): Promise<ModelChoice> {
  const { defaultModel, defaultEffort } = await readSettings()
  return {
    model: typeof defaultModel === 'string' && defaultModel !== '' ? defaultModel : AUTO,
    effort: typeof defaultEffort === 'string' && defaultEffort !== '' ? defaultEffort : AUTO
  }
}

export function setDefaultChoice(choice: ModelChoice): Promise<void> {
  return updateSettings({ defaultModel: choice.model, defaultEffort: choice.effort })
}

// Popups are on until I turn them off.
export async function getPopups(): Promise<boolean> {
  const { popups } = await readSettings()
  return popups !== false
}

export function setPopups(on: boolean): Promise<void> {
  return updateSettings({ popups: on })
}
