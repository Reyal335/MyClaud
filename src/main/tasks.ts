import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import {
  IpcChannel,
  type AgentScope,
  type TaskActivity,
  type TaskAgent,
  type TaskDetail,
  type TaskEndStatus,
  type TaskStatus,
  type TasksResult,
  type TaskSummary,
  type ToolState
} from '../shared/ipc'
import { labelText } from '../shared/toolLabel'
import { loadIcons } from './agentIcons'
import { loadRoles } from './agentRoles'
import { isObject, readJsonFile, serialQueue, writeJsonFile } from './jsonFile'

// Tasks: one Agent tool call each, kept in userData/tasks.json as
// { version: 1, tasks }. Main is the one source: the inbox lists what is here, and
// tasks:changed tells every window when something changed.

const VERSION = 1
const MAX_TEXT = 20_000
const MAX_ACTIVITY = 100
const MAX_PER_PROJECT = 200
const PREVIEW_LENGTH = 80
const NOTIFY_MS = 100
export const INTERRUPTED_REPORT = 'Interrupted when MyClaud closed.'

type StoredAgent = { name: string; scope: AgentScope | null; filePath: string | null }

type TaskRecord = {
  id: string
  projectPath: string
  sessionId: string | null
  agent: StoredAgent
  description: string
  prompt: string
  promptTruncated: boolean
  status: TaskStatus
  report: string | null
  reportTruncated: boolean
  activity: TaskActivity[]
  startedAt: number
  endedAt: number | null
  seen: boolean
}

let tasks: TaskRecord[] | null = null
// Pending permission requests per task, in memory only: tool id and its label.
const pending = new Map<string, Map<string, string>>()
const queue = serialQueue()

function tasksPath(): string {
  return join(app.getPath('userData'), 'tasks.json')
}

function cut(text: string): { text: string; truncated: boolean } {
  return text.length > MAX_TEXT
    ? { text: text.slice(0, MAX_TEXT), truncated: true }
    : { text, truncated: false }
}

const STATUSES: TaskStatus[] = ['running', 'waiting', 'done', 'error', 'stopped']
const TOOL_STATES: ToolState[] = ['running', 'waiting', 'done', 'failed', 'denied', 'stopped']

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readActivity(raw: unknown): TaskActivity[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry) => {
    if (!isObject(entry)) return []
    const { toolId, verb, target, state } = entry
    if (typeof toolId !== 'string' || typeof verb !== 'string') return []
    if (!TOOL_STATES.includes(state as ToolState)) return []
    return [{ toolId, verb, target: str(target), state: state as ToolState }]
  })
}

function readRecord(raw: unknown): TaskRecord | null {
  if (!isObject(raw) || !isObject(raw.agent)) return null
  const { id, projectPath, description, prompt, status, startedAt } = raw
  const name = str(raw.agent.name)
  if (
    typeof id !== 'string' ||
    typeof projectPath !== 'string' ||
    name === null ||
    typeof startedAt !== 'number' ||
    !STATUSES.includes(status as TaskStatus)
  ) {
    return null
  }
  const scope =
    raw.agent.scope === 'project' || raw.agent.scope === 'global' ? raw.agent.scope : null
  return {
    id,
    projectPath,
    sessionId: str(raw.sessionId),
    agent: { name, scope, filePath: str(raw.agent.filePath) },
    description: str(description) ?? '',
    prompt: str(prompt) ?? '',
    promptTruncated: raw.promptTruncated === true,
    status: status as TaskStatus,
    report: str(raw.report),
    reportTruncated: raw.reportTruncated === true,
    activity: readActivity(raw.activity),
    startedAt,
    endedAt: typeof raw.endedAt === 'number' ? raw.endedAt : null,
    seen: raw.seen === true
  }
}

function save(): Promise<void> {
  const snapshot = { version: VERSION, tasks: tasks ?? [] }
  return queue(async () => {
    try {
      await writeJsonFile(tasksPath(), snapshot)
    } catch (err) {
      console.error('[tasks] Could not save tasks.json:', err)
    }
  })
}

// Loads tasks.json once. A task saved as running or waiting was cut off when the
// app closed: it becomes stopped.
async function load(): Promise<TaskRecord[]> {
  if (tasks) return tasks
  let loaded: TaskRecord[] = []
  try {
    const raw = await readJsonFile(tasksPath())
    if (isObject(raw) && raw.version === VERSION && Array.isArray(raw.tasks)) {
      loaded = raw.tasks.flatMap((entry) => {
        const record = readRecord(entry)
        return record ? [record] : []
      })
    }
  } catch (err) {
    console.error('[tasks] Could not read tasks.json:', err)
  }
  if (tasks) return tasks
  let changed = false
  for (const task of loaded) {
    if (task.status === 'running' || task.status === 'waiting') {
      task.status = 'stopped'
      task.report = INTERRUPTED_REPORT
      task.reportTruncated = false
      task.endedAt ??= task.startedAt
      task.activity = task.activity.map((entry) =>
        entry.state === 'running' || entry.state === 'waiting'
          ? { ...entry, state: 'stopped' }
          : entry
      )
      changed = true
    }
  }
  tasks = loaded
  if (changed) await save()
  return tasks
}

