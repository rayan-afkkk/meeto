// Meeto desktop app: wraps the web app and adds a native "what do you want to share?" picker.
const { app, BrowserWindow, desktopCapturer, ipcMain, session, shell } = require('electron')
const path = require('path')

let win

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 420,
    minHeight: 600,
    backgroundColor: '#000000',
    title: 'Meeto',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // keep calls smooth when the window is in the background
    },
  })
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))

  // open external links (GitHub, downloads) in the real browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault()
      shell.openExternal(url)
    }
  })
}

app.whenReady().then(() => {
  // camera / mic / screen permissions for our own page
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(['media', 'display-capture', 'clipboard-sanitized-write', 'notifications', 'fullscreen'].includes(permission))
  })

  // getDisplayMedia(): ask the page to show its picker, then hand back the chosen source
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 480, height: 300 } })
      const list = sources.map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }))
      win.webContents.send('meeto:pick-source', list)
      ipcMain.once('meeto:picked-source', (_e, id) => {
        const chosen = sources.find((s) => s.id === id)
        if (!chosen) return callback({})
        callback({ video: chosen, audio: process.platform === 'win32' ? 'loopback' : undefined })
      })
    } catch {
      callback({})
    }
  })

  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
