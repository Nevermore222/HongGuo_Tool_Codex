import type { Resolution } from './catalog'
import type { DiscoveredSeriesRecord } from './discoveredSources'

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
  remoteServiceEnabled: boolean
  remoteServicePort: number
  remoteServiceToken: string
  remoteClientBaseUrl: string
  remoteClientToken: string
  updatedAt: string
}

export type ShortDramaSaveStatus =
  | 'idle'
  | 'pending'
  | 'processing'
  | 'waiting_save'
  | 'ready'
  | 'failed'

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

export type DiscoverySyncInput = {
  endpointUrl: string
  headers: Record<string, string>
}

export type DiscoveryCacheSnapshot = {
  endpointUrl: string
  fetchedAt: string
  cachePath: string
  content: string
}

export type DiscoveryCatalogSnapshot = {
  endpointUrl: string
  fetchedAt: string
  cachePath: string
  series: DiscoveredSeriesRecord[]
}

export type DiscoverySyncMode = 'api' | 'cache' | 'file'

export type DiscoverySyncHistoryEntry = {
  id: string
  sourceName: string
  endpointUrl: string
  mode: DiscoverySyncMode
  status: '成功' | '失败'
  itemCount: number
  message: string
  timestamp: string
}

export type ShortDramaImportSummary = {
  filePath: string
  sheetName: string
  totalRows: number
  importedRows: number
  insertedRows: number
  updatedRows: number
  skippedRows: number
  removedRows: number
  syncMode: 'replace' | 'merge'
  databasePath: string
  seriesCount: number
}

export type ShortDramaImportBatchEntry = {
  id: number
  source_file: string
  source_sheet: string
  parsed_rows: number
  imported_rows: number
  inserted_rows: number
  updated_rows: number
  skipped_rows: number
  removed_rows: number
  sync_mode: 'replace' | 'merge'
  imported_at: string
}

export type ShortDramaTableEntry = {
  drama_code: string
  drama_name: string
  quark_url: string
  baidu_url: string
  save_status: ShortDramaSaveStatus
  save_requested_at: string
  save_completed_at: string
  save_error: string
  saved_root_fid: string
  cover_file_id: string
  cover_file_name: string
  cover_url: string
  episode_count: number
  ready_episode_count: number
  updated_at: string
}

export type ShortDramaTableSnapshot = {
  total: number
  limit: number
  offset: number
  rows: ShortDramaTableEntry[]
}

export type ShortDramaEpisodeEntry = {
  drama_code: string
  drama_title: string
  episode_index: number
  episode_title: string
  quark_file_id: string
  file_name: string
  file_size: number
  preview_url: string
  download_url: string
  url_expire_at: string
  status: 'ready' | 'expired' | 'missing'
  updated_at: string
}

export type ShortDramaEpisodeSyncResult = {
  dramaCode: string
  dramaTitle: string
  folderName: string
  folderFid: string
  syncedEpisodes: number
  readyEpisodes: number
  episodes: ShortDramaEpisodeEntry[]
}

export type ShortDramaSaveRequestResult = {
  dramaCode: string
  dramaTitle: string
  status: ShortDramaSaveStatus
  requestedAt: string
  completedAt: string
  errorMessage: string
  savedRootFid: string
  coverFileId: string
  coverFileName: string
  coverUrl: string
  episodeCount: number
  readyEpisodeCount: number
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
  remoteServiceEnabled: false,
  remoteServicePort: 39095,
  remoteServiceToken: '',
  remoteClientBaseUrl: '',
  remoteClientToken: '',
  updatedAt: '',
}

export const isDesktopShellAvailable = () =>
  typeof window !== 'undefined' && Boolean(window.desktopApi?.isElectron)
