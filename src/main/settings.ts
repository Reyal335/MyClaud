import { app } from 'electron'
import { readFile, writeFile, stat } from 'fs/promises'
import { basename, join } from 'path'
import type { ProjectInfo } from '../shared/ipc'

type Settings = {
  projectPath?: string
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

// A missing or corrupt file means empty settings, never a crash.
async function readSettings(): Promise<Settings> {
  try {
    const parsed: unknown = JSON.parse(await readFile(settingsPath(), 'utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const { projectPath } = parsed as Record<string, unknown>
      return typeof projectPath === 'string' ? { projectPath } : {}
    }
  } catch {
    // Fall through to empty settings.
  }
  return {}
}

async function writeSettings(settings: Settings): Promise<void> {
  await writeFile(settingsPath(), JSON.stringify(settings, null, 2), 'utf8')
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
    projectPath && (await isDirectory(projectPath)) ? toProjectInfo(projectPath) : null
}

export function getProject(): ProjectInfo | null {
  return currentProject
}

export async function setProject(path: string): Promise<ProjectInfo> {
  currentProject = toProjectInfo(path)
  try {
    await writeSettings({ ...(await readSettings()), projectPath: path })
  } catch (err) {
    // The project still opens for this session; it just won't be remembered.
    console.error('Could not save settings:', err instanceof Error ? err.message : err)
  }
  return currentProject
}
