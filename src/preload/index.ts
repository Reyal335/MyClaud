import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IpcChannel, type AgentEvent, type MyClaudApi } from '../shared/ipc'

// The only API the renderer gets. ipcRenderer itself is never exposed.
const api: MyClaudApi = {
  project: {
    get: () => ipcRenderer.invoke(IpcChannel.ProjectGet),
    open: () => ipcRenderer.invoke(IpcChannel.ProjectOpen)
  },
  agent: {
    send: (prompt) => ipcRenderer.invoke(IpcChannel.AgentSend, prompt),
    stop: () => ipcRenderer.invoke(IpcChannel.AgentStop),
    answerPermission: (permissionId, decision) =>
      ipcRenderer.invoke(IpcChannel.AgentPermission, permissionId, decision),
    onEvent: (callback) => {
      const listener = (_event: IpcRendererEvent, agentEvent: AgentEvent): void =>
        callback(agentEvent)
      ipcRenderer.on(IpcChannel.AgentEvent, listener)
      return () => {
        ipcRenderer.removeListener(IpcChannel.AgentEvent, listener)
      }
    }
  },
  agents: {
    list: () => ipcRenderer.invoke(IpcChannel.AgentsList),
    read: (filePath) => ipcRenderer.invoke(IpcChannel.AgentsRead, filePath),
    create: (draft) => ipcRenderer.invoke(IpcChannel.AgentsCreate, draft),
    update: (filePath, draft, modifiedTime) =>
      ipcRenderer.invoke(IpcChannel.AgentsUpdate, filePath, draft, modifiedTime),
    remove: (filePath) => ipcRenderer.invoke(IpcChannel.AgentsRemove, filePath),
    pickIcon: () => ipcRenderer.invoke(IpcChannel.AgentsPickIcon),
    discardIcon: (token) => ipcRenderer.invoke(IpcChannel.AgentsDiscardIcon, token)
  }
}

contextBridge.exposeInMainWorld('myclaud', api)
