import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { appIcon, windowIconOptions } from './appIcon'
import { stopRun } from './agent'
import { closePopups, setupPopups } from './popupWindow'
import { registerIpc } from './ipc'
import { prefetchModels } from './models'
import { getProject, loadProject } from './settings'
import { loadTasks } from './tasks'

// Matches --bg in the renderer tokens, so the window never flashes white on load.
const WINDOW_BACKGROUND = '#0B132B'

function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'MyClaud',
    backgroundColor: WINDOW_BACKGROUND,
    show: false,
    ...windowIconOptions,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // Hide the default menu bar on Windows and Linux. macOS keeps its app menu.
  if (process.platform !== 'darwin') {
    mainWindow.setMenuBarVisibility(false)
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // A run belongs to this window. Stop it when the window goes away. The popup
  // goes with it, so a hidden popup never keeps the app running.
  mainWindow.on('closed', () => {
    closePopups()
    stopRun()
  })

  // Links never open inside the app. An http or https link opens in the system
  // browser; any other kind is dropped.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isWebUrl(details.url)) shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Nothing may navigate the app window away from the app. A reload of the same
  // page (development) is allowed.
  mainWindow.webContents.on('will-navigate', (event) => {
    if (event.url === mainWindow.webContents.getURL()) return
    event.preventDefault()
    if (isWebUrl(event.url)) shell.openExternal(event.url)
  })

  // Load the dev server URL in development, the built file in production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return mainWindow
}

app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron.app')

  // A packaged macOS app gets its icon from the bundle; in development the dock
  // would otherwise show the default Electron icon.
  if (is.dev && process.platform === 'darwin') {
    app.dock?.setIcon(appIcon)
  }

  // F12 toggles DevTools in development; Ctrl/Cmd+R is ignored in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  await loadProject()
  // Start loading the model list for the open project now, so it is ready when the
  // picker opens. It runs on its own: nothing waits for it.
  prefetchModels(getProject()?.path ?? null)
  // Tasks cut off when the app last closed become stopped before anything reads them.
  await loadTasks()
  registerIpc()
  setupPopups(createWindow())

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) setupPopups(createWindow())
  })
})

app.on('before-quit', () => {
  closePopups()
  stopRun()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
