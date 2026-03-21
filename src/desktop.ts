import type { Resolution } from './catalog'

export type DesktopContext = {
  isElectron: boolean
  platform: string
  version: string
  userDataPath: string
}

export type DesktopSettings = {
  downloadDirectory: string
  maxConcurrentDownloads: number
  preferredResolution: Resolution
  updatedAt: string
}

export type DesktopDownloadStatus =
  | '等待中'
  | '下载中'
  | '已完成'
  | '已暂停'
  | '失败'

export type DesktopDownloadLogLevel = '信息' | '警告' | '错误'

export type EnqueueDownloadInput = {
  taskId: string
  adapterId: string
  seriesId: string
  seriesTitle: string
  episodeId: string
  episodeTitle: string
  resolution: Resolution
  sourceUrl: string
  fileName: string
}

export type DesktopDownloadTask = {
  id: string
  adapterId: string
  seriesId: string
  seriesTitle: string
  episodeId: string
  episodeTitle: string
  resolution: Resolution
  sourceUrl: string
  fileName: string
  outputPath: string
  progress: number
  transferredBytes: number
  totalBytes: number
  status: DesktopDownloadStatus
  errorMessage?: string
}

export type DesktopDownloadLogEntry = {
  id: string
  taskId: string
  adapterId: string
  seriesTitle: string
  episodeTitle: string
  fileName: string
  outputPath: string
  status: DesktopDownloadStatus
  level: DesktopDownloadLogLevel
  message: string
  timestamp: string
}

export type OpenTextFileResult = {
  path: string
  content: string
}

export type DesktopDownloadRecoverySummary = {
  restored: number
  resumedAsWaiting: number
  missingCompletedFiles: number
}

export const fallbackDesktopContext: DesktopContext = {
  isElectron: false,
  platform: 'web',
  version: 'browser',
  userDataPath: '浏览器模式下不可用',
}

export const fallbackDesktopSettings: DesktopSettings = {
  downloadDirectory: '未选择下载目录',
  maxConcurrentDownloads: 3,
  preferredResolution: '720p',
  updatedAt: '',
}

export const isDesktopShellAvailable = () =>
  typeof window !== 'undefined' && Boolean(window.desktopApi?.isElectron)
