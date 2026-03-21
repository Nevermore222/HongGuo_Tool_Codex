import type {
  DesktopContext,
  DesktopDownloadLogEntry,
  DesktopDownloadTask,
  DesktopDownloadRecoverySummary,
  DesktopSettings,
  EnqueueDownloadInput,
  OpenTextFileResult,
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
  retryFailedDownloads: () => Promise<DesktopDownloadTask[]>
  clearCompletedDownloads: () => Promise<DesktopDownloadTask[]>
  clearFailedDownloads: () => Promise<DesktopDownloadTask[]>
  getDownloadLogs: () => Promise<DesktopDownloadLogEntry[]>
  clearDownloadLogs: () => Promise<DesktopDownloadLogEntry[]>
  openDownloadFile: (taskId: string) => Promise<string>
  showDownloadInFolder: (taskId: string) => Promise<boolean>
  openTextFile: () => Promise<OpenTextFileResult | null>
  saveTextFile: (input: {
    defaultFileName: string
    content: string
  }) => Promise<string | null>
  getDownloadRecoverySummary: () => Promise<DesktopDownloadRecoverySummary | null>
  onDownloadsChanged: (
    callback: (tasks: DesktopDownloadTask[]) => void,
  ) => () => void
  onDownloadLogsChanged: (
    callback: (logs: DesktopDownloadLogEntry[]) => void,
  ) => () => void
}

declare global {
  interface Window {
    desktopApi?: DesktopApi
  }
}

export {}
