import { shell } from 'electron'
import { randomBytes } from 'crypto'
import type { Stats } from 'fs'
import { mkdir, readdir, readFile, realpath, stat, unlink } from 'fs/promises'
import { homedir } from 'os'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'path'
import type {
  AgentDetail,
  AgentDraft,
  AgentFolders,
  AgentIconChange,
  AgentScope,
  AgentsError,
  AgentsErrorCode,
  AgentsResult,
  AgentSummary
} from '../shared/ipc'
import {
  agentDescriptionError,
  agentNameError,
  agentRoleError,
  agentToolsError,
  safeFileStem
} from '../shared/agentRules'
import { buildAgentFile, editAgentFile, readAgentFile, type AgentEdits } from './agentFile'
import {
  commitIconChange,
  dropStoredIcon,
  forgetIcon,
  hasPendingIcon,
  loadIcons,
  storePickedIcon
} from './agentIcons'
import { forgetRole, loadRoles, saveRole } from './agentRoles'
import { normalizePath } from './pathMap'
import { createFileSafely, writeFileSafely } from './safeWrite'
import { getProject } from './settings'

// Claude Code's own subagent files. The renderer names agents by file path, and
// every path is checked to be a .md file inside one of the two agents folders.

class AgentsFailure extends Error {
  constructor(
    readonly code: AgentsErrorCode,
    message: string
  ) {
    super(message)
  }
}

function fail(code: AgentsErrorCode, message: string): never {
  throw new AgentsFailure(code, message)
}

function errorCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code
}

// One file operation at a time, so a save, a delete, and the icon map never interleave.
let queue: Promise<unknown> = Promise.resolve()

async function run<T extends object>(task: () => Promise<T>): Promise<AgentsResult<T>> {
  const result = queue.then(task, task)
  queue = result.catch(() => {})
  try {
    return { ok: true, ...(await result) }
  } catch (err) {
    if (err instanceof AgentsFailure) {
      return { ok: false, error: { code: err.code, message: err.message } }
    }
    console.error('[agents]', err)
    const error: AgentsError = {
      code: 'io_error',
      message: err instanceof Error ? err.message : 'The agent files could not be read or written.'
    }
    return { ok: false, error }
  }
}

// Claude Code keeps its global files in CLAUDE_CONFIG_DIR when it is set.
function globalAgentsDir(): string {
  const configDir = process.env['CLAUDE_CONFIG_DIR']?.trim()
  return join(configDir ? resolve(configDir) : join(homedir(), '.claude'), 'agents')
}

function folders(): AgentFolders {
  const global = globalAgentsDir()
  const project = getProject()
  const projectDir = project ? join(project.path, '.claude', 'agents') : null
  // A project opened at the home folder would list the global agents twice.
  const same = projectDir !== null && normalizePath(projectDir) === normalizePath(global)
  return { project: same ? null : projectDir, global }
}

function folderFor(scope: AgentScope): string {
  const folder = folders()[scope]
  if (!folder) fail('no_project', 'No project is open.')
  return folder
}

function scopeLabel(scope: AgentScope): string {
  return scope === 'project' ? 'PROJECT' : 'GLOBAL'
}

function isInside(folder: string, path: string): boolean {
  const rel = relative(folder, path)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

async function realpathOrNull(path: string): Promise<string | null> {
  try {
    return await realpath(path)
  } catch {
    return null
  }
}

type AgentLocation = { path: string; scope: AgentScope }

async function locate(raw: unknown): Promise<AgentLocation> {
  if (typeof raw !== 'string' || raw === '') fail('outside_folder', 'Not an agent file.')
  const path = resolve(raw)
  if (extname(path).toLowerCase() !== '.md') fail('outside_folder', 'Not an agent file.')

  const current = folders()
  for (const scope of ['project', 'global'] as const) {
    const folder = current[scope]
    if (!folder || !isInside(folder, path)) continue
    const realFolder = await realpathOrNull(folder)
    const realFile = await realpathOrNull(path)
    if (!realFolder || !realFile) fail('not_found', 'This agent file no longer exists.')
    if (!isInside(realFolder, realFile)) fail('outside_folder', 'Not an agent file.')
    return { path, scope }
  }
  fail('outside_folder', 'This file is not in an agents folder.')
}

// All .md files under a folder, subfolders included. A missing folder is empty.
// Symbolic links are not followed.
async function scan(folder: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(folder, { withFileTypes: true })
  } catch (err) {
    const code = errorCode(err)
    if (code !== 'ENOENT' && code !== 'ENOTDIR') console.error('[agents] Cannot scan', folder, err)
    return []
  }
  const files: string[] = []
  for (const entry of entries) {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) files.push(...(await scan(path)))
    else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') files.push(path)
  }
  return files
}