// Called once at startup, so interrupted tasks are fixed before anything reads them.
export function loadTasks(): Promise<void> {
  return load().then(() => undefined)
}

let notifyTimer: ReturnType<typeof setTimeout> | null = null

function notify(): void {
  if (notifyTimer) return
  notifyTimer = setTimeout(() => {
    notifyTimer = null
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IpcChannel.TasksChanged)
    }
  }, NOTIFY_MS)
}

function find(id: string): TaskRecord | undefined {
  return tasks?.find((task) => task.id === id)
}

function oneLine(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > PREVIEW_LENGTH ? `${line.slice(0, PREVIEW_LENGTH - 3)}...` : line
}

function preview(task: TaskRecord): string {
  const waiting = pending.get(task.id)
  if (task.status === 'waiting' && waiting && waiting.size > 0) {
    return oneLine(`Waiting: ${[...waiting.values()][0]}`)
  }
  if (task.status === 'running') {
    const latest = task.activity[task.activity.length - 1]
    return latest ? oneLine(labelText(latest)) : 'Starting...'
  }
  return oneLine(task.report ?? '')
}

type Look = (agent: StoredAgent) => Promise<TaskAgent>

// Icons and roles live in userData maps keyed by the agent file path.
async function agentLook(): Promise<Look> {
  const iconFor = await loadIcons()
  const roleFor = await loadRoles()
  return async (agent) => ({
    ...agent,
    icon: agent.filePath ? await iconFor(agent.filePath) : null,
    role: agent.filePath ? roleFor(agent.filePath) : null
  })
}

async function summary(task: TaskRecord, look: Look): Promise<TaskSummary> {
  return {
    id: task.id,
    agent: await look(task.agent),
    description: task.description,
    status: task.status,
    preview: preview(task),
    startedAt: task.startedAt,
    endedAt: task.endedAt,
    seen: task.seen
  }
}

// --- Changes from the agent run -------------------------------------------

export type NewTask = {
  id: string
  projectPath: string
  sessionId: string | null
  agent: StoredAgent
  description: string
  prompt: string
}

export async function startTask(input: NewTask): Promise<void> {
  const list = await load()
  if (find(input.id)) return
  const prompt = cut(input.prompt)
  list.push({
    ...input,
    prompt: prompt.text,
    promptTruncated: prompt.truncated,
    status: 'running',
    report: null,
    reportTruncated: false,
    activity: [],
    startedAt: Date.now(),
    endedAt: null,
    seen: false
  })
  // Keep the newest tasks of each project. Running or waiting ones always stay.
  const mine = list
    .filter((task) => task.projectPath === input.projectPath)
    .sort((a, b) => b.startedAt - a.startedAt)
  const drop = new Set(
    mine
      .slice(MAX_PER_PROJECT)
      .filter((task) => task.status !== 'running' && task.status !== 'waiting')
      .map((task) => task.id)
  )
  if (drop.size > 0) tasks = list.filter((task) => !drop.has(task.id))
  await save()
  notify()
}

// Adds or updates one tool call in the task's activity. Not saved until the task ends.
export function taskActivity(
  taskId: string,
  toolId: string,
  label: { verb: string; target: string | null } | null,
  state: ToolState
): void {
  const task = find(taskId)
  if (!task) return
  const index = task.activity.findIndex((entry) => entry.toolId === toolId)
  if (index >= 0) {
    const entry = task.activity[index]
    task.activity[index] = { ...entry, ...(label ?? {}), state }
  } else {
    task.activity.push({ toolId, verb: label?.verb ?? '...', target: label?.target ?? null, state })
    if (task.activity.length > MAX_ACTIVITY)
      task.activity.splice(0, task.activity.length - MAX_ACTIVITY)
  }
  notify()
}

function refreshWaiting(task: TaskRecord): void {
  if (task.status !== 'running' && task.status !== 'waiting') return
  task.status = (pending.get(task.id)?.size ?? 0) > 0 ? 'waiting' : 'running'
}

