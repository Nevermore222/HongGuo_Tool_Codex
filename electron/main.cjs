const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const http = require('node:http')
const https = require('node:https')
const path = require('node:path')
const { pipeline } = require('node:stream/promises')
const { fileURLToPath, URL } = require('node:url')

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL)
const downloadTasks = new Map()
const activeDownloads = new Map()
let schedulerActive = false
let scheduleAgain = false
let lastRecoverySummary = null
let persistTasksTimer = null

const defaultSettings = () => ({
  downloadDirectory: app.getPath('downloads'),
  maxConcurrentDownloads: 3,
  preferredResolution: '720p',
  updatedAt: new Date().toISOString(),
})

const getSettingsPath = () => path.join(app.getPath('userData'), 'settings.json')
const getTasksPath = () => path.join(app.getPath('userData'), 'download-tasks.json')

const ensureSettings = async () => {
  const filePath = getSettingsPath()

  try {
    const raw = await fsp.readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    return { ...defaultSettings(), ...parsed }
  } catch {
    const next = defaultSettings()
    await fsp.mkdir(path.dirname(filePath), { recursive: true })
    await fsp.writeFile(filePath, JSON.stringify(next, null, 2), 'utf8')
    return next
  }
}

const writeSettings = async (patch) => {
  const next = {
    ...(await ensureSettings()),
    ...patch,
    updatedAt: new Date().toISOString(),
  }

  await fsp.writeFile(getSettingsPath(), JSON.stringify(next, null, 2), 'utf8')
  return next
}

const persistDownloadTasks = async () => {
  const payload = Array.from(downloadTasks.values()).map((task) => ({
    id: task.id,
    adapterId: task.adapterId,
    seriesId: task.seriesId,
    seriesTitle: task.seriesTitle,
    episodeId: task.episodeId,
    episodeTitle: task.episodeTitle,
    resolution: task.resolution,
    sourceUrl: task.sourceUrl,
    fileName: task.fileName,
    outputPath: task.outputPath,
    progress: task.progress,
    transferredBytes: task.transferredBytes,
    totalBytes: task.totalBytes,
    status: task.status,
    errorMessage: task.errorMessage,
    createdAt: task.createdAt,
  }))

  await fsp.mkdir(path.dirname(getTasksPath()), { recursive: true })
  await fsp.writeFile(getTasksPath(), JSON.stringify(payload, null, 2), 'utf8')
}

const schedulePersistDownloadTasks = () => {
  if (persistTasksTimer) {
    clearTimeout(persistTasksTimer)
  }

  persistTasksTimer = setTimeout(() => {
    persistTasksTimer = null
    void persistDownloadTasks()
  }, 180)
}

const fileExists = async (targetPath) => {
  if (!targetPath) {
    return false
  }

  try {
    await fsp.access(targetPath)
    return true
  } catch {
    return false
  }
}

const restoreDownloadTasks = async () => {
  const summary = {
    restored: 0,
    resumedAsWaiting: 0,
    missingCompletedFiles: 0,
  }

  try {
    const raw = await fsp.readFile(getTasksPath(), 'utf8')
    const parsed = JSON.parse(raw)

    if (!Array.isArray(parsed)) {
      lastRecoverySummary = summary
      return
    }

    for (const item of parsed) {
      const task = {
        id: item.id,
        adapterId: item.adapterId,
        seriesId: item.seriesId,
        seriesTitle: item.seriesTitle,
        episodeId: item.episodeId,
        episodeTitle: item.episodeTitle,
        resolution: item.resolution,
        sourceUrl: item.sourceUrl,
        fileName: item.fileName,
        outputPath: item.outputPath || '',
        progress: Number(item.progress) || 0,
        transferredBytes: Number(item.transferredBytes) || 0,
        totalBytes: Number(item.totalBytes) || 0,
        status: item.status || '等待中',
        errorMessage: item.errorMessage || '',
        createdAt: Number(item.createdAt) || Date.now() + downloadTasks.size,
      }

      if (task.status === '已完成') {
        const exists = await fileExists(task.outputPath)
        if (!exists) {
          task.status = '失败'
          task.errorMessage = '历史任务对应的已下载文件不存在，请重新下载。'
          task.outputPath = ''
          task.progress = 0
          task.transferredBytes = 0
          task.totalBytes = 0
          summary.missingCompletedFiles += 1
        }
      } else {
        if (await fileExists(task.outputPath)) {
          await fsp.rm(task.outputPath, { force: true })
        }

        if (task.status === '下载中' || task.status === '等待中') {
          task.status = '等待中'
          task.errorMessage = '应用重启后已恢复为等待中。'
          summary.resumedAsWaiting += 1
        }

        task.outputPath = ''
        task.progress = 0
        task.transferredBytes = 0
        task.totalBytes = 0
      }

      downloadTasks.set(task.id, task)
      summary.restored += 1
    }
  } catch {}

  lastRecoverySummary = summary
  schedulePersistDownloadTasks()
}

