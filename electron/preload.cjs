const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopApi', {
  isElectron: true,
  getContext: () => ipcRenderer.invoke('desktop:get-context'),
  getSettings: () => ipcRenderer.invoke('settings:read'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  chooseDownloadDirectory: () => ipcRenderer.invoke('dialog:choose-directory'),
  openPath: (targetPath) => ipcRenderer.invoke('shell:open-path', targetPath),
})