// A permission request from inside the task, waiting for my answer.
export function taskRequestOpened(taskId: string, toolId: string, label: string): void {
  const task = find(taskId)
  if (!task) return
  const waiting = pending.get(taskId) ?? new Map<string, string>()
  waiting.set(toolId, label)
  pending.set(taskId, waiting)
  refreshWaiting(task)
  notify()
}

export function taskRequestClosed(taskId: string, toolId: string): void {
  const task = find(taskId)
  pending.get(taskId)?.delete(toolId)
  if (!task) return
  refreshWaiting(task)
  notify()
}

export async function endTask(
  taskId: string,
  status: TaskEndStatus,
  report: string | null
): Promise<void> {
  const task = find(taskId)
  if (!task) return
  pending.delete(taskId)
  const text = report === null ? null : cut(report)
  task.status = status
  task.report = text?.text ?? task.report
  task.reportTruncated = text?.truncated ?? task.reportTruncated
  task.endedAt = Date.now()
  task.activity = task.activity.map((entry) =>
    entry.state === 'running' || entry.state === 'waiting' ? { ...entry, state: 'stopped' } : entry
  )
  await save()
  notify()
}

export function isOpenTask(taskId: string): boolean {
  const status = find(taskId)?.status
  return status === 'running' || status === 'waiting'
}

// A saved task, for history loading: its agent, label, status, and report.
export async function savedTasks(
  ids: string[]
): Promise<Map<string, TaskSummary & { report: string | null }>> {
  await load()
  const look = await agentLook()
  const found = new Map<string, TaskSummary & { report: string | null }>()
  for (const id of ids) {
    const task = find(id)
    if (task) found.set(id, { ...(await summary(task, look)), report: task.report })
  }
  return found
}

// --- The inbox -----------------------------------------------------------

function knownId(raw: unknown): TaskRecord {
  const task = typeof raw === 'string' ? find(raw) : undefined
  if (!task) throw new TaskFailure('not_found', 'This task no longer exists.')
  return task
}

class TaskFailure extends Error {
  constructor(
    readonly code: 'not_found' | 'invalid',
    message: string
  ) {
    super(message)
  }
}

async function guarded<T extends object>(work: () => Promise<T>): Promise<TasksResult<T>> {
  try {
    await load()
    return { ok: true, ...(await work()) }
  } catch (err) {
    if (err instanceof TaskFailure)
      return { ok: false, error: { code: err.code, message: err.message } }
    console.error('[tasks]', err)
    return { ok: false, error: { code: 'io_error', message: 'The tasks could not be read.' } }
  }
}

export function listTasks(
  projectPath: string | null
): Promise<TasksResult<{ tasks: TaskSummary[] }>> {
  return guarded(async () => {
    if (!projectPath) return { tasks: [] }
    const look = await agentLook()
    const mine = (tasks ?? [])
      .filter((task) => task.projectPath === projectPath)
      .sort((a, b) => b.startedAt - a.startedAt)
    const list: TaskSummary[] = []
    for (const task of mine) list.push(await summary(task, look))
    return { tasks: list }
  })
}

export function getTask(
  rawId: unknown,
  projectPath: string | null
): Promise<TasksResult<{ task: TaskDetail }>> {
  return guarded(async () => {
    const task = knownId(rawId)
    if (task.projectPath !== projectPath)
      throw new TaskFailure('not_found', 'This task is not in the open project.')
    const look = await agentLook()
    return {
      task: {
        ...(await summary(task, look)),
        prompt: task.prompt,
        promptTruncated: task.promptTruncated,
        report: task.report,
        reportTruncated: task.reportTruncated,
        activity: task.activity.map((entry) => ({ ...entry }))
      }
    }
  })
}

export function markTaskSeen(rawId: unknown): Promise<TasksResult> {
  return guarded(async () => {
    const task = knownId(rawId)
    if (!task.seen) {
      task.seen = true
      await save()
      notify()
    }
    return {}
  })
}

export function removeTask(rawId: unknown): Promise<TasksResult> {
  return guarded(async () => {
    const task = knownId(rawId)
    if (task.status === 'running' || task.status === 'waiting') {
      throw new TaskFailure('invalid', 'A running or waiting task cannot be deleted.')
    }
    tasks = (tasks ?? []).filter((entry) => entry.id !== task.id)
    await save()
    notify()
    return {}
  })
}

export function clearFinishedTasks(projectPath: string | null): Promise<TasksResult> {
  return guarded(async () => {
    if (!projectPath) return {}
    const before = tasks?.length ?? 0
    tasks = (tasks ?? []).filter(
      (task) =>
        task.projectPath !== projectPath || task.status === 'running' || task.status === 'waiting'
    )
    if (tasks.length !== before) {
      await save()
      notify()
    }
    return {}
  })
}
