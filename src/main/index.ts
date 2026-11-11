import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { stopRun } from './agent'
import { registerIpc } from './ipc'
import { loadProject } from './settings'

// Matches --bg in the renderer tokens, so the window never flashes white on load.
const WINDOW_BACKGROUND = '#0B132B'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'MyClaud',
    backgroundColor: WINDOW_BACKGROUND,
    show: false,
    ...(process.platform === 'linux' ? { icon } : {}),
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

  // A run belongs to this window. Stop it when the window goes away.
  mainWindow.on('closed', () => {
    stopRun()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Load the dev server URL in development, the built file in production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron.app')

  // F12 toggles DevTools in development; Ctrl/Cmd+R is ignored in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  await loadProject()
  registerIpc()
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  stopRun()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