type LoadedAgent = Omit<AgentSummary, 'icon' | 'role'>

function fromText(
  scope: AgentScope,
  filePath: string,
  text: string
): { agent: LoadedAgent; body: string } {
  const parsed = readAgentFile(text)
  const agent: LoadedAgent = {
    scope,
    filePath,
    name: parsed.name ?? basename(filePath, extname(filePath)),
    description: parsed.description ?? '',
    tools: parsed.tools,
    model: parsed.model,
    permissionMode: parsed.permissionMode,
    background: parsed.background,
    otherFields: parsed.otherFields,
    problem: parsed.problem
  }
  return { agent, body: parsed.body }
}

async function loadScope(scope: AgentScope, folder: string | null): Promise<LoadedAgent[]> {
  if (!folder) return []
  const agents: LoadedAgent[] = []
  for (const filePath of await scan(folder)) {
    try {
      agents.push(fromText(scope, filePath, await readFile(filePath, 'utf8')).agent)
    } catch {
      agents.push({ ...fromText(scope, filePath, '').agent, problem: 'The file cannot be read.' })
    }
  }
  return agents.sort((a, b) => a.name.localeCompare(b.name) || a.filePath.localeCompare(b.filePath))
}

export function listAgents(): Promise<
  AgentsResult<{ agents: AgentSummary[]; folders: AgentFolders }>
> {
  return run(async () => {
    const current = folders()
    const iconFor = await loadIcons()
    const roleFor = await loadRoles()
    const loaded = [
      ...(await loadScope('project', current.project)),
      ...(await loadScope('global', current.global))
    ]
    const agents: AgentSummary[] = []
    for (const agent of loaded) {
      agents.push({ ...agent, icon: await iconFor(agent.filePath), role: roleFor(agent.filePath) })
    }
    return { agents, folders: current }
  })
}

export function readAgent(rawPath: unknown): Promise<AgentsResult<{ agent: AgentDetail }>> {
  return run(async () => {
    const { path, scope } = await locate(rawPath)
    // Stat before reading: if the file changes in between, the later save sees a conflict.
    const info = await statOrNotFound(path)
    const text = await readFile(path, 'utf8')
    const iconFor = await loadIcons()
    const roleFor = await loadRoles()
    const { agent, body } = fromText(scope, path, text)
    const extras = { icon: await iconFor(path), role: roleFor(path) }
    return { agent: { ...agent, ...extras, body, modifiedTime: info.mtimeMs } }
  })
}

async function statOrNotFound(path: string): Promise<Stats> {
  try {
    return await stat(path)
  } catch (err) {
    if (errorCode(err) === 'ENOENT') fail('not_found', 'This agent file no longer exists.')
    throw err
  }
}

function invalid(message: string): never {
  fail('invalid', message)
}

function oneLine(value: unknown, field: string): string {
  if (typeof value !== 'string') invalid(`${field} must be text.`)
  return value
}

// The renderer checks these too; this is the check that counts.
function parseDraft(raw: unknown): AgentDraft {
  if (!raw || typeof raw !== 'object') invalid('The agent details are missing.')
  const draft = raw as Record<string, unknown>

  const scope = draft.scope
  if (scope !== 'project' && scope !== 'global') invalid('Choose PROJECT or GLOBAL.')

  const name = oneLine(draft.name, 'Name').trim()
  const nameError = agentNameError(name)
  if (nameError) invalid(nameError)

  const description = oneLine(draft.description, 'Description').replace(/\r\n/g, '\n').trim()
  const descriptionError = agentDescriptionError(description)
  if (descriptionError) invalid(descriptionError)

  const body = oneLine(draft.body, 'System prompt')

  let tools: string[] | null = null
  if (draft.tools !== null) {
    if (!Array.isArray(draft.tools)) invalid('Tools must be a list.')
    tools = draft.tools.map((tool) => oneLine(tool, 'Each tool').trim())
    if (tools.some((tool) => tool === '' || /[\r\n]/.test(tool))) {
      invalid('Each tool must be one line of text.')
    }
    const toolsError = agentToolsError(tools)
    if (toolsError) invalid(toolsError)
  }

  let model: string | null = null
  if (draft.model !== null) {
    model = oneLine(draft.model, 'Model').trim()
    if (model === '' || /[\r\n]/.test(model)) invalid('Model must be one line of text.')
  }

  let role: string | null = null
  if (draft.role !== null && draft.role !== undefined) {
    role = oneLine(draft.role, 'Role').trim()
    const roleError = agentRoleError(role)
    if (roleError) invalid(roleError)
    if (role === '') role = null
  }

  const icon = parseIconChange(draft.icon)
  return { scope, name, description, body, tools, model, icon, role }
}