const listTaskSnapshots = () =>
  Array.from(downloadTasks.values())
    .sort((left, right) => left.createdAt - right.createdAt)
    .map((task) => ({
      id: task.id,
      adapterId: task.adapterId,
      seriesId: task.seriesId,
      seriesTitle: task.seriesTitle,
      episodeId: task.episodeId,
      episodeTitle: task.episodeTitle,
      resolution: task.resolution,
      sourceUrl: task.sourceUrl,
      fileName: task.fileName,
      outputPath: task.outputPath,
      progress: task.progress,
      transferredBytes: task.transferredBytes,
      totalBytes: task.totalBytes,
      status: task.status,
      errorMessage: task.errorMessage,
    }))

const broadcastDownloads = () => {
  const payload = listTaskSnapshots()
  schedulePersistDownloadTasks()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('downloads:changed', payload)
  }
}

const sanitizeFileName = (value) =>
  value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')

const reserveOutputPath = async (directory, fileName) => {
  const sanitized = sanitizeFileName(fileName || 'download.bin')
  const parsed = path.parse(sanitized)
  let attempt = 0

  while (true) {
    const candidateName =
      attempt === 0
        ? sanitized
        : `${parsed.name} (${attempt})${parsed.ext || ''}`
    const candidatePath = path.join(directory, candidateName)

    try {
      await fsp.access(candidatePath)
      attempt += 1
    } catch {
      return candidatePath
    }
  }
}

const createAbortError = (reason = 'cancelled') => {
  const error = new Error(reason)
  error.code = 'DOWNLOAD_ABORTED'
  return error
}

const attachAbort = (signal, resources) => {
  if (!signal) {
    return () => {}
  }

  const onAbort = () => {
    for (const resource of resources) {
      if (resource && typeof resource.destroy === 'function') {
        resource.destroy(createAbortError(signal.reason || 'cancelled'))
      }
    }
  }

  if (signal.aborted) {
    onAbort()
    return () => {}
  }

  signal.addEventListener('abort', onAbort, { once: true })
  return () => signal.removeEventListener('abort', onAbort)
}

const updateTaskProgress = (task, transferredBytes, totalBytes) => {
  const previousProgress = task.progress
  const previousTransferred = task.transferredBytes
  const previousTotal = task.totalBytes
  task.transferredBytes = transferredBytes
  task.totalBytes = totalBytes

  const nextProgress =
    totalBytes > 0
      ? Math.min(99, Math.floor((transferredBytes / totalBytes) * 100))
      : Math.max(task.progress, transferredBytes > 0 ? 1 : 0)

  if (
    nextProgress !== previousProgress ||
    transferredBytes !== previousTransferred ||
    totalBytes !== previousTotal
  ) {
    task.progress = nextProgress
    broadcastDownloads()
  }
}

const downloadLocalFile = async (sourcePath, outputPath, task, signal) => {
  const stats = await fsp.stat(sourcePath)
  let transferred = 0

  const readStream = fs.createReadStream(sourcePath)
  const writeStream = fs.createWriteStream(outputPath)
  const detachAbort = attachAbort(signal, [readStream, writeStream])

  readStream.on('data', (chunk) => {
    transferred += chunk.length
    updateTaskProgress(task, transferred, stats.size)
  })

  try {
    await pipeline(readStream, writeStream)
  } finally {
    detachAbort()
  }
}

