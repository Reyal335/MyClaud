import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IpcChannel, type AgentSendResult, type ChatHistory, type ProjectInfo } from '../shared/ipc'
import { answerPermission, isRunning, loadChatHistory, resetChat, startRun, stopRun } from './agent'
import { getPartyPanel, getProject, setPartyPanel, setProject } from './settings'
import { clearFinishedTasks, getTask, listTasks, markTaskSeen, removeTask } from './tasks'
import { createAgent, listAgents, readAgent, removeAgent, updateAgent } from './agents'
import { discardIcon, pickIcon } from './agentIcons'
import {
  createMascot,
  discardSheet,
  dropSources,
  getActiveMascot,
  listMascots,
  pickSheet,
  removeMascot,
  resetDefaultMascot,
  setActiveMascot,
  sliceSheet,
  updateMascot
} from './mascots'

export function registerIpc(): void {
  ipcMain.handle(IpcChannel.ProjectGet, (): ProjectInfo | null => getProject())

  ipcMain.handle(IpcChannel.ProjectOpen, async (event): Promise<ProjectInfo | null> => {
    // The run belongs to the open project; it cannot change under it.
    if (isRunning()) return null

    const window = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Open project',
      properties: ['openDirectory']
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0 || isRunning()) return null

    return setProject(result.filePaths[0])
  })

  // `call` is { scope, filePath } of an agent from the list; agent.ts checks it again.
  ipcMain.handle(
    IpcChannel.AgentSend,
    async (event, prompt: unknown, call: unknown): Promise<AgentSendResult> => {
      if (typeof prompt !== 'string' || prompt.trim() === '') {
        return {
          ok: false,
          error: { code: 'invalid_prompt', message: 'The prompt must be non-empty text.' }
        }
      }
      const project = getProject()
      if (!project) {
        return { ok: false, error: { code: 'no_project', message: 'No project is open.' } }
      }
      return startRun(prompt, call, project.path, event.sender)
    }
  )

  ipcMain.handle(IpcChannel.AgentStop, (): void => {
    stopRun()
  })

  ipcMain.handle(
    IpcChannel.AgentPermission,
    (_event, permissionId: unknown, decision: unknown): { ok: boolean } => {
      if (typeof permissionId !== 'string' || (decision !== 'approve' && decision !== 'deny')) {
        return { ok: false }
      }
      return { ok: answerPermission(permissionId, decision) }
    }
  )

  // Agent files. Every handler validates its arguments again in agents.ts.
  ipcMain.handle(IpcChannel.AgentsList, () => listAgents())
  ipcMain.handle(IpcChannel.AgentsRead, (_event, filePath: unknown) => readAgent(filePath))
  ipcMain.handle(IpcChannel.AgentsCreate, (_event, draft: unknown) => createAgent(draft))
  ipcMain.handle(
    IpcChannel.AgentsUpdate,
    (_event, filePath: unknown, draft: unknown, modifiedTime: unknown) =>
      updateAgent(filePath, draft, modifiedTime)
  )
  ipcMain.handle(IpcChannel.AgentsRemove, (_event, filePath: unknown) => removeAgent(filePath))
  // The renderer never sends an icon path: main opens the picker itself.
  ipcMain.handle(IpcChannel.AgentsPickIcon, (event) =>
    pickIcon(BrowserWindow.fromWebContents(event.sender))
  )
  ipcMain.handle(IpcChannel.AgentsDiscardIcon, (_event, token: unknown) => {
    if (typeof token === 'string') discardIcon(token)
  })

  // Mascots. The renderer names a mascot by id only; mascots.ts checks every argument again.
  ipcMain.handle(IpcChannel.MascotsList, () => listMascots())
  ipcMain.handle(IpcChannel.MascotsGetActive, () => getActiveMascot())
  ipcMain.handle(IpcChannel.MascotsPickSheet, (event) =>
    pickSheet(BrowserWindow.fromWebContents(event.sender))
  )
  ipcMain.handle(IpcChannel.MascotsDiscardSheet, (_event, token: unknown) => {
    if (typeof token === 'string') discardSheet(token)
  })
  // The renderer sends a source token and numbers only; mascots.ts checks the slice again.
  ipcMain.handle(
    IpcChannel.MascotsSliceSheet,
    (_event, sourceToken: unknown, columns: unknown, rows: unknown, cells: unknown) =>
      sliceSheet(sourceToken, columns, rows, cells)
  )
  ipcMain.handle(IpcChannel.MascotsDropSources, () => dropSources())
  ipcMain.handle(IpcChannel.MascotsCreate, (_event, draft: unknown) => createMascot(draft))
  ipcMain.handle(IpcChannel.MascotsUpdate, (_event, id: unknown, draft: unknown) =>
    updateMascot(id, draft)
  )
  ipcMain.handle(IpcChannel.MascotsRemove, (_event, id: unknown) => removeMascot(id))
  ipcMain.handle(IpcChannel.MascotsResetDefault, () => resetDefaultMascot())
  ipcMain.handle(IpcChannel.MascotsSetActive, (_event, id: unknown) => setActiveMascot(id))

  // The open project's main conversation.
  ipcMain.handle(IpcChannel.ChatHistory, async (): Promise<ChatHistory> => {
    const project = getProject()
    return project
      ? loadChatHistory(project.path)
      : { items: [], truncated: false, unavailable: false }
  })
  ipcMain.handle(IpcChannel.ChatReset, async () => {
    const project = getProject()
    if (!project) {
      return { ok: false, error: { code: 'no_project', message: 'No project is open.' } }
    }
    return resetChat(project.path)
  })

  // Tasks. The renderer names a task by id only; tasks.ts checks it is one it knows.
  ipcMain.handle(IpcChannel.TasksList, () => listTasks(getProject()?.path ?? null))
  ipcMain.handle(IpcChannel.TasksGet, (_event, id: unknown) =>
    getTask(id, getProject()?.path ?? null)
  )
  ipcMain.handle(IpcChannel.TasksMarkSeen, (_event, id: unknown) => markTaskSeen(id))
  ipcMain.handle(IpcChannel.TasksRemove, (_event, id: unknown) => removeTask(id))
  ipcMain.handle(IpcChannel.TasksClearFinished, () =>
    clearFinishedTasks(getProject()?.path ?? null)
  )

  // The party panel's open or rail choice, kept in settings.json.
  ipcMain.handle(IpcChannel.UiGetPartyPanel, () => getPartyPanel())
  ipcMain.handle(IpcChannel.UiSetPartyPanel, async (_event, mode: unknown) => {
    if (mode !== 'open' && mode !== 'rail') return { ok: false }
    try {
      await setPartyPanel(mode)
      return { ok: true }
    } catch (err) {
      console.error('Could not save settings:', err instanceof Error ? err.message : err)
      return { ok: false }
    }
  })
}