function parseIconChange(raw: unknown): AgentIconChange {
  const change = (raw ?? {}) as Record<string, unknown>
  if (change.type === 'keep' || change.type === 'remove') return { type: change.type }
  if (change.type === 'token' && typeof change.token === 'string') {
    if (!hasPendingIcon(change.token)) invalid('Choose the icon again.')
    return { type: 'token', token: change.token }
  }
  invalid('The icon change is not valid.')
}

function editsOf(draft: AgentDraft): AgentEdits {
  const { name, description, body, tools, model } = draft
  return { name, description, body, tools, model }
}

// Two agents with one name in one folder: Claude Code would load only one of them.
async function assertNameFree(scope: AgentScope, name: string, except?: string): Promise<void> {
  const others = await loadScope(scope, folders()[scope])
  const clash = others.find(
    (agent) =>
      agent.problem === null &&
      agent.name === name &&
      (except === undefined || normalizePath(agent.filePath) !== normalizePath(except))
  )
  if (clash) fail('exists', `${scopeLabel(scope)} already has an agent named "${name}".`)
}

async function createFile(target: string, text: string, mode?: number): Promise<void> {
  try {
    await createFileSafely(target, text, mode)
  } catch (err) {
    if (errorCode(err) === 'EEXIST') {
      fail('exists', `A file named ${basename(target)} is already there.`)
    }
    throw err
  }
}

// Stores the picked icon first, so a failed icon never leaves a half-saved agent.
async function withIcon(
  change: AgentIconChange,
  fromPath: string | null,
  write: () => Promise<string>
): Promise<string> {
  const storedIcon = await storePickedIcon(change)
  let savedPath: string
  try {
    savedPath = await write()
  } catch (err) {
    await dropStoredIcon(storedIcon)
    throw err
  }
  await commitIconChange(fromPath, savedPath, change, storedIcon)
  return savedPath
}

export function createAgent(rawDraft: unknown): Promise<AgentsResult<{ filePath: string }>> {
  return run(async () => {
    const draft = parseDraft(rawDraft)
    const folder = folderFor(draft.scope)
    await assertNameFree(draft.scope, draft.name)
    const stem = safeFileStem(draft.name) || `agent-${randomBytes(3).toString('hex')}`
    const target = join(folder, `${stem}.md`)

    const filePath = await withIcon(draft.icon, null, async () => {
      await mkdir(folder, { recursive: true })
      await createFile(target, buildAgentFile(editsOf(draft)))
      return target
    })
    await saveRole(null, filePath, draft.role)
    return { filePath }
  })
}

export function updateAgent(
  rawPath: unknown,
  rawDraft: unknown,
  modifiedTime: unknown
): Promise<AgentsResult<{ filePath: string }>> {
  return run(async () => {
    const { path, scope } = await locate(rawPath)
    const draft = parseDraft(rawDraft)
    if (typeof modifiedTime !== 'number') invalid('The file version is missing.')

    // Read, then stat: a change after the read shows up as a newer time.
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch (err) {
      if (errorCode(err) === 'ENOENT') fail('not_found', 'This agent file no longer exists.')
      throw err
    }
    const info = await statOrNotFound(path)
    if (info.mtimeMs !== modifiedTime) fail('conflict', 'This file changed on disk.')

    const problem = readAgentFile(text).problem
    if (problem) invalid(`This file cannot be edited. ${problem}`)
    let nextText: string
    try {
      nextText = editAgentFile(text, editsOf(draft))
    } catch (err) {
      invalid(err instanceof Error ? err.message : 'This file cannot be edited safely.')
    }

    await assertNameFree(draft.scope, draft.name, path)
    const mode = info.mode & 0o777

    const filePath = await withIcon(draft.icon, path, async () => {
      if (draft.scope === scope) {
        if (nextText !== text) await writeFileSafely(path, nextText, mode)
        return path
      }
      // Moving to the other scope: same filename, at the top of the other folder.
      const folder = folderFor(draft.scope)
      const target = join(folder, basename(path))
      await mkdir(folder, { recursive: true })
      await createFile(target, nextText, mode)
      try {
        await unlink(path)
      } catch (err) {
        await unlink(target).catch(() => {})
        throw err
      }
      return target
    })
    await saveRole(path, filePath, draft.role)
    return { filePath }
  })
}

export function removeAgent(rawPath: unknown): Promise<AgentsResult> {
  return run(async () => {
    const { path } = await locate(rawPath)
    await shell.trashItem(path)
    await forgetIcon(path)
    await forgetRole(path)
    return {}
  })
}
