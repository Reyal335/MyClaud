import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IpcChannel, type AgentSendResult, type ProjectInfo } from '../shared/ipc'
import { clearSession, isRunning, startRun, stopRun } from './agent'
import { getProject, setProject } from './settings'

export function registerIpc(): void {
  ipcMain.handle(IpcChannel.ProjectGet, (): ProjectInfo | null => getProject())

  ipcMain.handle(IpcChannel.ProjectOpen, async (event): Promise<ProjectInfo | null> => {
    // Switching projects mid-run would clear the session under the run.
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

    const path = result.filePaths[0]
    if (path !== getProject()?.path) {
      clearSession()
    }
    return setProject(path)
  })

  ipcMain.handle(IpcChannel.AgentSend, (event, prompt: unknown): AgentSendResult => {
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
    return startRun(prompt, project.path, event.sender)
  })

  ipcMain.handle(IpcChannel.AgentStop, (): void => {
    stopRun()
  })
}
