import type {
  DiscoveryCacheSnapshot,
  DiscoverySyncHistoryEntry,
  DiscoverySyncInput,
  DesktopContext,
  DesktopDownloadLogEntry,
  DesktopDownloadTask,
  DesktopDownloadRecoverySummary,
  DesktopSettings,
  EnqueueDownloadInput,
  OpenTextFileResult,
  ShortDramaImportBatchEntry,
  ShortDramaImportSummary,
  ShortDramaEpisodeEntry,
  ShortDramaEpisodeSyncResult,
  ShortDramaTableSnapshot,
} from './desktop'
import type { DiscoveredSeriesRecord } from './discoveredSources'

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
  importShortDramaExcel: () => Promise<ShortDramaImportSummary | null>
  getShortDramaDiscoveredSeries: () => Promise<DiscoveredSeriesRecord[]>
  getShortDramaImportBatches: (input?: {
    limit?: number
  }) => Promise<ShortDramaImportBatchEntry[]>
  getShortDramaTableRows: (input?: {
    limit?: number
    offset?: number
  }) => Promise<ShortDramaTableSnapshot>
  saveQuarkCookie: (input: { cookie: string }) => Promise<boolean>
  syncShortDramaEpisodes: (input: {
    dramaCode: string
    dramaTitle: string
  }) => Promise<ShortDramaEpisodeSyncResult>
  getShortDramaEpisodes: (input: {
    dramaCode: string
  }) => Promise<ShortDramaEpisodeEntry[]>
  refreshShortDramaEpisodeLink: (input: {
    dramaCode: string
    episodeIndex: number
  }) => Promise<ShortDramaEpisodeEntry>
  getPlayablePreviewUrl: (input: { sourceUrl: string }) => Promise<string>
  fetchDiscoveryManifest: (
    input: DiscoverySyncInput,
  ) => Promise<DiscoveryCacheSnapshot>
  getCachedDiscoveryManifest: () => Promise<DiscoveryCacheSnapshot | null>
  getDiscoverySyncHistory: () => Promise<DiscoverySyncHistoryEntry[]>
  appendDiscoverySyncHistory: (
    entry: Omit<DiscoverySyncHistoryEntry, 'id' | 'timestamp'> & {
      timestamp?: string
    },
  ) => Promise<DiscoverySyncHistoryEntry[]>
  clearDiscoverySyncHistory: () => Promise<DiscoverySyncHistoryEntry[]>
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
