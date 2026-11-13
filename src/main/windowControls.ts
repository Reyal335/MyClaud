import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IpcChannel, type WindowPlatform, type WindowState } from '../shared/ipc'

// The main window's buttons for the custom title bar. Windows and Linux draw their own
// minimize, maximize, and close; macOS keeps Apple's. Every command acts on the window
// that sent it, never on another, and the window's state is sent back whenever it
// changes so the bar can redraw.

// A double-click on the bar that arrives this soon after the window changed size is
// the system's own double-click-to-maximize, already done. Doing it again would undo it.
const DOUBLE_CLICK_GUARD_MS = 400

const changedAt = new WeakMap<BrowserWindow, number>()

export function windowPlatform(): WindowPlatform {
  if (process.platform === 'win32') return 'win32'
  if (process.platform === 'darwin') return 'darwin'
  return 'linux'
}

export function windowState(win: BrowserWindow): WindowState {
  return {
    maximized: win.isMaximized() || win.isFullScreen(),
    focused: win.isFocused(),
    platform: windowPlatform()
  }
}

// The window the command came from, or null when it is gone.
function senderWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  const win = BrowserWindow.fromWebContents(event.sender)
  return win && !win.isDestroyed() ? win : null
}

export function registerWindowIpc(): void {
  ipcMain.handle(IpcChannel.WindowMinimize, (event): void => {
    senderWindow(event)?.minimize()
  })

  ipcMain.handle(IpcChannel.WindowToggleMaximize, (event, source: unknown): void => {
    const win = senderWindow(event)
    if (!win) return
    if (source === 'doubleClick') {
      const last = changedAt.get(win)
      if (last !== undefined && Date.now() - last < DOUBLE_CLICK_GUARD_MS) return
    }
    if (win.isFullScreen()) win.setFullScreen(false)
    else if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  // win.close(), so whatever the app does when the window closes still happens.
  ipcMain.handle(IpcChannel.WindowClose, (event): void => {
    senderWindow(event)?.close()
  })

  ipcMain.handle(IpcChannel.WindowGetState, (event): WindowState | null => {
    const win = senderWindow(event)
    return win ? windowState(win) : null
  })
}

// Tells the window's page about every change to its state.
export function watchWindow(win: BrowserWindow): void {
  const send = (): void => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return
    win.webContents.send(IpcChannel.WindowState, windowState(win))
  }
  const resized = (): void => {
    changedAt.set(win, Date.now())
    send()
  }
  win.on('maximize', resized)
  win.on('unmaximize', resized)
  win.on('enter-full-screen', resized)
  win.on('leave-full-screen', resized)
  win.on('focus', send)
  win.on('blur', send)
}
