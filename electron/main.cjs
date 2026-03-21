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
const downloadLogs = []
const activeDownloads = new Map()
let schedulerActive = false
let scheduleAgain = false
let lastRecoverySummary = null
let persistTasksTimer = null
let persistLogsTimer = null
const maxDownloadLogs = 2000

const defaultSettings = () => ({
  downloadDirectory: app.getPath('downloads'),
  maxConcurrentDownloads: 3,
  preferredResolution: '720p',
  updatedAt: new Date().toISOString(),
})

const getSettingsPath = () => path.join(app.getPath('userData'), 'settings.json')
const getTasksPath = () => path.join(app.getPath('userData'), 'download-tasks.json')
const getLogsPath = () => path.join(app.getPath('userData'), 'download-logs.json')
const getDiscoveryCachePath = () =>
  path.join(app.getPath('userData'), 'discovery-library-cache.json')

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
    tempPath: task.tempPath,
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

const persistDownloadLogs = async () => {
  await fsp.mkdir(path.dirname(getLogsPath()), { recursive: true })
  await fsp.writeFile(getLogsPath(), JSON.stringify(downloadLogs, null, 2), 'utf8')
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

const schedulePersistDownloadLogs = () => {
  if (persistLogsTimer) {
    clearTimeout(persistLogsTimer)
  }

  persistLogsTimer = setTimeout(() => {
    persistLogsTimer = null
    void persistDownloadLogs()
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

const getTaskTempPath = (outputPath) => (outputPath ? `${outputPath}.part` : '')

const removeTaskArtifacts = async (task, options = {}) => {
  const { includeOutput = false } = options

  if (task.tempPath) {
    await fsp.rm(task.tempPath, { force: true }).catch(() => {})
  }

  if (includeOutput && task.outputPath) {
    await fsp.rm(task.outputPath, { force: true }).catch(() => {})
  }
}

const listDownloadLogSnapshots = () =>
  [...downloadLogs].sort(
    (left, right) =>
      new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime(),
  )

const broadcastDownloadLogs = () => {
  const payload = listDownloadLogSnapshots()
  schedulePersistDownloadLogs()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('download-logs:changed', payload)
  }
}

const appendDownloadLog = ({
  task,
  level = '信息',
  message,
  status,
  outputPath,
}) => {
  if (!task || !message) {
    return
  }

  downloadLogs.push({
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    taskId: task.id,
    adapterId: task.adapterId,
    seriesTitle: task.seriesTitle,
    episodeTitle: task.episodeTitle,
    fileName: task.fileName,
    outputPath: outputPath ?? task.outputPath ?? '',
    status: status ?? task.status,
    level,
    message,
    timestamp: new Date().toISOString(),
  })

  if (downloadLogs.length > maxDownloadLogs) {
    downloadLogs.splice(0, downloadLogs.length - maxDownloadLogs)
  }

  broadcastDownloadLogs()
}

const restoreDownloadLogs = async () => {
  try {
    const raw = await fsp.readFile(getLogsPath(), 'utf8')
    const parsed = JSON.parse(raw)

    if (!Array.isArray(parsed)) {
      return
    }

    downloadLogs.length = 0

    for (const item of parsed.slice(-maxDownloadLogs)) {
      if (!item || typeof item !== 'object') {
        continue
      }

      downloadLogs.push({
        id: item.id || `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        taskId: item.taskId || '',
        adapterId: item.adapterId || '',
        seriesTitle: item.seriesTitle || '',
        episodeTitle: item.episodeTitle || '',
        fileName: item.fileName || '',
        outputPath: item.outputPath || '',
        status: item.status || '等待中',
        level: item.level || '信息',
        message: item.message || '',
        timestamp: item.timestamp || new Date().toISOString(),
      })
    }
  } catch {}
}

const readDiscoveryCache = async () => {
  try {
    const raw = await fsp.readFile(getDiscoveryCachePath(), 'utf8')
    const parsed = JSON.parse(raw)

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.content !== 'string' ||
      typeof parsed.fetchedAt !== 'string' ||
      typeof parsed.endpointUrl !== 'string'
    ) {
      return null
    }

    return {
      endpointUrl: parsed.endpointUrl,
      fetchedAt: parsed.fetchedAt,
      cachePath: getDiscoveryCachePath(),
      content: parsed.content,
    }
  } catch {
    return null
  }
}

const writeDiscoveryCache = async ({ endpointUrl, content }) => {
  const payload = {
    endpointUrl,
    fetchedAt: new Date().toISOString(),
    content,
  }

  await fsp.mkdir(path.dirname(getDiscoveryCachePath()), { recursive: true })
  await fsp.writeFile(
    getDiscoveryCachePath(),
    JSON.stringify(payload, null, 2),
    'utf8',
  )

  return {
    endpointUrl: payload.endpointUrl,
    fetchedAt: payload.fetchedAt,
    cachePath: getDiscoveryCachePath(),
    content: payload.content,
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
        tempPath: item.tempPath || getTaskTempPath(item.outputPath || ''),
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
          task.tempPath = ''
          task.progress = 0
          task.transferredBytes = 0
          task.totalBytes = 0
          summary.missingCompletedFiles += 1
          appendDownloadLog({
            task,
            level: '警告',
            message: '历史已完成文件缺失，任务已自动改为失败状态。',
          })
        }
      } else {
        if (task.status === '下载中' || task.status === '等待中') {
          task.status = '等待中'
          task.errorMessage = '应用重启后已恢复为等待中。'
          summary.resumedAsWaiting += 1
          appendDownloadLog({
            task,
            message: '应用重启后恢复任务状态，已重新排入等待队列。',
          })
        }

        const tempExists = await fileExists(task.tempPath)
        if (!tempExists) {
          task.progress = 0
          task.transferredBytes = 0
          task.totalBytes = 0
          task.tempPath = task.outputPath ? getTaskTempPath(task.outputPath) : ''
          appendDownloadLog({
            task,
            level: '警告',
            message: '未找到断点临时文件，后续恢复下载时将从头开始。',
          })
        }
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
  const offset = task.transferredBytes
  let transferred = offset

  const readStream = fs.createReadStream(sourcePath, {
    start: offset > 0 ? offset : undefined,
  })
  const writeStream = fs.createWriteStream(outputPath, {
    flags: offset > 0 ? 'a' : 'w',
  })
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

const downloadHttpFile = (
  sourceUrl,
  outputPath,
  task,
  signal,
  resumeOffset = 0,
  redirectCount = 0,
) =>
  new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('重定向次数过多，已停止下载。'))
      return
    }

    const requestUrl = new URL(sourceUrl)
    const transport = requestUrl.protocol === 'https:' ? https : http
    let transferred = resumeOffset
    const requestHeaders = resumeOffset > 0 ? { Range: `bytes=${resumeOffset}-` } : {}
    const request = transport.get(requestUrl, { headers: requestHeaders }, (response) => {
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        response.resume()
        const redirectTarget = new URL(response.headers.location, requestUrl).toString()
        resolve(
          downloadHttpFile(
            redirectTarget,
            outputPath,
            task,
            signal,
            resumeOffset,
            redirectCount + 1,
          ),
        )
        return
      }

      const isPartial = response.statusCode === 206
      const isFullContent = response.statusCode === 200

      if (!isPartial && !isFullContent) {
        response.resume()
        reject(new Error(`下载失败，HTTP 状态码 ${response.statusCode || 'unknown'}`))
        return
      }

      const contentLength = Number(response.headers['content-length'] || 0)
      const totalBytes =
        isPartial && resumeOffset > 0 ? resumeOffset + contentLength : contentLength
      const shouldAppend = isPartial && resumeOffset > 0
      const effectiveOffset = shouldAppend ? resumeOffset : 0

      if (resumeOffset > 0 && !shouldAppend) {
        task.errorMessage = '当前源不支持断点续传，已自动改为从头下载。'
        task.progress = 0
        task.transferredBytes = 0
        transferred = 0
        appendDownloadLog({
          task,
          level: '警告',
          message: '远程源未返回分段响应，已自动回退为从头下载。',
          outputPath,
        })
      }

      const writeStream = fs.createWriteStream(outputPath, {
        flags: shouldAppend ? 'a' : 'w',
      })
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
    await downloadHttpFile(
      task.sourceUrl,
      outputPath,
      task,
      signal,
      task.transferredBytes || 0,
    )
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

  if (!task.outputPath) {
    task.outputPath = await reserveOutputPath(settings.downloadDirectory, task.fileName)
  }
  task.tempPath = task.tempPath || getTaskTempPath(task.outputPath)

  const tempExists = await fileExists(task.tempPath)
  if (tempExists) {
    const stats = await fsp.stat(task.tempPath)
    task.transferredBytes = stats.size
  } else {
    task.transferredBytes = 0
  }

  appendDownloadLog({
    task,
    message:
      task.transferredBytes > 0
        ? `继续下载，已从 ${task.transferredBytes} 字节断点恢复。`
        : '开始下载任务。',
    outputPath: task.outputPath,
  })

  task.status = '下载中'
  task.progress = Math.max(task.progress, 1)
  task.errorMessage = task.errorMessage === '应用重启后已恢复为等待中。' ? '' : task.errorMessage
  task.totalBytes = Math.max(task.totalBytes || 0, task.transferredBytes)
  broadcastDownloads()

  const controller = new AbortController()
  activeDownloads.set(task.id, controller)

  try {
    await downloadToFile(task, task.tempPath, controller.signal)
    await fsp.rename(task.tempPath, task.outputPath)
    task.tempPath = ''
    task.progress = 100
    task.status = '已完成'
    task.errorMessage = ''
    appendDownloadLog({
      task,
      message: '下载完成，已写入目标目录。',
      outputPath: task.outputPath,
    })
  } catch (error) {
    const isPaused =
      controller.signal.aborted && controller.signal.reason === 'paused'

    if (isPaused) {
      task.status = '已暂停'
      appendDownloadLog({
        task,
        message: `已暂停下载，当前已保留 ${task.transferredBytes} 字节断点。`,
        outputPath: task.outputPath,
      })
    } else {
      task.status = '失败'
      task.errorMessage = error instanceof Error ? error.message : '下载失败'
      appendDownloadLog({
        task,
        level: '错误',
        message: task.errorMessage,
        outputPath: task.outputPath,
      })
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

ipcMain.handle('discovery:fetch-remote', async (_event, input) => {
  const endpointUrl = String(input?.endpointUrl || '').trim()
  const headers =
    input?.headers && typeof input.headers === 'object' ? input.headers : {}

  if (!endpointUrl) {
    throw new Error('请输入内部资源 API 地址。')
  }

  let response
  try {
    response = await fetch(endpointUrl, {
      headers,
      signal: AbortSignal.timeout(15000),
    })
  } catch (error) {
    throw new Error(
      error instanceof Error ? `拉取资源库失败：${error.message}` : '拉取资源库失败。',
    )
  }

  const content = await response.text()

  if (!response.ok) {
    throw new Error(
      `拉取资源库失败：HTTP ${response.status}${
        content ? `，响应内容：${content.slice(0, 180)}` : ''
      }`,
    )
  }

  return writeDiscoveryCache({
    endpointUrl,
    content,
  })
})

ipcMain.handle('discovery:read-cache', async () => readDiscoveryCache())

ipcMain.handle('downloads:list', async () => listTaskSnapshots())
ipcMain.handle('download-logs:list', async () => listDownloadLogSnapshots())

ipcMain.handle('downloads:enqueue', async (_event, inputs) => {
  for (const input of inputs) {
    if (!downloadTasks.has(input.taskId)) {
      const task = {
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
        tempPath: '',
        progress: 0,
        transferredBytes: 0,
        totalBytes: 0,
        status: '等待中',
        errorMessage: '',
        createdAt: Date.now() + downloadTasks.size,
      }

      downloadTasks.set(input.taskId, task)
      appendDownloadLog({
        task,
        message: '任务已加入下载队列。',
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
    appendDownloadLog({
      task,
      message: '任务在开始前被手动暂停。',
      outputPath: task.outputPath,
    })
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
    task.errorMessage = ''
    appendDownloadLog({
      task,
      message: '任务已恢复到等待队列。',
      outputPath: task.outputPath,
    })
  }

  broadcastDownloads()
  void maybeStartDownloads()
  return listTaskSnapshots()
})

ipcMain.handle('downloads:retry-failed', async () => {
  for (const task of downloadTasks.values()) {
    if (task.status === '失败') {
      task.status = '等待中'
      task.errorMessage = ''
      appendDownloadLog({
        task,
        message: '失败任务已重新加入等待队列。',
        outputPath: task.outputPath,
      })
    }
  }

  broadcastDownloads()
  void maybeStartDownloads()
  return listTaskSnapshots()
})

ipcMain.handle('download-logs:clear', async () => {
  downloadLogs.length = 0
  broadcastDownloadLogs()
  return listDownloadLogSnapshots()
})

ipcMain.handle('downloads:clear-completed', async () => {
  for (const [taskId, task] of downloadTasks.entries()) {
    if (task.status === '已完成') {
      await removeTaskArtifacts(task, { includeOutput: true })
      downloadTasks.delete(taskId)
    }
  }

  broadcastDownloads()
  return listTaskSnapshots()
})

ipcMain.handle('downloads:clear-failed', async () => {
  for (const [taskId, task] of downloadTasks.entries()) {
    if (task.status === '失败') {
      await removeTaskArtifacts(task)
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
  await restoreDownloadLogs()
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
  if (persistLogsTimer) {
    clearTimeout(persistLogsTimer)
    persistLogsTimer = null
  }
  void persistDownloadTasks()
  void persistDownloadLogs()
})
