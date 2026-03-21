const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL)

const defaultSettings = () => ({
  downloadDirectory: app.getPath('downloads'),
  maxConcurrentDownloads: 3,
  preferredResolution: '720p',
  updatedAt: new Date().toISOString(),
})

const getSettingsPath = () => path.join(app.getPath('userData'), 'settings.json')

const ensureSettings = async () => {
  const filePath = getSettingsPath()

  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    return { ...defaultSettings(), ...parsed }
  } catch {
    const next = defaultSettings()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(next, null, 2), 'utf8')
    return next
  }
}

const writeSettings = async (patch) => {
  const next = {
    ...(await ensureSettings()),
    ...patch,
    updatedAt: new Date().toISOString(),
  }

  await fs.writeFile(getSettingsPath(), JSON.stringify(next, null, 2), 'utf8')
  return next
}

const createWindow = async () => {
  const win = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 1260,
    minHeight: 760,
    backgroundColor: '#020617',
    autoHideMenuBar: true,
    title: 'HongGuo Tool Framework',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (isDev) {
    await win.loadURL(process.env.VITE_DEV_SERVER_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

ipcMain.handle('desktop:get-context', async () => ({
  isElectron: true,
  platform: process.platform,
  version: app.getVersion(),
  userDataPath: app.getPath('userData'),
}))

ipcMain.handle('settings:read', async () => ensureSettings())

ipcMain.handle('settings:update', async (_event, patch) => writeSettings(patch))

ipcMain.handle('dialog:choose-directory', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择下载目录',
    properties: ['openDirectory', 'createDirectory'],
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  const [selectedPath] = result.filePaths
  await writeSettings({ downloadDirectory: selectedPath })
  return selectedPath
})

ipcMain.handle('shell:open-path', async (_event, targetPath) => {
  if (!targetPath) {
    return 'missing-path'
  }

  return shell.openPath(targetPath)
})

app.whenReady().then(async () => {
  await ensureSettings()
  await createWindow()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
