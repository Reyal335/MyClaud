import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IpcChannel, type MyClaudPopupApi, type PopupView } from '../shared/ipc'

// The popup window's only API: what to show, the buttons, hover, and the active
// mascot. It does not get the main window's API, and ipcRenderer is never exposed.
const api: MyClaudPopupApi = {
  getState: () => ipcRenderer.invoke(IpcChannel.PopupGetState),
  onState: (callback) => {
    const listener = (_event: IpcRendererEvent, view: PopupView | null): void => callback(view)
    ipcRenderer.on(IpcChannel.PopupState, listener)
    return () => {
      ipcRenderer.removeListener(IpcChannel.PopupState, listener)
    }
  },
  act: (id, action) => ipcRenderer.invoke(IpcChannel.PopupAct, id, action),
  hover: (isOver) => ipcRenderer.send(IpcChannel.PopupHover, isOver),
  mascot: {
    getActive: () => ipcRenderer.invoke(IpcChannel.PopupGetMascot),
    onChanged: (callback) => {
      const listener = (): void => callback()
      ipcRenderer.on(IpcChannel.MascotsChanged, listener)
      return () => {
        ipcRenderer.removeListener(IpcChannel.MascotsChanged, listener)
      }
    }
  }
}

contextBridge.exposeInMainWorld('myclaudPopup', api)
