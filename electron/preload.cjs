const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopApi', {
  isElectron: true,
  getContext: () => ipcRenderer.invoke('desktop:get-context'),
  getSettings: () => ipcRenderer.invoke('settings:read'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  chooseDownloadDirectory: () => ipcRenderer.invoke('dialog:choose-directory'),
  openPath: (targetPath) => ipcRenderer.invoke('shell:open-path', targetPath),
  getDownloads: () => ipcRenderer.invoke('downloads:list'),
  enqueueDownloads: (tasks) => ipcRenderer.invoke('downloads:enqueue', tasks),
  pauseDownload: (taskId) => ipcRenderer.invoke('downloads:pause', taskId),
  resumeDownload: (taskId) => ipcRenderer.invoke('downloads:resume', taskId),
  retryFailedDownloads: () => ipcRenderer.invoke('downloads:retry-failed'),
  clearCompletedDownloads: () => ipcRenderer.invoke('downloads:clear-completed'),
  clearFailedDownloads: () => ipcRenderer.invoke('downloads:clear-failed'),
  getDownloadLogs: () => ipcRenderer.invoke('download-logs:list'),
  clearDownloadLogs: () => ipcRenderer.invoke('download-logs:clear'),
  openDownloadFile: (taskId) => ipcRenderer.invoke('downloads:open-file', taskId),
  showDownloadInFolder: (taskId) => ipcRenderer.invoke('downloads:show-in-folder', taskId),
  openTextFile: () => ipcRenderer.invoke('files:open-text'),
  saveTextFile: (input) => ipcRenderer.invoke('files:save-text', input),
  importShortDramaExcel: () => ipcRenderer.invoke('short-drama:import-excel'),
  getShortDramaDiscoveredSeries: () => ipcRenderer.invoke('short-drama:list-series'),
  getShortDramaImportBatches: (input) => ipcRenderer.invoke('short-drama:list-batches', input),
  getShortDramaTableRows: (input) => ipcRenderer.invoke('short-drama:list-table', input),
  saveQuarkCookie: (input) => ipcRenderer.invoke('short-drama:save-cookie', input),
  syncShortDramaEpisodes: (input) => ipcRenderer.invoke('short-drama:sync-episodes', input),
  getShortDramaEpisodes: (input) => ipcRenderer.invoke('short-drama:list-episodes', input),
  refreshShortDramaEpisodeLink: (input) =>
    ipcRenderer.invoke('short-drama:refresh-episode-link', input),
  getPlayablePreviewUrl: (input) =>
    ipcRenderer.invoke('short-drama:get-playable-preview-url', input),
  fetchDiscoveryManifest: (input) => ipcRenderer.invoke('discovery:fetch-remote', input),
  getCachedDiscoveryManifest: () => ipcRenderer.invoke('discovery:read-cache'),
  getDiscoverySyncHistory: () => ipcRenderer.invoke('discovery-history:list'),
  appendDiscoverySyncHistory: (entry) => ipcRenderer.invoke('discovery-history:append', entry),
  clearDiscoverySyncHistory: () => ipcRenderer.invoke('discovery-history:clear'),
  getDownloadRecoverySummary: () => ipcRenderer.invoke('downloads:get-recovery-summary'),
  onDownloadsChanged: (callback) => {
    const listener = (_event, tasks) => callback(tasks)
    ipcRenderer.on('downloads:changed', listener)
    return () => {
      ipcRenderer.removeListener('downloads:changed', listener)
    }
  },
  onDownloadLogsChanged: (callback) => {
    const listener = (_event, logs) => callback(logs)
    ipcRenderer.on('download-logs:changed', listener)
    return () => {
      ipcRenderer.removeListener('download-logs:changed', listener)
    }
  },
})
