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
  openDownloadFile: (taskId) => ipcRenderer.invoke('downloads:open-file', taskId),
  showDownloadInFolder: (taskId) => ipcRenderer.invoke('downloads:show-in-folder', taskId),
  openTextFile: () => ipcRenderer.invoke('files:open-text'),
  saveTextFile: (input) => ipcRenderer.invoke('files:save-text', input),
  getDownloadRecoverySummary: () => ipcRenderer.invoke('downloads:get-recovery-summary'),
  onDownloadsChanged: (callback) => {
    const listener = (_event, tasks) => callback(tasks)
    ipcRenderer.on('downloads:changed', listener)
    return () => {
      ipcRenderer.removeListener('downloads:changed', listener)
    }
  },
})
