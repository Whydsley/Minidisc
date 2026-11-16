import { app, shell, BrowserWindow, desktopCapturer, ipcMain, session } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { startHost, stopHost } from './hostServer'

let selectedSourceId: string | null = null

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 640,
    minWidth: 720,
    minHeight: 480,
    frame: false,
    backgroundColor: '#1e1f22',
    show: false,
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.on('maximize', () => mainWindow.webContents.send('win:maximized', true))
    mainWindow.on('unmaximize', () => mainWindow.webContents.send('win:maximized', false))
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.whydsley.minidisc')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  const winOf = (e: Electron.IpcMainInvokeEvent): BrowserWindow | null => BrowserWindow.fromWebContents(e.sender)

  ipcMain.handle('host:start', () => startHost())
  ipcMain.handle('host:stop', () => stopHost())
  ipcMain.handle('win:minimize', (e) => winOf(e)?.minimize())
  ipcMain.handle('win:toggle-maximize', (e) => {
    const w = winOf(e)
    if (!w) return
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
  })
  ipcMain.handle('win:close', (e) => winOf(e)?.close())

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  ipcMain.handle('screen:sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: false
  })
  return sources.map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }))
})

ipcMain.handle('screen:select', (_event, id: unknown) => {
  selectedSourceId = typeof id === 'string' ? id : null
})

session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
  desktopCapturer
    .getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })
    .then((sources) => {
      const source = sources.find((s) => s.id === selectedSourceId)
      selectedSourceId = null
      if (source) callback({ video: source })
      else callback({})
    })
})
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  stopHost()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