const downloadHttpFile = (sourceUrl, outputPath, task, signal, redirectCount = 0) =>
  new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('重定向次数过多，已停止下载。'))
      return
    }

    const requestUrl = new URL(sourceUrl)
    const transport = requestUrl.protocol === 'https:' ? https : http
    let transferred = 0
    const request = transport.get(requestUrl, (response) => {
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        response.resume()
        const redirectTarget = new URL(response.headers.location, requestUrl).toString()
        resolve(downloadHttpFile(redirectTarget, outputPath, task, signal, redirectCount + 1))
        return
      }

      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`下载失败，HTTP 状态码 ${response.statusCode || 'unknown'}`))
        return
      }

      const totalBytes = Number(response.headers['content-length'] || 0)
      const writeStream = fs.createWriteStream(outputPath)
      const detachAbort = attachAbort(signal, [request, response, writeStream])

      response.on('data', (chunk) => {
        transferred += chunk.length
        updateTaskProgress(task, transferred, totalBytes)
      })

      pipeline(response, writeStream)
        .then(() => {
          detachAbort()
          resolve()
        })
        .catch((error) => {
          detachAbort()
          reject(error)
        })
    })

    request.on('error', reject)
    const detachAbort = attachAbort(signal, [request])

    request.on('close', () => {
      detachAbort()
    })
  })

const downloadToFile = async (task, outputPath, signal) => {
  if (/^https?:\/\//i.test(task.sourceUrl)) {
    await downloadHttpFile(task.sourceUrl, outputPath, task, signal)
    return
  }

  const sourcePath = /^file:\/\//i.test(task.sourceUrl)
    ? fileURLToPath(task.sourceUrl)
    : task.sourceUrl

  await downloadLocalFile(sourcePath, outputPath, task, signal)
}

const startTask = async (task) => {
  if (activeDownloads.has(task.id) || task.status !== '等待中') {
    return
  }

  const settings = await ensureSettings()
  await fsp.mkdir(settings.downloadDirectory, { recursive: true })

  task.status = '下载中'
  task.progress = Math.max(task.progress, 1)
  task.errorMessage = ''
  task.transferredBytes = 0
  task.totalBytes = 0
  task.outputPath = await reserveOutputPath(settings.downloadDirectory, task.fileName)
  broadcastDownloads()

  const controller = new AbortController()
  activeDownloads.set(task.id, controller)

  try {
    await downloadToFile(task, task.outputPath, controller.signal)
    task.progress = 100
    task.status = '已完成'
  } catch (error) {
    const isPaused =
      controller.signal.aborted && controller.signal.reason === 'paused'

    try {
      if (task.outputPath) {
        await fsp.rm(task.outputPath, { force: true })
      }
    } catch {}

    if (isPaused) {
      task.status = '已暂停'
      task.progress = 0
      task.outputPath = ''
    } else {
      task.status = '失败'
      task.progress = 0
      task.outputPath = ''
      task.errorMessage = error instanceof Error ? error.message : '下载失败'
    }
  } finally {
    activeDownloads.delete(task.id)
    broadcastDownloads()
    void maybeStartDownloads()
  }
}

const maybeStartDownloads = async () => {
  if (schedulerActive) {
    scheduleAgain = true
    return
  }

  schedulerActive = true

  try {
    const settings = await ensureSettings()
    const limit = Math.max(1, settings.maxConcurrentDownloads || 1)

    while (true) {
      const activeCount = activeDownloads.size
      if (activeCount >= limit) {
        break
      }

      const nextTask = Array.from(downloadTasks.values()).find(
        (task) => task.status === '等待中',
      )

      if (!nextTask) {
        break
      }

      void startTask(nextTask)
    }
  } finally {
    schedulerActive = false

    if (scheduleAgain) {
      scheduleAgain = false
      void maybeStartDownloads()
    }
  }
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

ipcMain.handle('downloads:get-recovery-summary', async () => lastRecoverySummary)

ipcMain.handle('settings:read', async () => ensureSettings())

ipcMain.handle('settings:update', async (_event, patch) => {
  const next = await writeSettings(patch)
  void maybeStartDownloads()
  return next
})

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

ipcMain.handle('files:open-text', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择资源清单文件',
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
    properties: ['openFile'],
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  const [selectedPath] = result.filePaths
  const content = await fsp.readFile(selectedPath, 'utf8')
  return {
    path: selectedPath,
    content,
  }
})

