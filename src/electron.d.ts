import type {
  DesktopContext,
  DesktopDownloadTask,
  DesktopSettings,
  EnqueueDownloadInput,
} from './desktop'

type DesktopApi = {
  isElectron: boolean
  getContext: () => Promise<DesktopContext>
  getSettings: () => Promise<DesktopSettings>
  updateSettings: (
    patch: Partial<DesktopSettings>,
  ) => Promise<DesktopSettings>
  chooseDownloadDirectory: () => Promise<string | null>
  openPath: (targetPath: string) => Promise<string>
  getDownloads: () => Promise<DesktopDownloadTask[]>
  enqueueDownloads: (
    tasks: EnqueueDownloadInput[],
  ) => Promise<DesktopDownloadTask[]>
  pauseDownload: (taskId: string) => Promise<DesktopDownloadTask[]>
  resumeDownload: (taskId: string) => Promise<DesktopDownloadTask[]>
  clearCompletedDownloads: () => Promise<DesktopDownloadTask[]>
  onDownloadsChanged: (
    callback: (tasks: DesktopDownloadTask[]) => void,
  ) => () => void
}

declare global {
  interface Window {
    desktopApi?: DesktopApi
  }
}

export {}