ipcMain.handle('files:save-text', async (_event, input) => {
  const result = await dialog.showSaveDialog({
    title: '导出资源清单',
    defaultPath: input.defaultFileName || 'manual-sources.json',
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
  })

  if (result.canceled || !result.filePath) {
    return null
  }

  await fsp.writeFile(result.filePath, input.content, 'utf8')
  return result.filePath
})

ipcMain.handle('downloads:list', async () => listTaskSnapshots())

ipcMain.handle('downloads:enqueue', async (_event, inputs) => {
  for (const input of inputs) {
    if (!downloadTasks.has(input.taskId)) {
      downloadTasks.set(input.taskId, {
        id: input.taskId,
        adapterId: input.adapterId,
        seriesId: input.seriesId,
        seriesTitle: input.seriesTitle,
        episodeId: input.episodeId,
        episodeTitle: input.episodeTitle,
        resolution: input.resolution,
        sourceUrl: input.sourceUrl,
        fileName: input.fileName,
        outputPath: '',
        progress: 0,
        transferredBytes: 0,
        totalBytes: 0,
        status: '等待中',
        errorMessage: '',
        createdAt: Date.now() + downloadTasks.size,
      })
    }
  }

  broadcastDownloads()
  void maybeStartDownloads()
  return listTaskSnapshots()
})

ipcMain.handle('downloads:pause', async (_event, taskId) => {
  const task = downloadTasks.get(taskId)
  if (!task) {
    return listTaskSnapshots()
  }

  if (task.status === '等待中') {
    task.status = '已暂停'
  }

  const controller = activeDownloads.get(taskId)
  if (controller) {
    controller.abort('paused')
  }

  broadcastDownloads()
  return listTaskSnapshots()
})

ipcMain.handle('downloads:resume', async (_event, taskId) => {
  const task = downloadTasks.get(taskId)
  if (!task) {
    return listTaskSnapshots()
  }

  if (task.status === '已暂停' || task.status === '失败') {
    task.status = '等待中'
    task.progress = 0
    task.transferredBytes = 0
    task.totalBytes = 0
    task.outputPath = ''
    task.errorMessage = ''
  }

  broadcastDownloads()
  void maybeStartDownloads()
  return listTaskSnapshots()
})

ipcMain.handle('downloads:retry-failed', async () => {
  for (const task of downloadTasks.values()) {
    if (task.status === '失败') {
      task.status = '等待中'
      task.progress = 0
      task.transferredBytes = 0
      task.totalBytes = 0
      task.outputPath = ''
      task.errorMessage = ''
    }
  }

  broadcastDownloads()
  void maybeStartDownloads()
  return listTaskSnapshots()
})

ipcMain.handle('downloads:clear-completed', async () => {
  for (const [taskId, task] of downloadTasks.entries()) {
    if (task.status === '已完成') {
      downloadTasks.delete(taskId)
    }
  }

  broadcastDownloads()
  return listTaskSnapshots()
})

ipcMain.handle('downloads:clear-failed', async () => {
  for (const [taskId, task] of downloadTasks.entries()) {
    if (task.status === '失败') {
      downloadTasks.delete(taskId)
    }
  }

  broadcastDownloads()
  return listTaskSnapshots()
})

ipcMain.handle('downloads:open-file', async (_event, taskId) => {
  const task = downloadTasks.get(taskId)
  if (!task?.outputPath) {
    return 'missing-path'
  }

  if (!(await fileExists(task.outputPath))) {
    return 'missing-file'
  }

  return shell.openPath(task.outputPath)
})

ipcMain.handle('downloads:show-in-folder', async (_event, taskId) => {
  const task = downloadTasks.get(taskId)
  if (!task?.outputPath) {
    return false
  }

  if (!(await fileExists(task.outputPath))) {
    return false
  }

  shell.showItemInFolder(task.outputPath)
  return true
})

app.whenReady().then(async () => {
  await ensureSettings()
  await restoreDownloadTasks()
  await createWindow()
  void maybeStartDownloads()

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

app.on('before-quit', () => {
  if (persistTasksTimer) {
    clearTimeout(persistTasksTimer)
    persistTasksTimer = null
  }
  void persistDownloadTasks()
})
