import { useDeferredValue, useEffect, useMemo, useState, startTransition } from 'react'
import './App.css'
import {
  fallbackDesktopContext,
  fallbackDesktopSettings,
  isDesktopShellAvailable,
} from './desktop'
import {
  mergeManualSources,
  parseManualSourceManifest,
  stringifyManualSourceManifest,
} from './manualSources'
import {
  mergeDiscoveredSeries,
  parseDiscoveredSeriesManifest,
  stringifyDiscoveredSeriesManifest,
} from './discoveredSources'
import {
  getAdapterOptions,
  getCatalogFromAdapters,
  resolveEpisodeDownload,
} from './sourceAdapters'
import type { Episode, Resolution, Series } from './catalog'
import type {
  DiscoveryCacheSnapshot,
  DiscoverySyncHistoryEntry,
  DesktopContext,
  DesktopDownloadLogEntry,
  DesktopDownloadTask,
  DesktopDownloadRecoverySummary,
  DesktopSettings,
  ShortDramaImportBatchEntry,
  ShortDramaImportSummary,
  ShortDramaTableSnapshot,
} from './desktop'
import type { DiscoveredSeriesRecord } from './discoveredSources'
import type { ManualSourceRecord } from './sourceAdapters'
import type { FormEvent } from 'react'

type ManualSourceForm = {
  title: string
  category: string
  totalEpisodes: number
  urlTemplate: string
  note: string
}

type DiscoveryApiForm = {
  endpointUrl: string
  headersText: string
}

type DiscoveryEndpointConfig = {
  id: string
  name: string
  endpointUrl: string
  headersText: string
  lastUsedAt: string
}

type PanelKey = 'desktop' | 'stats' | 'discovery' | 'manual' | 'logs'
type ShortDramaTableRow = {
  dramaCode: string
  title: string
  quarkUrl: string
  baiduUrl: string
  updatedAt: string
}

const queueStorageKey = 'hongguo-tool-framework-queue'
const manualStorageKey = 'hongguo-tool-framework-manual'
const libraryStorageKey = 'hongguo-tool-framework-library'
const discoveryApiConfigKey = 'hongguo-tool-framework-discovery-api-config'
const discoveryApiCacheKey = 'hongguo-tool-framework-discovery-api-cache'
const discoverySourcesKey = 'hongguo-tool-framework-discovery-sources'
const discoveryHistoryKey = 'hongguo-tool-framework-discovery-history'
const previewVideoUrl =
  'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'
const shortDramaAdapterId = 'short-drama-library'
const shortDramaTablePageSize = 500

const defaultManualForm: ManualSourceForm = {
  title: '',
  category: '手动导入',
  totalEpisodes: 12,
  urlTemplate: '',
  note: '',
}

const defaultDiscoveryApiForm: DiscoveryApiForm = {
  endpointUrl: '',
  headersText: '{\n  "Authorization": "Bearer your-token"\n}',
}

const defaultCollapsedPanels: Record<PanelKey, boolean> = {
  desktop: false,
  stats: true,
  discovery: false,
  manual: true,
  logs: true,
}

const buildDiscoverySourceId = () =>
  `discovery-source-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`

const queueStatusOptions = ['全部', '等待中', '下载中', '已完成', '已暂停', '失败'] as const
const logLevelOptions = ['全部', '信息', '警告', '错误'] as const

const buildManifestFileName = () => {
  const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d+Z$/, 'Z')
  return `manual-sources-${stamp}.json`
}

const buildLibraryManifestFileName = () => {
  const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d+Z$/, 'Z')
  return `resource-library-${stamp}.json`
}

const buildLogExportFileName = () => {
  const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d+Z$/, 'Z')
  return `download-logs-${stamp}.json`
}

const downloadTextFileInBrowser = (fileName: string, content: string) => {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

const readTextFileInBrowser = () =>
  new Promise<string | null>((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) {
        resolve(null)
        return
      }

      resolve(await file.text())
    }
    input.click()
  })

const readStorage = <T,>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') {
    return fallback
  }

  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

const parseDiscoveryHeaders = (raw: string) => {
  if (!raw.trim()) {
    return {}
  }

  const parsed = JSON.parse(raw) as Record<string, unknown>
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('请求头必须是 JSON 对象。')
  }

  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [key, String(value)]),
  )
}

const formatUpdatedAt = (value: string) =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未同步'

const formatLogTime = (value: string) =>
  new Date(value).toLocaleString('zh-CN', { hour12: false })

const formatSyncMode = (value: DiscoverySyncHistoryEntry['mode']) => {
  if (value === 'file') {
    return '本地清单'
  }
  if (value === 'cache') {
    return '缓存恢复'
  }
  return 'API 同步'
}

const formatPercent = (value: number) => `${value.toFixed(value >= 10 ? 0 : 1)}%`

const formatBytes = (bytes: number) => {
  if (!bytes) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB']
  let index = 0
  let size = bytes

  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }

  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`
}

const parseShortDramaCode = (title: string) => {
  const matched = /^(\d{3,})\s*[-—－]/.exec(String(title || '').trim())
  return matched?.[1] ?? ''
}

const parseShortDramaLinks = (sourceNote: string) => {
  const lines = String(sourceNote || '').split(/\r?\n/)
  let quarkUrl = ''
  let baiduUrl = ''

  for (const line of lines) {
    const value = line.trim()
    if (!value) {
      continue
    }
    if (!quarkUrl && value.includes('夸克') && /https?:\/\//i.test(value)) {
      const match = /(https?:\/\/\S+)/i.exec(value)
      quarkUrl = match?.[1] ?? ''
    }
    if (!baiduUrl && value.includes('百度') && /https?:\/\//i.test(value)) {
      const match = /(https?:\/\/\S+)/i.exec(value)
      baiduUrl = match?.[1] ?? ''
    }
  }

  return { quarkUrl, baiduUrl }
}

const buildRecoveryMessage = (recoverySummary: DesktopDownloadRecoverySummary | null) => {
  if (!recoverySummary || recoverySummary.restored === 0) {
    return ''
  }

  const messages = [`已恢复 ${recoverySummary.restored} 条历史下载任务`]
  if (recoverySummary.resumedAsWaiting > 0) {
    messages.push(`${recoverySummary.resumedAsWaiting} 条任务已重置为等待中`)
  }
  if (recoverySummary.missingCompletedFiles > 0) {
    messages.push(
      `${recoverySummary.missingCompletedFiles} 条历史完成任务因文件缺失改为失败`,
    )
  }
  return messages.join('，')
}

const buildBrowserPreviewTask = (
  series: Series,
  episode: Episode,
  resolution: Resolution,
): DesktopDownloadTask => ({
  id: `preview-${series.id}-${episode.id}-${resolution}`,
  adapterId: series.adapterId,
  seriesId: series.id,
  seriesTitle: series.title,
  episodeId: episode.id,
  episodeTitle: episode.title,
  resolution,
  sourceUrl: previewVideoUrl,
  fileName: `${series.title}-${episode.title}-${resolution}.mp4`,
  outputPath: '',
  progress: 0,
  transferredBytes: 0,
  totalBytes: 0,
  status: '等待中',
})

function App() {
  const initialManualSources = readStorage<ManualSourceRecord[]>(manualStorageKey, [])
  const initialDiscoveredSeries = readStorage<DiscoveredSeriesRecord[]>(libraryStorageKey, [])
  const initialDiscoveryApiForm = readStorage<DiscoveryApiForm>(
    discoveryApiConfigKey,
    defaultDiscoveryApiForm,
  )
  const initialDiscoverySources = readStorage<DiscoveryEndpointConfig[]>(
    discoverySourcesKey,
    [],
  )
  const initialDiscoveryCache = readStorage<DiscoveryCacheSnapshot | null>(
    discoveryApiCacheKey,
    null,
  )
  const initialDiscoveryHistory = readStorage<DiscoverySyncHistoryEntry[]>(
    discoveryHistoryKey,
    [],
  )
  const initialSeries = getCatalogFromAdapters(initialManualSources, initialDiscoveredSeries)
  const [desktopContext, setDesktopContext] =
    useState<DesktopContext>(fallbackDesktopContext)
  const [desktopSettings, setDesktopSettings] =
    useState<DesktopSettings>(fallbackDesktopSettings)
  const [desktopReady, setDesktopReady] = useState(false)
  const [actionMessage, setActionMessage] = useState('')
  const [manualSources, setManualSources] =
    useState<ManualSourceRecord[]>(initialManualSources)
  const [discoveredSeries, setDiscoveredSeries] =
    useState<DiscoveredSeriesRecord[]>(initialDiscoveredSeries)
  const [discoveryApiForm, setDiscoveryApiForm] =
    useState<DiscoveryApiForm>(initialDiscoveryApiForm)
  const [discoverySources, setDiscoverySources] =
    useState<DiscoveryEndpointConfig[]>(initialDiscoverySources)
  const [discoveryCache, setDiscoveryCache] =
    useState<DiscoveryCacheSnapshot | null>(initialDiscoveryCache)
  const [discoveryHistory, setDiscoveryHistory] =
    useState<DiscoverySyncHistoryEntry[]>(initialDiscoveryHistory)
  const [discoverySyncing, setDiscoverySyncing] = useState(false)
  const [shortDramaImporting, setShortDramaImporting] = useState(false)
  const [shortDramaImportBatches, setShortDramaImportBatches] =
    useState<ShortDramaImportBatchEntry[]>([])
  const [shortDramaTableSnapshot, setShortDramaTableSnapshot] =
    useState<ShortDramaTableSnapshot>({
      total: 0,
      limit: shortDramaTablePageSize,
      offset: 0,
      rows: [],
    })
  const [selectedShortDramaKey, setSelectedShortDramaKey] = useState('')
  const [collapsedPanels, setCollapsedPanels] =
    useState<Record<PanelKey, boolean>>(defaultCollapsedPanels)
  const [browserQueue, setBrowserQueue] = useState<DesktopDownloadTask[]>(() =>
    readStorage(queueStorageKey, []),
  )
  const [desktopDownloads, setDesktopDownloads] = useState<DesktopDownloadTask[]>([])
  const [desktopLogs, setDesktopLogs] = useState<DesktopDownloadLogEntry[]>([])
  const [activeCategory, setActiveCategory] = useState('全部')
  const [searchTerm, setSearchTerm] = useState('')
  const deferredSearch = useDeferredValue(searchTerm.trim().toLowerCase())
  const [queueSearchTerm, setQueueSearchTerm] = useState('')
  const deferredQueueSearch = useDeferredValue(queueSearchTerm.trim().toLowerCase())
  const [queueStatusFilter, setQueueStatusFilter] =
    useState<(typeof queueStatusOptions)[number]>('全部')
  const [logSearchTerm, setLogSearchTerm] = useState('')
  const deferredLogSearch = useDeferredValue(logSearchTerm.trim().toLowerCase())
  const [logLevelFilter, setLogLevelFilter] =
    useState<(typeof logLevelOptions)[number]>('全部')
  const [selectedResolution, setSelectedResolution] =
    useState<Resolution>(fallbackDesktopSettings.preferredResolution)
  const [selectedSeriesId, setSelectedSeriesId] = useState<string>(
    initialSeries[0]?.id ?? '',
  )
  const [previewEpisode, setPreviewEpisode] = useState<Episode | null>(null)
  const [manualForm, setManualForm] = useState<ManualSourceForm>(defaultManualForm)

  const allSeries = useMemo(
    () => getCatalogFromAdapters(manualSources, discoveredSeries),
    [discoveredSeries, manualSources],
  )

  const sortedDiscoverySources = useMemo(
    () =>
      [...discoverySources].sort(
        (left, right) =>
          new Date(right.lastUsedAt).getTime() - new Date(left.lastUsedAt).getTime(),
      ),
    [discoverySources],
  )

  const discoveryHistoryStats = useMemo(() => {
    const success = discoveryHistory.filter((item) => item.status === '成功').length
    const failed = discoveryHistory.filter((item) => item.status === '失败').length
    return {
      success,
      failed,
      total: discoveryHistory.length,
    }
  }, [discoveryHistory])

  const hasShortDramaDataset = shortDramaTableSnapshot.total > 0

  const categories = useMemo(
    () =>
      hasShortDramaDataset
        ? ['全部', '短剧查询导入']
        : ['全部', ...new Set(allSeries.map((item) => item.category))],
    [allSeries, hasShortDramaDataset],
  )

  const filteredSeries = useMemo(() => {
    return allSeries.filter((item) => {
      const matchCategory =
        activeCategory === '全部' || item.category === activeCategory
      const searchBucket = `${item.title} ${item.description} ${item.tags.join(' ')}`
        .toLowerCase()
        .trim()
      const matchSearch =
        deferredSearch.length === 0 || searchBucket.includes(deferredSearch)

      return matchCategory && matchSearch
    })
  }, [activeCategory, allSeries, deferredSearch])

  const cardSeries = useMemo(
    () =>
      hasShortDramaDataset
        ? []
        : filteredSeries.filter((item) => item.adapterId !== shortDramaAdapterId),
    [filteredSeries, hasShortDramaDataset],
  )

  const shortDramaTableRows = useMemo<ShortDramaTableRow[]>(
    () =>
      shortDramaTableSnapshot.rows.map((item) => ({
        dramaCode: item.drama_code || parseShortDramaCode(item.drama_name),
        title: item.drama_name,
        quarkUrl: item.quark_url,
        baiduUrl: item.baidu_url,
        updatedAt: item.updated_at
          ? new Date(item.updated_at).toLocaleString('zh-CN', { hour12: false })
          : '',
      })),
    [shortDramaTableSnapshot.rows],
  )

  const filteredShortDramaTableRows = useMemo(() => {
    if (!hasShortDramaDataset) {
      return []
    }

    return shortDramaTableRows.filter((item) => {
      const searchBucket = `${item.dramaCode} ${item.title}`.toLowerCase()
      const matchesSearch =
        deferredSearch.length === 0 || searchBucket.includes(deferredSearch)
      const matchesCategory =
        activeCategory === '全部' || activeCategory === '短剧查询导入'
      return matchesSearch && matchesCategory
    })
  }, [activeCategory, deferredSearch, hasShortDramaDataset, shortDramaTableRows])

  const selectedShortDramaRow = useMemo(() => {
    if (filteredShortDramaTableRows.length === 0) {
      return null
    }
    return (
      filteredShortDramaTableRows.find(
        (item) => `${item.dramaCode}-${item.title}` === selectedShortDramaKey,
      ) || filteredShortDramaTableRows[0]
    )
  }, [filteredShortDramaTableRows, selectedShortDramaKey])

  const displayResourceCount = hasShortDramaDataset
    ? shortDramaTableSnapshot.total
    : filteredSeries.length

  const selectedSeries =
    filteredSeries.find((item) => item.id === selectedSeriesId) ??
    allSeries.find((item) => item.id === selectedSeriesId) ??
    filteredSeries[0] ??
    allSeries[0]

  const selectedShortDramaLinks = useMemo(() => {
    if (!selectedSeries || selectedSeries.adapterId !== shortDramaAdapterId) {
      return { quarkUrl: '', baiduUrl: '' }
    }
    return parseShortDramaLinks(selectedSeries.sourceNote)
  }, [selectedSeries])

  const visibleQueue = desktopContext.isElectron ? desktopDownloads : browserQueue
  const adapterOptions = useMemo(() => getAdapterOptions(), [])

  const filteredQueue = useMemo(() => {
    return visibleQueue.filter((item) => {
      const matchesStatus =
        queueStatusFilter === '全部' || item.status === queueStatusFilter
      const searchBucket = [
        item.seriesTitle,
        item.episodeTitle,
        item.fileName,
        item.adapterId,
        item.errorMessage ?? '',
        item.outputPath,
      ]
        .join(' ')
        .toLowerCase()

      const matchesSearch =
        deferredQueueSearch.length === 0 ||
        searchBucket.includes(deferredQueueSearch)

      return matchesStatus && matchesSearch
    })
  }, [deferredQueueSearch, queueStatusFilter, visibleQueue])

  const filteredLogs = useMemo(() => {
    return desktopLogs.filter((item) => {
      const matchesLevel =
        logLevelFilter === '全部' || item.level === logLevelFilter
      const searchBucket = [
        item.seriesTitle,
        item.episodeTitle,
        item.fileName,
        item.adapterId,
        item.message,
        item.outputPath,
      ]
        .join(' ')
        .toLowerCase()

      const matchesSearch =
        deferredLogSearch.length === 0 || searchBucket.includes(deferredLogSearch)

      return matchesLevel && matchesSearch
    })
  }, [deferredLogSearch, desktopLogs, logLevelFilter])

  useEffect(() => {
    let disposed = false
    let unsubscribeDownloads = () => {}
    let unsubscribeLogs = () => {}

    const bootstrapDesktop = async () => {
      if (!isDesktopShellAvailable() || !window.desktopApi) {
        if (!disposed) {
          setDesktopReady(true)
        }
        return
      }

      const [
        context,
        settings,
        downloads,
        logs,
        recovery,
        cachedDiscovery,
        syncHistory,
        shortDramaBatches,
        shortDramaTable,
      ] = await Promise.all([
        window.desktopApi.getContext(),
        window.desktopApi.getSettings(),
        window.desktopApi.getDownloads(),
        window.desktopApi.getDownloadLogs(),
        window.desktopApi.getDownloadRecoverySummary(),
        window.desktopApi.getCachedDiscoveryManifest(),
        window.desktopApi.getDiscoverySyncHistory(),
        window.desktopApi.getShortDramaImportBatches({ limit: 10 }),
        window.desktopApi.getShortDramaTableRows({
          limit: shortDramaTablePageSize,
          offset: 0,
        }),
      ])

      if (disposed) {
        return
      }

      unsubscribeDownloads = window.desktopApi.onDownloadsChanged((tasks) => {
        startTransition(() => {
          setDesktopDownloads(tasks)
        })
      })
      unsubscribeLogs = window.desktopApi.onDownloadLogsChanged((logsPayload) => {
        startTransition(() => {
          setDesktopLogs(logsPayload)
        })
      })

      startTransition(() => {
        setDesktopContext(context)
        setDesktopSettings(settings)
        setSelectedResolution(settings.preferredResolution)
        setDesktopDownloads(downloads)
        setDesktopLogs(logs)
        if (cachedDiscovery) {
          setDiscoveryCache(cachedDiscovery)
        }
        setShortDramaImportBatches(shortDramaBatches)
        setShortDramaTableSnapshot(shortDramaTable)
        setDiscoveryHistory(syncHistory)
        setActionMessage(buildRecoveryMessage(recovery))
        setDesktopReady(true)
      })
    }

    void bootstrapDesktop()

    return () => {
      disposed = true
      unsubscribeDownloads()
      unsubscribeLogs()
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem(manualStorageKey, JSON.stringify(manualSources))
  }, [manualSources])

  useEffect(() => {
    window.localStorage.setItem(libraryStorageKey, JSON.stringify(discoveredSeries))
  }, [discoveredSeries])

  useEffect(() => {
    window.localStorage.setItem(
      discoveryApiConfigKey,
      JSON.stringify(discoveryApiForm),
    )
  }, [discoveryApiForm])

  useEffect(() => {
    window.localStorage.setItem(
      discoverySourcesKey,
      JSON.stringify(discoverySources),
    )
  }, [discoverySources])

  useEffect(() => {
    window.localStorage.setItem(
      discoveryApiCacheKey,
      JSON.stringify(discoveryCache),
    )
  }, [discoveryCache])

  useEffect(() => {
    window.localStorage.setItem(
      discoveryHistoryKey,
      JSON.stringify(discoveryHistory),
    )
  }, [discoveryHistory])

  useEffect(() => {
    if (!desktopContext.isElectron) {
      window.localStorage.setItem(queueStorageKey, JSON.stringify(browserQueue))
    }
  }, [browserQueue, desktopContext.isElectron])

  useEffect(() => {
    if (filteredShortDramaTableRows.length === 0) {
      return
    }

    const exists = filteredShortDramaTableRows.some(
      (item) => `${item.dramaCode}-${item.title}` === selectedShortDramaKey,
    )
    if (!exists) {
      const first = filteredShortDramaTableRows[0]
      setSelectedShortDramaKey(`${first.dramaCode}-${first.title}`)
    }
  }, [filteredShortDramaTableRows, selectedShortDramaKey])

  const maxConcurrentDownloads = Math.max(1, desktopSettings.maxConcurrentDownloads || 1)

  useEffect(() => {
    if (desktopContext.isElectron) {
      return
    }

    const timer = window.setInterval(() => {
      setBrowserQueue((current) => {
        const prepared = current.map((item) => ({ ...item }))
        let activeDownloads = prepared.filter((item) => item.status === '下载中').length

        if (activeDownloads < maxConcurrentDownloads) {
          for (const item of prepared) {
            if (activeDownloads >= maxConcurrentDownloads) {
              break
            }

            if (item.status === '等待中') {
              item.status = '下载中'
              item.progress = item.progress === 0 ? 2 : item.progress
              activeDownloads += 1
            }
          }
        }

        return prepared.map((item) => {
          if (item.status !== '下载中') {
            return item
          }

          const nextProgress = Math.min(item.progress + 10, 100)
          return {
            ...item,
            progress: nextProgress,
            transferredBytes: Math.round((nextProgress / 100) * 1024 * 1024 * 8),
            totalBytes: 1024 * 1024 * 8,
            status: nextProgress >= 100 ? '已完成' : '下载中',
          }
        })
      })
    }, 900)

    return () => window.clearInterval(timer)
  }, [desktopContext.isElectron, maxConcurrentDownloads])

  const queueStats = useMemo(() => {
    const completed = visibleQueue.filter((item) => item.status === '已完成').length
    const downloading = visibleQueue.filter((item) => item.status === '下载中').length
    const waiting = visibleQueue.filter((item) => item.status === '等待中').length
    const paused = visibleQueue.filter((item) => item.status === '已暂停').length
    const failed = visibleQueue.filter((item) => item.status === '失败').length
    return {
      completed,
      downloading,
      waiting,
      paused,
      failed,
      total: visibleQueue.length,
    }
  }, [visibleQueue])

  const logStats = useMemo(() => {
    const info = desktopLogs.filter((item) => item.level === '信息').length
    const warning = desktopLogs.filter((item) => item.level === '警告').length
    const error = desktopLogs.filter((item) => item.level === '错误').length
    return {
      info,
      warning,
      error,
      total: desktopLogs.length,
    }
  }, [desktopLogs])

  const dashboardStats = useMemo(() => {
    const settled = queueStats.completed + queueStats.failed
    const successRate = settled > 0 ? (queueStats.completed / settled) * 100 : 0
    const active = queueStats.downloading + queueStats.waiting + queueStats.paused
    const failedAdapters = new Set(
      visibleQueue
        .filter((item) => item.status === '失败')
        .map((item) => item.adapterId),
    ).size

    return {
      successRate,
      active,
      failedAdapters,
      distinctFailureReasons: new Set(
        visibleQueue
          .filter((item) => item.status === '失败' && item.errorMessage)
          .map((item) => item.errorMessage),
      ).size,
    }
  }, [queueStats, visibleQueue])

  const adapterStats = useMemo(() => {
    const grouped = new Map<
      string,
      {
        adapterId: string
        total: number
        completed: number
        failed: number
        active: number
      }
    >()

    for (const task of visibleQueue) {
      const current =
        grouped.get(task.adapterId) ??
        {
          adapterId: task.adapterId,
          total: 0,
          completed: 0,
          failed: 0,
          active: 0,
        }

      current.total += 1
      if (task.status === '已完成') {
        current.completed += 1
      }
      if (task.status === '失败') {
        current.failed += 1
      }
      if (task.status === '下载中' || task.status === '等待中' || task.status === '已暂停') {
        current.active += 1
      }

      grouped.set(task.adapterId, current)
    }

    return [...grouped.values()].sort((left, right) => {
      if (right.failed !== left.failed) {
        return right.failed - left.failed
      }

      if (right.active !== left.active) {
        return right.active - left.active
      }

      return right.total - left.total
    })
  }, [visibleQueue])

  const failureReasonStats = useMemo(() => {
    const grouped = new Map<
      string,
      {
        message: string
        count: number
        adapterIds: Set<string>
      }
    >()

    for (const task of visibleQueue) {
      if (task.status !== '失败') {
        continue
      }

      const message = task.errorMessage?.trim() || '未记录错误详情'
      const current =
        grouped.get(message) ??
        {
          message,
          count: 0,
          adapterIds: new Set<string>(),
        }

      current.count += 1
      current.adapterIds.add(task.adapterId)
      grouped.set(message, current)
    }

    return [...grouped.values()]
      .map((item) => ({
        message: item.message,
        count: item.count,
        adapters: [...item.adapterIds].sort(),
      }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 6)
  }, [visibleQueue])

  const persistDesktopSettings = async (patch: Partial<DesktopSettings>) => {
    if (!window.desktopApi) {
      setDesktopSettings((current) => ({ ...current, ...patch }))
      return
    }

    const next = await window.desktopApi.updateSettings(patch)
    startTransition(() => {
      setDesktopSettings(next)
    })
  }

  const loadShortDramaTableRows = async (offset = 0) => {
    if (!window.desktopApi || !desktopContext.isElectron) {
      return
    }

    const snapshot = await window.desktopApi.getShortDramaTableRows({
      limit: shortDramaTablePageSize,
      offset,
    })
    startTransition(() => {
      setShortDramaTableSnapshot(snapshot)
    })
  }

  const loadPreviousShortDramaPage = async () => {
    const nextOffset = Math.max(0, shortDramaTableSnapshot.offset - shortDramaTablePageSize)
    await loadShortDramaTableRows(nextOffset)
  }

  const loadNextShortDramaPage = async () => {
    const nextOffset = shortDramaTableSnapshot.offset + shortDramaTablePageSize
    if (nextOffset >= shortDramaTableSnapshot.total) {
      return
    }
    await loadShortDramaTableRows(nextOffset)
  }

  const handleResolutionChange = async (resolution: Resolution) => {
    setSelectedResolution(resolution)

    if (desktopReady && isDesktopShellAvailable()) {
      await persistDesktopSettings({ preferredResolution: resolution })
    }
  }

  const chooseDownloadDirectory = async () => {
    if (!window.desktopApi) {
      return
    }

    const selectedPath = await window.desktopApi.chooseDownloadDirectory()
    if (!selectedPath) {
      return
    }

    startTransition(() => {
      setDesktopSettings((current) => ({
        ...current,
        downloadDirectory: selectedPath,
        updatedAt: new Date().toISOString(),
      }))
    })
  }

  const openDownloadDirectory = async () => {
    if (!window.desktopApi || !desktopSettings.downloadDirectory) {
      return
    }

    await window.desktopApi.openPath(desktopSettings.downloadDirectory)
  }

  const openExternalLink = async (targetUrl: string) => {
    const url = String(targetUrl || '').trim()
    if (!url) {
      return
    }

    if (desktopContext.isElectron && window.desktopApi) {
      const result = await window.desktopApi.openPath(url)
      if (result && result !== '') {
        setActionMessage('打开链接失败，请检查系统默认浏览器设置。')
      }
      return
    }

    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const updateConcurrentDownloads = async (value: number) => {
    const safeValue = Math.min(8, Math.max(1, value || 1))
    setDesktopSettings((current) => ({
      ...current,
      maxConcurrentDownloads: safeValue,
      updatedAt: new Date().toISOString(),
    }))

    if (desktopReady && isDesktopShellAvailable()) {
      await persistDesktopSettings({ maxConcurrentDownloads: safeValue })
    }
  }

  const enqueueEpisodes = async (episodes: Episode[]) => {
    if (!selectedSeries) {
      return
    }

    try {
      const tasks = episodes.map((episode) =>
        resolveEpisodeDownload({
          series: selectedSeries,
          episode,
          resolution: selectedResolution,
          manualSources,
        }),
      )

      if (desktopContext.isElectron && window.desktopApi) {
        await window.desktopApi.enqueueDownloads(tasks)
      } else {
        setBrowserQueue((current) => {
          const dedup = new Set(current.map((item) => item.id))
          const additions = tasks
            .filter((task) => !dedup.has(task.taskId))
            .map((task) => buildBrowserPreviewTask(selectedSeries, episodes.find((item) => item.id === task.episodeId) ?? episodes[0], task.resolution))

          return [...current, ...additions]
        })
      }

      setActionMessage(`已加入 ${tasks.length} 个下载任务。`)
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : '任务加入失败。')
    }
  }

  const handleImport = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!manualForm.title.trim()) {
      setActionMessage('请先填写资源标题。')
      return
    }

    startTransition(() => {
      const nextRecord: ManualSourceRecord = {
        id: `manual-source-${Date.now()}`,
        title: manualForm.title.trim(),
        category: manualForm.category.trim() || '手动导入',
        totalEpisodes: Number(manualForm.totalEpisodes),
        urlTemplate: manualForm.urlTemplate.trim(),
        note: manualForm.note.trim(),
      }

      setManualSources((current) => [nextRecord, ...current])
      setSelectedSeriesId(`manual-${nextRecord.id}`)
      setActiveCategory(nextRecord.category)
      setSearchTerm(nextRecord.title)
      setManualForm(defaultManualForm)
      setActionMessage(
        '手动资源已保存。若填写了直链模板，就可以直接触发真实下载任务。',
      )
    })
  }

  const handleExportManualSources = async () => {
    try {
      const content = stringifyManualSourceManifest(manualSources)
      const fileName = buildManifestFileName()

      if (desktopContext.isElectron && window.desktopApi) {
        const filePath = await window.desktopApi.saveTextFile({
          defaultFileName: fileName,
          content,
        })

        if (!filePath) {
          return
        }

        setActionMessage(`资源清单已导出到 ${filePath}`)
        return
      }

      downloadTextFileInBrowser(fileName, content)
      setActionMessage('资源清单已在浏览器中导出。')
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : '导出资源清单失败。')
    }
  }

  const handleExportDiscoveredSeries = async () => {
    try {
      const content = stringifyDiscoveredSeriesManifest(discoveredSeries)
      const fileName = buildLibraryManifestFileName()

      if (desktopContext.isElectron && window.desktopApi) {
        const filePath = await window.desktopApi.saveTextFile({
          defaultFileName: fileName,
          content,
        })

        if (!filePath) {
          return
        }

        setActionMessage(`资源库清单已导出到 ${filePath}`)
        return
      }

      downloadTextFileInBrowser(fileName, content)
      setActionMessage('资源库清单已在浏览器中导出。')
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : '导出资源库清单失败。')
    }
  }

  const handleImportManualSources = async () => {
    try {
      const rawContent =
        desktopContext.isElectron && window.desktopApi
          ? (await window.desktopApi.openTextFile())?.content ?? null
          : await readTextFileInBrowser()

      if (!rawContent) {
        return
      }

      const imported = parseManualSourceManifest(rawContent)
      startTransition(() => {
        setManualSources((current) => mergeManualSources(current, imported))
        setActiveCategory('全部')
        setSearchTerm('')
      })
      setActionMessage(`已导入 ${imported.length} 条资源定义，按 id 自动合并。`)
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : '导入资源清单失败。')
    }
  }

  const handleImportDiscoveredSeries = async () => {
    try {
      const rawContent =
        desktopContext.isElectron && window.desktopApi
          ? (await window.desktopApi.openTextFile())?.content ?? null
          : await readTextFileInBrowser()

      if (!rawContent) {
        return
      }

      const imported = parseDiscoveredSeriesManifest(rawContent)
      startTransition(() => {
        setDiscoveredSeries((current) => mergeDiscoveredSeries(current, imported))
        setActiveCategory('全部')
        setSearchTerm('')
      })
      await appendDiscoveryHistory({
        sourceName: '本地资源库清单',
        endpointUrl: 'local-file',
        mode: 'file',
        status: '成功',
        itemCount: imported.length,
        message: '从本地 JSON 清单导入资源库。',
      })
      setActionMessage(`已导入 ${imported.length} 条资源库定义，按 id 自动合并。`)
    } catch (error) {
      await appendDiscoveryHistory({
        sourceName: '本地资源库清单',
        endpointUrl: 'local-file',
        mode: 'file',
        status: '失败',
        itemCount: 0,
        message: error instanceof Error ? error.message : '导入资源库清单失败。',
      })
      setActionMessage(error instanceof Error ? error.message : '导入资源库清单失败。')
    }
  }

  const formatShortDramaImportMessage = (summary: ShortDramaImportSummary) =>
    `Excel imported: ${summary.importedRows} (inserted ${summary.insertedRows}, updated ${summary.updatedRows}, removed ${summary.removedRows}, skipped ${summary.skippedRows})`

  const handleImportShortDramaExcel = async () => {
    if (!desktopContext.isElectron || !window.desktopApi) {
      setActionMessage('This feature is only available in desktop mode.')
      return
    }

    try {
      setShortDramaImporting(true)
      const summary = await window.desktopApi.importShortDramaExcel()
      if (!summary) {
        return
      }

      startTransition(() => {
        setActiveCategory('全部')
        setSearchTerm('')
      })

      await appendDiscoveryHistory({
        sourceName: 'Short drama Excel import',
        endpointUrl: summary.filePath,
        mode: 'file',
        status: '成功',
        itemCount: summary.importedRows,
        message: formatShortDramaImportMessage(summary),
      })

      setActionMessage(
        `${formatShortDramaImportMessage(summary)} | DB: ${summary.databasePath}`,
      )

      const latestBatches = await window.desktopApi.getShortDramaImportBatches({
        limit: 10,
      })
      const latestTable = await window.desktopApi.getShortDramaTableRows({
        limit: shortDramaTablePageSize,
        offset: 0,
      })
      startTransition(() => {
        setShortDramaImportBatches(latestBatches)
        setShortDramaTableSnapshot(latestTable)
      })
    } catch (error) {
      await appendDiscoveryHistory({
        sourceName: 'Short drama Excel import',
        endpointUrl: 'local-excel',
        mode: 'file',
        status: '失败',
        itemCount: 0,
        message: error instanceof Error ? error.message : 'Excel import failed.',
      })
      setActionMessage(error instanceof Error ? error.message : 'Excel import failed.')
    } finally {
      setShortDramaImporting(false)
    }
  }

  const saveCurrentDiscoverySource = () => {
    const endpointUrl = discoveryApiForm.endpointUrl.trim()
    if (!endpointUrl) {
      setActionMessage('请先填写内部资源 API 地址，再保存来源配置。')
      return
    }

    let parsedUrl: URL | null = null
    try {
      parsedUrl = new URL(endpointUrl)
    } catch {
      parsedUrl = null
    }

    const nextEntry: DiscoveryEndpointConfig = {
      id: buildDiscoverySourceId(),
      name: parsedUrl ? `${parsedUrl.hostname}${parsedUrl.pathname}` : endpointUrl,
      endpointUrl,
      headersText: discoveryApiForm.headersText,
      lastUsedAt: new Date().toISOString(),
    }

    startTransition(() => {
      setDiscoverySources((current) => {
        const existingIndex = current.findIndex(
          (item) => item.endpointUrl === nextEntry.endpointUrl,
        )

        if (existingIndex >= 0) {
          const updated = [...current]
          updated[existingIndex] = {
            ...updated[existingIndex],
            headersText: nextEntry.headersText,
            lastUsedAt: nextEntry.lastUsedAt,
          }
          return updated
        }

        return [nextEntry, ...current]
      })
    })

    setActionMessage('已保存当前资源发现源配置。')
  }

  const loadDiscoverySource = (source: DiscoveryEndpointConfig) => {
    startTransition(() => {
      setDiscoveryApiForm({
        endpointUrl: source.endpointUrl,
        headersText: source.headersText,
      })
    })
    setActionMessage(`已切换到资源发现源 ${source.name}。`)
  }

  const removeDiscoverySource = (sourceId: string) => {
    startTransition(() => {
      setDiscoverySources((current) => current.filter((item) => item.id !== sourceId))
    })
    setActionMessage('已删除该资源发现源配置。')
  }

  const touchDiscoverySource = (endpointUrl: string, headersText: string) => {
    setDiscoverySources((current) => {
      const existingIndex = current.findIndex((item) => item.endpointUrl === endpointUrl)
      if (existingIndex < 0) {
        return current
      }

      const updated = [...current]
      updated[existingIndex] = {
        ...updated[existingIndex],
        headersText,
        lastUsedAt: new Date().toISOString(),
      }
      return updated
    })
  }

  const appendDiscoveryHistory = async (
    entry: Omit<DiscoverySyncHistoryEntry, 'id' | 'timestamp'> & {
      timestamp?: string
    },
  ) => {
    if (desktopContext.isElectron && window.desktopApi) {
      const next = await window.desktopApi.appendDiscoverySyncHistory(entry)
      startTransition(() => {
        setDiscoveryHistory(next)
      })
      return
    }

    startTransition(() => {
      setDiscoveryHistory((current) => [
        {
          id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
          timestamp: entry.timestamp ?? new Date().toISOString(),
          ...entry,
        },
        ...current,
      ].slice(0, 200))
    })
  }

  const clearDiscoveryHistory = async () => {
    if (desktopContext.isElectron && window.desktopApi) {
      const next = await window.desktopApi.clearDiscoverySyncHistory()
      startTransition(() => {
        setDiscoveryHistory(next)
      })
      setActionMessage('资源发现同步历史已清空。')
      return
    }

    setDiscoveryHistory([])
    setActionMessage('资源发现同步历史已清空。')
  }

  const syncDiscoveredSeriesFromApi = async () => {
    try {
      const endpointUrl = discoveryApiForm.endpointUrl.trim()
      if (!endpointUrl) {
        setActionMessage('请先填写内部资源 API 地址。')
        return
      }

      setDiscoverySyncing(true)
      const headers = parseDiscoveryHeaders(discoveryApiForm.headersText)
      let snapshot: DiscoveryCacheSnapshot

      if (desktopContext.isElectron && window.desktopApi) {
        snapshot = await window.desktopApi.fetchDiscoveryManifest({
          endpointUrl,
          headers,
        })
      } else {
        const response = await fetch(endpointUrl, { headers })
        const content = await response.text()
        if (!response.ok) {
          throw new Error(`拉取资源库失败：HTTP ${response.status}`)
        }

        snapshot = {
          endpointUrl,
          fetchedAt: new Date().toISOString(),
          cachePath: 'browser-localStorage',
          content,
        }
      }

      const imported = parseDiscoveredSeriesManifest(snapshot.content)
      startTransition(() => {
        setDiscoveredSeries((current) => mergeDiscoveredSeries(current, imported))
        setDiscoveryCache(snapshot)
        setActiveCategory('全部')
        setSearchTerm('')
      })
      touchDiscoverySource(endpointUrl, discoveryApiForm.headersText)
      await appendDiscoveryHistory({
        sourceName: endpointUrl,
        endpointUrl,
        mode: 'api',
        status: '成功',
        itemCount: imported.length,
        message: '通过内部 API 同步资源库并写入本地缓存。',
        timestamp: snapshot.fetchedAt,
      })
      setActionMessage(`已从 API 同步 ${imported.length} 条资源库定义，并缓存到本地。`)
    } catch (error) {
      await appendDiscoveryHistory({
        sourceName: discoveryApiForm.endpointUrl.trim() || '未命名来源',
        endpointUrl: discoveryApiForm.endpointUrl.trim(),
        mode: 'api',
        status: '失败',
        itemCount: 0,
        message: error instanceof Error ? error.message : '同步资源库失败。',
      })
      setActionMessage(error instanceof Error ? error.message : '同步资源库失败。')
    } finally {
      setDiscoverySyncing(false)
    }
  }

  const restoreDiscoveredSeriesFromCache = async () => {
    try {
      let snapshot = discoveryCache

      if (desktopContext.isElectron && window.desktopApi) {
        snapshot = await window.desktopApi.getCachedDiscoveryManifest()
      }

      if (!snapshot?.content) {
        setActionMessage('当前没有可恢复的资源库缓存。')
        return
      }

      const imported = parseDiscoveredSeriesManifest(snapshot.content)
      startTransition(() => {
        setDiscoveredSeries((current) => mergeDiscoveredSeries(current, imported))
        setDiscoveryCache(snapshot)
        setActiveCategory('全部')
        setSearchTerm('')
      })
      await appendDiscoveryHistory({
        sourceName: snapshot.endpointUrl || '本地缓存',
        endpointUrl: snapshot.endpointUrl,
        mode: 'cache',
        status: '成功',
        itemCount: imported.length,
        message: '从本地缓存恢复资源库。',
      })
      setActionMessage(`已从本地缓存恢复 ${imported.length} 条资源库定义。`)
    } catch (error) {
      await appendDiscoveryHistory({
        sourceName: discoveryCache?.endpointUrl || '本地缓存',
        endpointUrl: discoveryCache?.endpointUrl || '',
        mode: 'cache',
        status: '失败',
        itemCount: 0,
        message: error instanceof Error ? error.message : '恢复资源库缓存失败。',
      })
      setActionMessage(error instanceof Error ? error.message : '恢复资源库缓存失败。')
    }
  }

  const syncDiscoverySource = async (source: DiscoveryEndpointConfig) => {
    startTransition(() => {
      setDiscoveryApiForm({
        endpointUrl: source.endpointUrl,
        headersText: source.headersText,
      })
    })

    try {
      setDiscoverySyncing(true)
      const headers = parseDiscoveryHeaders(source.headersText)
      let snapshot: DiscoveryCacheSnapshot

      if (desktopContext.isElectron && window.desktopApi) {
        snapshot = await window.desktopApi.fetchDiscoveryManifest({
          endpointUrl: source.endpointUrl,
          headers,
        })
      } else {
        const response = await fetch(source.endpointUrl, { headers })
        const content = await response.text()
        if (!response.ok) {
          throw new Error(`拉取资源库失败：HTTP ${response.status}`)
        }

        snapshot = {
          endpointUrl: source.endpointUrl,
          fetchedAt: new Date().toISOString(),
          cachePath: 'browser-localStorage',
          content,
        }
      }

      const imported = parseDiscoveredSeriesManifest(snapshot.content)
      startTransition(() => {
        setDiscoveredSeries((current) => mergeDiscoveredSeries(current, imported))
        setDiscoveryCache(snapshot)
        setActiveCategory('全部')
        setSearchTerm('')
      })
      touchDiscoverySource(source.endpointUrl, source.headersText)
      await appendDiscoveryHistory({
        sourceName: source.name,
        endpointUrl: source.endpointUrl,
        mode: 'api',
        status: '成功',
        itemCount: imported.length,
        message: '通过已保存资源发现源同步资源库。',
        timestamp: snapshot.fetchedAt,
      })
      setActionMessage(`已通过已保存源 ${source.name} 同步 ${imported.length} 条资源库定义。`)
    } catch (error) {
      await appendDiscoveryHistory({
        sourceName: source.name,
        endpointUrl: source.endpointUrl,
        mode: 'api',
        status: '失败',
        itemCount: 0,
        message: error instanceof Error ? error.message : '同步资源库失败。',
      })
      setActionMessage(error instanceof Error ? error.message : '同步资源库失败。')
    } finally {
      setDiscoverySyncing(false)
    }
  }

  const toggleQueueItem = async (task: DesktopDownloadTask) => {
    if (desktopContext.isElectron && window.desktopApi) {
      if (task.status === '已完成') {
        return
      }

      if (task.status === '已暂停' || task.status === '失败') {
        await window.desktopApi.resumeDownload(task.id)
      } else {
        await window.desktopApi.pauseDownload(task.id)
      }
      return
    }

    setBrowserQueue((current) =>
      current.map((item) => {
        if (item.id !== task.id || item.status === '已完成') {
          return item
        }

        if (item.status === '已暂停' || item.status === '失败') {
          return { ...item, status: '等待中' }
        }

        return { ...item, status: '已暂停' }
      }),
    )
  }

  const clearCompleted = async () => {
    if (desktopContext.isElectron && window.desktopApi) {
      await window.desktopApi.clearCompletedDownloads()
      return
    }

    setBrowserQueue((current) => current.filter((item) => item.status !== '已完成'))
  }

  const retryFailedDownloads = async () => {
    if (desktopContext.isElectron && window.desktopApi) {
      await window.desktopApi.retryFailedDownloads()
      return
    }

    setBrowserQueue((current) =>
      current.map((item) =>
        item.status === '失败'
          ? {
              ...item,
              status: '等待中',
              progress: 0,
              transferredBytes: 0,
              totalBytes: 0,
              errorMessage: '',
            }
          : item,
      ),
    )
  }

  const clearFailedDownloads = async () => {
    if (desktopContext.isElectron && window.desktopApi) {
      await window.desktopApi.clearFailedDownloads()
      return
    }

    setBrowserQueue((current) => current.filter((item) => item.status !== '失败'))
  }

  const exportDownloadLogs = async () => {
    try {
      const content = JSON.stringify(
        {
          version: 1,
          exportedAt: new Date().toISOString(),
          total: desktopLogs.length,
          logs: desktopLogs,
        },
        null,
        2,
      )
      const fileName = buildLogExportFileName()

      if (desktopContext.isElectron && window.desktopApi) {
        const filePath = await window.desktopApi.saveTextFile({
          defaultFileName: fileName,
          content,
        })

        if (!filePath) {
          return
        }

        setActionMessage(`下载日志已导出到 ${filePath}`)
        return
      }

      downloadTextFileInBrowser(fileName, content)
      setActionMessage('下载日志已在浏览器中导出。')
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : '导出下载日志失败。')
    }
  }

  const clearDownloadLogs = async () => {
    if (!window.desktopApi || !desktopContext.isElectron) {
      setDesktopLogs([])
      setActionMessage('浏览器预览模式下已清空日志。')
      return
    }

    await window.desktopApi.clearDownloadLogs()
    setActionMessage('下载日志已清空。')
  }

  const togglePanel = (panel: PanelKey) => {
    setCollapsedPanels((current) => ({
      ...current,
      [panel]: !current[panel],
    }))
  }

  const inspectAdapterTasks = (adapterId: string) => {
    setQueueSearchTerm(adapterId)
    setQueueStatusFilter('全部')
    setActionMessage(`已将任务队列筛选到适配器 ${adapterId}。`)
  }

  const inspectFailureReason = (message: string) => {
    setQueueSearchTerm(message)
    setQueueStatusFilter('失败')
    setActionMessage('已切换到失败任务视图，并按错误信息筛选。')
  }

  const openDownloadFile = async (taskId: string) => {
    if (!window.desktopApi) {
      return
    }

    const result = await window.desktopApi.openDownloadFile(taskId)
    if (result && result !== '') {
      setActionMessage(result === 'missing-file' ? '文件不存在，可能已被移动或删除。' : '打开文件失败。')
    }
  }

  const showDownloadInFolder = async (taskId: string) => {
    if (!window.desktopApi) {
      return
    }

    const success = await window.desktopApi.showDownloadInFolder(taskId)
    if (!success) {
      setActionMessage('无法定位文件，可能尚未下载完成或文件已不存在。')
    }
  }

  return (
    <>
      <div className="shell">
        <header className="topbar">
          <div className="topbar-title">
            <p className="eyebrow">HongGuo Tool Framework</p>
            <h1>短剧资源下载桌面工具</h1>
          </div>
          <div className="topbar-actions">
            <span className={desktopContext.isElectron ? 'pill pill-good' : 'pill pill-warn'}>
              {desktopContext.isElectron ? 'Electron 桌面模式' : '浏览器预览模式'}
            </span>
            <span className="pill">
              {desktopReady ? `并发 ${maxConcurrentDownloads}` : '桌面配置同步中'}
            </span>
            <span className="pill">仅支持授权直链 / 本地文件源</span>
          </div>
        </header>

        <section className="hero-panel">
          <div className="hero-copy">
            <h2>现在只差最后一层适配器实现就能替换下载源</h2>
            <p>
              主界面已经改成“资源展示层 + 下载执行层 + 源适配器层”的结构。
              你后面更换源时，主要补的是适配器里的解析逻辑，不需要再改桌面壳和任务系统。
            </p>
          </div>
          <div className="hero-metrics">
            <div className="metric-card">
              <span>资源条目</span>
              <strong>{displayResourceCount}</strong>
            </div>
            <div className="metric-card">
              <span>任务队列</span>
              <strong>{queueStats.total}</strong>
            </div>
            <div className="metric-card">
              <span>失败 / 暂停</span>
              <strong>{queueStats.failed + queueStats.paused}</strong>
            </div>
          </div>
        </section>

        {actionMessage ? <div className="banner">{actionMessage}</div> : null}

        <section className={hasShortDramaDataset ? 'workspace short-drama-mode' : 'workspace'}>
          <aside className="sidebar">
            <div className="card">
              <label className="section-label" htmlFor="search">
                搜索资源
              </label>
              <input
                id="search"
                className="search-input"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="输入标题、标签或描述"
              />
            </div>

            <div className="card">
              <div className="section-header">
                <span className="section-label">分类浏览</span>
                <span className="section-meta">{displayResourceCount} 条</span>
              </div>
              <div className="category-list">
                {categories.map((category) => (
                  <button
                    key={category}
                    className={category === activeCategory ? 'category active' : 'category'}
                    onClick={() => setActiveCategory(category)}
                  >
                    {category}
                  </button>
                ))}
              </div>
            </div>

            <div className="card tips">
              <span className="section-label">可替换适配器</span>
              <ul>
                {adapterOptions.map((adapter) => (
                  <li key={adapter.id}>
                    <strong>{adapter.name}</strong>：{adapter.description}
                  </li>
                ))}
              </ul>
            </div>
          </aside>

          <main className="catalog-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">资源库</p>
                <h3>{hasShortDramaDataset ? '短剧查询总表' : '短剧列表'}</h3>
              </div>
              {hasShortDramaDataset ? (
                <span className="pill">数据来源：短剧查询 Excel 模板</span>
              ) : (
                <div className="resolution-switch">
                  {(['1080p', '720p'] as Resolution[]).map((resolution) => (
                    <button
                      key={resolution}
                      className={
                        resolution === selectedResolution
                          ? 'resolution active'
                          : 'resolution'
                      }
                      onClick={() => void handleResolutionChange(resolution)}
                    >
                      {resolution}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {!hasShortDramaDataset ? (
              <div className="catalog-list">
                {cardSeries.length === 0 ? (
                  <div className="empty-state">当前筛选条件下没有卡片资源。</div>
                ) : (
                  cardSeries.map((series) => (
                    <button
                      key={series.id}
                      className={
                        selectedSeries?.id === series.id ? 'series-card active' : 'series-card'
                      }
                      onClick={() => setSelectedSeriesId(series.id)}
                    >
                      <div
                        className="poster"
                        style={{ backgroundImage: series.posterGradient }}
                        aria-hidden="true"
                      />
                      <div className="series-body">
                        <div className="series-row">
                          <h4>{series.title}</h4>
                          <span className="status-tag">{series.status}</span>
                        </div>
                        <p>{series.description}</p>
                        <div className="series-meta">
                          <span>{series.category}</span>
                          <span>{series.totalEpisodes} 集</span>
                          <span>{series.adapterId}</span>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            ) : null}

            {desktopContext.isElectron ? (
              <div className="short-drama-table-panel">
                <div className="section-header compact">
                  <div>
                    <p className="eyebrow">短剧查询模板</p>
                    <h4>表格视图</h4>
                  </div>
                  <div className="button-row">
                    <span className="pill">
                      当前页 {filteredShortDramaTableRows.length} /{' '}
                      {shortDramaTableSnapshot.total}
                    </span>
                    <button
                      className="small ghost"
                      onClick={() => void loadPreviousShortDramaPage()}
                      disabled={shortDramaTableSnapshot.offset <= 0}
                    >
                      上一页
                    </button>
                    <button
                      className="small ghost"
                      onClick={() => void loadNextShortDramaPage()}
                      disabled={
                        shortDramaTableSnapshot.offset + shortDramaTableSnapshot.limit >=
                        shortDramaTableSnapshot.total
                      }
                    >
                      下一页
                    </button>
                    <button
                      className="small ghost"
                      onClick={() => void loadShortDramaTableRows(shortDramaTableSnapshot.offset)}
                    >
                      刷新
                    </button>
                  </div>
                </div>
                <div className="short-drama-table-wrap">
                  {filteredShortDramaTableRows.length === 0 ? (
                    <div className="empty-state">暂无表格数据，先执行一次 Excel 导入。</div>
                  ) : (
                    <table className="short-drama-table">
                      <thead>
                        <tr>
                          <th>编号</th>
                          <th>短剧名称</th>
                          <th>夸克</th>
                          <th>百度</th>
                          <th>更新时间</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredShortDramaTableRows.map((row) => (
                          <tr
                            key={`${row.dramaCode}-${row.title}`}
                            className={
                              selectedShortDramaRow &&
                              selectedShortDramaRow.dramaCode === row.dramaCode &&
                              selectedShortDramaRow.title === row.title
                                ? 'active'
                                : ''
                            }
                            onClick={() =>
                              setSelectedShortDramaKey(`${row.dramaCode}-${row.title}`)
                            }
                          >
                            <td>{row.dramaCode || '-'}</td>
                            <td title={row.title}>{row.title}</td>
                            <td>
                              {row.quarkUrl ? (
                                <button
                                  className="small"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    void openExternalLink(row.quarkUrl)
                                  }}
                                >
                                  打开
                                </button>
                              ) : (
                                <span className="section-meta">-</span>
                              )}
                            </td>
                            <td>
                              {row.baiduUrl ? (
                                <button
                                  className="small"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    void openExternalLink(row.baiduUrl)
                                  }}
                                >
                                  打开
                                </button>
                              ) : (
                                <span className="section-meta">-</span>
                              )}
                            </td>
                            <td>{row.updatedAt}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            ) : null}
          </main>

          <section className="detail-panel">
            {hasShortDramaDataset ? (
              selectedShortDramaRow ? (
                <>
                  <div className="detail-head short-drama-detail-head">
                    <div
                      className="detail-poster"
                      style={{ backgroundImage: 'linear-gradient(160deg, #1f2937 0%, #0f766e 100%)' }}
                    />
                    <div>
                      <p className="eyebrow">短剧查询导入</p>
                      <h3>{selectedShortDramaRow.title}</h3>
                      <p className="detail-copy">
                        编号 {selectedShortDramaRow.dramaCode || '-'}，更新时间{' '}
                        {selectedShortDramaRow.updatedAt || '-'}
                      </p>
                      <div className="tag-row">
                        <span className="tag">Excel导入</span>
                        <span className="tag">短剧查询</span>
                        {selectedShortDramaRow.quarkUrl ? <span className="tag">夸克网盘</span> : null}
                        {selectedShortDramaRow.baiduUrl ? <span className="tag">百度网盘</span> : null}
                      </div>
                    </div>
                  </div>

                  <div className="detail-actions">
                    <button
                      className="primary"
                      onClick={() => void openExternalLink(selectedShortDramaRow.quarkUrl)}
                      disabled={!selectedShortDramaRow.quarkUrl}
                    >
                      打开夸克网盘
                    </button>
                    <button
                      className="secondary"
                      onClick={() => void openExternalLink(selectedShortDramaRow.baiduUrl)}
                      disabled={!selectedShortDramaRow.baiduUrl}
                    >
                      打开百度网盘
                    </button>
                  </div>

                  <div className="source-note">
                    夸克网盘：{selectedShortDramaRow.quarkUrl || '-'}
                    <br />
                    百度网盘：{selectedShortDramaRow.baiduUrl || '-'}
                  </div>

                  <div className="short-drama-detail-grid">
                    <article className="episode-row">
                      <div className="episode-meta">
                        <strong>快速定位</strong>
                        <span>将该剧名填入左侧搜索框，定位到相关记录</span>
                      </div>
                      <div className="episode-actions">
                        <button
                          className="small ghost"
                          onClick={() => setSearchTerm(selectedShortDramaRow.title)}
                        >
                          填入搜索
                        </button>
                      </div>
                    </article>
                  </div>
                </>
              ) : (
                <div className="empty-state">暂无选中条目。</div>
              )
            ) : selectedSeries ? (
              <>
                <div className="detail-head">
                  <div
                    className="detail-poster"
                    style={{ backgroundImage: selectedSeries.posterGradient }}
                  />
                  <div>
                    <p className="eyebrow">{selectedSeries.category}</p>
                    <h3>{selectedSeries.title}</h3>
                    <p className="detail-copy">{selectedSeries.description}</p>
                    <div className="tag-row">
                      {selectedSeries.tags.map((tag) => (
                        <span key={tag} className="tag">
                          {tag}
                        </span>
                      ))}
                      <span className="tag">适配器 {selectedSeries.adapterId}</span>
                    </div>
                  </div>
                </div>

                <div className="detail-actions">
                  {selectedSeries.adapterId === shortDramaAdapterId ? (
                    <>
                      <button
                        className="primary"
                        onClick={() => void openExternalLink(selectedShortDramaLinks.quarkUrl)}
                        disabled={!selectedShortDramaLinks.quarkUrl}
                      >
                        打开夸克网盘
                      </button>
                      <button
                        className="secondary"
                        onClick={() => void openExternalLink(selectedShortDramaLinks.baiduUrl)}
                        disabled={!selectedShortDramaLinks.baiduUrl}
                      >
                        打开百度网盘
                      </button>
                    </>
                  ) : (
                    <button
                      className="primary"
                      onClick={() => void enqueueEpisodes(selectedSeries.episodes)}
                    >
                      全部加入队列
                    </button>
                  )}
                  <button className="secondary" onClick={() => void clearCompleted()}>
                    清空已完成
                  </button>
                </div>

                <div className="source-note">{selectedSeries.sourceNote}</div>

                <div className="episode-list">
                  {selectedSeries.episodes.map((episode) => (
                    <article key={episode.id} className="episode-row">
                      <div className="episode-meta">
                        <strong>{episode.title}</strong>
                        <span>{episode.duration}</span>
                        <span>{episode.sizeLabel}</span>
                      </div>
                      <div className="episode-actions">
                        <button
                          className="small ghost"
                          onClick={() => setPreviewEpisode(episode)}
                          disabled={!episode.hasPreview}
                        >
                          预览
                        </button>
                        {selectedSeries.adapterId === shortDramaAdapterId ? (
                          <button
                            className="small"
                            onClick={() =>
                              void openExternalLink(
                                selectedShortDramaLinks.quarkUrl ||
                                  selectedShortDramaLinks.baiduUrl,
                              )
                            }
                            disabled={
                              !selectedShortDramaLinks.quarkUrl &&
                              !selectedShortDramaLinks.baiduUrl
                            }
                          >
                            打开链接
                          </button>
                        ) : (
                          <button
                            className="small"
                            onClick={() => void enqueueEpisodes([episode])}
                          >
                            下载
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty-state">没有匹配的资源，试试切换分类或清空搜索词。</div>
            )}
          </section>
        </section>

        <section className="bottom-grid">
          <div className="queue-panel card">
            <div className="section-header">
              <div>
                <p className="eyebrow">任务中心</p>
                <h3>下载队列</h3>
              </div>
              <div className="queue-stats">
                <span>进行中 {queueStats.downloading}</span>
                <span>等待中 {queueStats.waiting}</span>
                <span>已暂停 {queueStats.paused}</span>
                <span>失败 {queueStats.failed}</span>
              </div>
            </div>

            <div className="button-row">
              <button className="small" onClick={() => void retryFailedDownloads()}>
                重试失败项
              </button>
              <button className="small ghost" onClick={() => void clearFailedDownloads()}>
                清空失败项
              </button>
              <button className="small ghost" onClick={() => void clearCompleted()}>
                清空已完成
              </button>
            </div>

            <div className="queue-tools">
              <input
                className="search-input queue-search"
                value={queueSearchTerm}
                onChange={(event) => setQueueSearchTerm(event.target.value)}
                placeholder="搜索任务标题、文件名、适配器或错误信息"
              />
              <div className="filter-row">
                {queueStatusOptions.map((status) => (
                  <button
                    key={status}
                    className={
                      status === queueStatusFilter ? 'filter-chip active' : 'filter-chip'
                    }
                    onClick={() => setQueueStatusFilter(status)}
                  >
                    {status}
                  </button>
                ))}
              </div>
              <div className="section-meta">
                当前显示 {filteredQueue.length} / {visibleQueue.length} 条任务
              </div>
            </div>

            <div className="queue-list">
              {visibleQueue.length === 0 ? (
                <div className="empty-state">
                  还没有任务，先从左侧资源库加入几集试试。
                </div>
              ) : filteredQueue.length === 0 ? (
                <div className="empty-state">
                  没有匹配的任务，试试清空搜索词或切换状态筛选。
                </div>
              ) : (
                filteredQueue.map((item) => (
                  <article key={item.id} className="queue-row">
                    <div className="queue-head">
                      <div>
                        <strong>
                          {item.seriesTitle} · {item.episodeTitle}
                        </strong>
                        <p>
                          {item.resolution} · {item.adapterId} · {item.fileName}
                        </p>
                      </div>
                      <button className="small ghost" onClick={() => void toggleQueueItem(item)}>
                        {item.status === '已暂停' || item.status === '失败' ? '恢复' : '暂停'}
                      </button>
                    </div>
                    <div className="progress-track">
                      <div
                        className="progress-bar"
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                    <div className="queue-foot">
                      <span>
                        {item.status}
                        {item.errorMessage ? ` · ${item.errorMessage}` : ''}
                      </span>
                      <span>
                        {item.progress}% · {formatBytes(item.transferredBytes)} /{' '}
                        {formatBytes(item.totalBytes)}
                      </span>
                    </div>
                    {desktopContext.isElectron && item.status === '已完成' && item.outputPath ? (
                      <div className="button-row queue-actions">
                        <button
                          className="small"
                          onClick={() => void openDownloadFile(item.id)}
                        >
                          打开文件
                        </button>
                        <button
                          className="small ghost"
                          onClick={() => void showDownloadInFolder(item.id)}
                        >
                          打开所在位置
                        </button>
                      </div>
                    ) : null}
                    {item.outputPath ? <div className="queue-path">{item.outputPath}</div> : null}
                  </article>
                ))
              )}
            </div>
          </div>

          <div className="import-panel card">
            <div className="panel-stack">
              <section
                className={
                  collapsedPanels.desktop
                    ? 'panel-section desktop-panel collapsed'
                    : 'panel-section desktop-panel'
                }
              >
                <div className="section-header">
                  <div>
                    <p className="eyebrow">桌面环境</p>
                    <h3>Electron 工作区</h3>
                  </div>
                  <div className="section-actions">
                    <span className="pill">
                      {desktopContext.platform} · v{desktopContext.version}
                    </span>
                    <button
                      className="collapse-toggle"
                      onClick={() => togglePanel('desktop')}
                    >
                      {collapsedPanels.desktop ? '展开' : '收起'}
                    </button>
                  </div>
                </div>
                <div className="panel-content">
                <div className="info-grid">
                  <article className="info-card">
                    <span>运行模式</span>
                    <strong>{desktopContext.isElectron ? '桌面应用' : '浏览器预览'}</strong>
                  </article>
                  <article className="info-card">
                    <span>下载目录</span>
                    <strong>{desktopSettings.downloadDirectory}</strong>
                  </article>
                  <article className="info-card">
                    <span>配置文件更新时间</span>
                    <strong>{formatUpdatedAt(desktopSettings.updatedAt)}</strong>
                  </article>
                </div>

                <div className="field">
                  <span>用户配置目录</span>
                  <div className="path-box">{desktopContext.userDataPath}</div>
                </div>

                <div className="field">
                  <span>下载目录</span>
                  <div className="path-box">{desktopSettings.downloadDirectory}</div>
                  <div className="button-row">
                    <button
                      className="small"
                      onClick={() => void chooseDownloadDirectory()}
                      disabled={!desktopContext.isElectron}
                    >
                      选择目录
                    </button>
                    <button
                      className="small ghost"
                      onClick={() => void openDownloadDirectory()}
                      disabled={!desktopContext.isElectron}
                    >
                      打开目录
                    </button>
                  </div>
                </div>

                <label className="field">
                  <span>最大并发下载数</span>
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={desktopSettings.maxConcurrentDownloads}
                    onChange={(event) =>
                      void updateConcurrentDownloads(Number(event.target.value))
                    }
                  />
                </label>
                <p className="control-note">
                  下载执行层现在支持暂停后按已下载字节继续。后续只要让适配器返回
                  `sourceUrl` 和文件名即可接入。
                </p>
                </div>
              </section>

              <section
                className={
                  collapsedPanels.stats ? 'panel-section collapsed' : 'panel-section'
                }
              >
                <div className="section-header">
                  <div>
                    <p className="eyebrow">统计面板</p>
                    <h3>下载健康度</h3>
                  </div>
                  <div className="section-actions">
                    <span className="pill">基于当前任务队列实时计算</span>
                    <button
                      className="collapse-toggle"
                      onClick={() => togglePanel('stats')}
                    >
                      {collapsedPanels.stats ? '展开' : '收起'}
                    </button>
                  </div>
                </div>
                <div className="panel-content">
                <div className="info-grid">
                  <article className="info-card">
                    <span>完成成功率</span>
                    <strong>{formatPercent(dashboardStats.successRate)}</strong>
                  </article>
                  <article className="info-card">
                    <span>活跃任务</span>
                    <strong>{dashboardStats.active}</strong>
                  </article>
                  <article className="info-card">
                    <span>失败适配器数</span>
                    <strong>{dashboardStats.failedAdapters}</strong>
                  </article>
                  <article className="info-card">
                    <span>失败原因数</span>
                    <strong>{dashboardStats.distinctFailureReasons}</strong>
                  </article>
                </div>

                <div className="stats-grid">
                  <div className="stats-card">
                    <div className="section-header compact">
                      <div>
                        <span className="section-label">适配器表现</span>
                      </div>
                      <span className="section-meta">按失败数优先排序</span>
                    </div>
                    <div className="stats-list">
                      {adapterStats.length === 0 ? (
                        <div className="empty-state">还没有任务，适配器统计会在加入队列后出现。</div>
                      ) : (
                        adapterStats.map((item) => (
                          <article key={item.adapterId} className="stats-row">
                            <div>
                              <strong>{item.adapterId}</strong>
                              <p>
                                共 {item.total} 条 · 完成 {item.completed} · 失败 {item.failed} · 活跃 {item.active}
                              </p>
                            </div>
                            <button
                              className="small ghost"
                              onClick={() => inspectAdapterTasks(item.adapterId)}
                            >
                              查看任务
                            </button>
                          </article>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="stats-card">
                    <div className="section-header compact">
                      <div>
                        <span className="section-label">高频失败原因</span>
                      </div>
                      <span className="section-meta">取当前失败任务前 6 项</span>
                    </div>
                    <div className="stats-list">
                      {failureReasonStats.length === 0 ? (
                        <div className="empty-state">当前没有失败任务，失败原因统计为空。</div>
                      ) : (
                        failureReasonStats.map((item) => (
                          <article key={item.message} className="stats-row">
                            <div>
                              <strong>{item.message}</strong>
                              <p>
                                {item.count} 条失败 · 适配器 {item.adapters.join('、')}
                              </p>
                            </div>
                            <button
                              className="small ghost"
                              onClick={() => inspectFailureReason(item.message)}
                            >
                              查看失败项
                            </button>
                          </article>
                        ))
                      )}
                    </div>
                  </div>
                </div>
                </div>
              </section>

              <section
                className={
                  collapsedPanels.discovery ? 'panel-section collapsed' : 'panel-section'
                }
              >
                <div className="section-header">
                  <div>
                    <p className="eyebrow">资源发现</p>
                    <h3>导入本地资源库清单</h3>
                  </div>
                  <div className="section-actions">
                    <span className="pill">本地 JSON + 内部 HTTP API</span>
                    <button
                      className="collapse-toggle"
                      onClick={() => togglePanel('discovery')}
                    >
                      {collapsedPanels.discovery ? '展开' : '收起'}
                    </button>
                  </div>
                </div>
                <div className="panel-content">
                <div className="button-row">
                  <button
                    className="small"
                    onClick={() => void handleImportShortDramaExcel()}
                    disabled={!desktopContext.isElectron || shortDramaImporting}
                  >
                    {shortDramaImporting ? '导入中...' : '导入短剧查询 Excel'}
                  </button>
                  <button className="small" onClick={() => void handleImportDiscoveredSeries()}>
                    导入资源库清单
                  </button>
                  <button className="small ghost" onClick={() => void handleExportDiscoveredSeries()}>
                    导出资源库清单
                  </button>
                  <span className="pill">当前 {discoveredSeries.length} 条发现资源</span>
                </div>
                {shortDramaImportBatches.length > 0 ? (
                  <p className="hint">
                    最近导入：
                    {new Date(shortDramaImportBatches[0].imported_at).toLocaleString(
                      'zh-CN',
                      { hour12: false },
                    )}
                    ，新增 {shortDramaImportBatches[0].inserted_rows}，更新{' '}
                    {shortDramaImportBatches[0].updated_rows}，移除{' '}
                    {shortDramaImportBatches[0].removed_rows}
                  </p>
                ) : null}

                <div className="import-form">
                  <label className="field">
                    <span>内部资源 API 地址</span>
                    <input
                      value={discoveryApiForm.endpointUrl}
                      onChange={(event) =>
                        setDiscoveryApiForm((current) => ({
                          ...current,
                          endpointUrl: event.target.value,
                        }))
                      }
                      placeholder="例如：https://intranet.example.com/api/resource-library"
                    />
                  </label>

                  <label className="field">
                    <span>请求头 JSON</span>
                    <textarea
                      value={discoveryApiForm.headersText}
                      onChange={(event) =>
                        setDiscoveryApiForm((current) => ({
                          ...current,
                          headersText: event.target.value,
                        }))
                      }
                      placeholder={'{\n  "Authorization": "Bearer your-token"\n}'}
                    />
                  </label>

                  <div className="button-row">
                    <button
                      className="small"
                      onClick={() => void syncDiscoveredSeriesFromApi()}
                      disabled={discoverySyncing}
                    >
                      {discoverySyncing ? '同步中...' : '从 API 同步'}
                    </button>
                    <button
                      className="small ghost"
                      onClick={() => saveCurrentDiscoverySource()}
                    >
                      保存为来源
                    </button>
                    <button
                      className="small ghost"
                      onClick={() => void restoreDiscoveredSeriesFromCache()}
                    >
                      从缓存恢复
                    </button>
                  </div>
                </div>

                {discoveryCache ? (
                  <div className="info-grid">
                    <article className="info-card">
                      <span>最近同步时间</span>
                      <strong>{formatUpdatedAt(discoveryCache.fetchedAt)}</strong>
                    </article>
                    <article className="info-card">
                      <span>最近同步地址</span>
                      <strong>{discoveryCache.endpointUrl}</strong>
                    </article>
                    <article className="info-card">
                      <span>缓存位置</span>
                      <strong>{discoveryCache.cachePath}</strong>
                    </article>
                  </div>
                ) : null}

                <div className="stats-card">
                  <div className="section-header compact">
                    <div>
                      <span className="section-label">已保存的资源发现源</span>
                    </div>
                    <span className="section-meta">共 {sortedDiscoverySources.length} 个</span>
                  </div>
                  <div className="stats-list">
                    {sortedDiscoverySources.length === 0 ? (
                      <div className="empty-state">
                        还没有保存的来源配置。先填写 API 地址和请求头，再点“保存为来源”。
                      </div>
                    ) : (
                      sortedDiscoverySources.map((source) => (
                        <article key={source.id} className="stats-row">
                          <div>
                            <strong>{source.name}</strong>
                            <p>{source.endpointUrl}</p>
                            <p>最近使用：{formatUpdatedAt(source.lastUsedAt)}</p>
                          </div>
                          <div className="button-row inline-actions">
                            <button
                              className="small ghost"
                              onClick={() => loadDiscoverySource(source)}
                            >
                              载入
                            </button>
                            <button
                              className="small"
                              onClick={() => void syncDiscoverySource(source)}
                              disabled={discoverySyncing}
                            >
                              同步
                            </button>
                            <button
                              className="small ghost"
                              onClick={() => removeDiscoverySource(source.id)}
                            >
                              删除
                            </button>
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                </div>

                <div className="stats-card">
                  <div className="section-header compact">
                    <div>
                      <span className="section-label">同步历史</span>
                    </div>
                    <div className="queue-stats">
                      <span>成功 {discoveryHistoryStats.success}</span>
                      <span>失败 {discoveryHistoryStats.failed}</span>
                    </div>
                  </div>
                  <div className="button-row">
                    <span className="pill">共 {discoveryHistoryStats.total} 条</span>
                    <button
                      className="small ghost"
                      onClick={() => void clearDiscoveryHistory()}
                      disabled={discoveryHistoryStats.total === 0}
                    >
                      清空历史
                    </button>
                  </div>
                  <div className="stats-list">
                    {discoveryHistory.length === 0 ? (
                      <div className="empty-state">
                        还没有同步历史。导入本地清单、从缓存恢复或从 API 同步后，这里会记录结果。
                      </div>
                    ) : (
                      discoveryHistory.map((item) => (
                        <article key={item.id} className="stats-row">
                          <div>
                            <strong>
                              {item.sourceName} · {formatSyncMode(item.mode)} · {item.status}
                            </strong>
                            <p>{item.endpointUrl || 'local-file'}</p>
                            <p>
                              {formatUpdatedAt(item.timestamp)} · 条目数 {item.itemCount}
                            </p>
                            <p>{item.message}</p>
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                </div>

                <div className="source-note">
                  资源发现层适合一次导入多部剧的元数据与集列表。清单里只放你有权使用的资源定义，
                  实际下载地址仍由适配器层解析，和下载执行层保持解耦。
                </div>
                </div>
              </section>

              <section
                className={
                  collapsedPanels.manual ? 'panel-section collapsed' : 'panel-section'
                }
              >
                <div className="section-header">
                  <div>
                    <p className="eyebrow">资源适配</p>
                    <h3>手动导入合法资源</h3>
                  </div>
                  <div className="section-actions">
                    <span className="pill">模板令牌可替换</span>
                    <button
                      className="collapse-toggle"
                      onClick={() => togglePanel('manual')}
                    >
                      {collapsedPanels.manual ? '展开' : '收起'}
                    </button>
                  </div>
                </div>
                <div className="panel-content">
                <div className="button-row">
                  <button className="small" onClick={() => void handleImportManualSources()}>
                    导入资源清单
                  </button>
                  <button className="small ghost" onClick={() => void handleExportManualSources()}>
                    导出资源清单
                  </button>
                  <span className="pill">当前 {manualSources.length} 条手动资源</span>
                </div>

                <form className="import-form" onSubmit={handleImport}>
                  <label className="field">
                    <span>资源标题</span>
                    <input
                      value={manualForm.title}
                      onChange={(event) =>
                        setManualForm((current) => ({
                          ...current,
                          title: event.target.value,
                        }))
                      }
                      placeholder="例如：自有样片合集"
                    />
                  </label>

                  <div className="split">
                    <label className="field">
                      <span>分类</span>
                      <input
                        value={manualForm.category}
                        onChange={(event) =>
                          setManualForm((current) => ({
                            ...current,
                            category: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="field">
                      <span>总集数</span>
                      <input
                        type="number"
                        min={1}
                        max={200}
                        value={manualForm.totalEpisodes}
                        onChange={(event) =>
                          setManualForm((current) => ({
                            ...current,
                            totalEpisodes: Number(event.target.value),
                          }))
                        }
                      />
                    </label>
                  </div>

                  <label className="field">
                    <span>URL 模板或本地文件模板</span>
                    <textarea
                      value={manualForm.urlTemplate}
                      onChange={(event) =>
                        setManualForm((current) => ({
                          ...current,
                          urlTemplate: event.target.value,
                        }))
                      }
                      placeholder="例如：https://example.com/drama/{episode}.mp4 或 D:\media\clip-{episode}.mp4"
                    />
                  </label>

                  <div className="token-grid">
                    <span className="token">{'{episode}'}</span>
                    <span className="token">{'{episodeIndex}'}</span>
                    <span className="token">{'{seriesId}'}</span>
                    <span className="token">{'{seriesTitle}'}</span>
                    <span className="token">{'{episodeTitle}'}</span>
                    <span className="token">{'{resolution}'}</span>
                  </div>

                  <label className="field">
                    <span>补充备注</span>
                    <textarea
                      value={manualForm.note}
                      onChange={(event) =>
                        setManualForm((current) => ({ ...current, note: event.target.value }))
                      }
                      placeholder="例如：仅团队内部测试使用。"
                    />
                  </label>

                  <button className="primary submit" type="submit">
                    保存到资源库
                  </button>
                </form>
                </div>
              </section>

              <section
                className={
                  collapsedPanels.logs ? 'panel-section collapsed' : 'panel-section'
                }
              >
                <div className="section-header">
                  <div>
                    <p className="eyebrow">日志中心</p>
                    <h3>下载日志</h3>
                  </div>
                  <div className="section-actions">
                    <div className="queue-stats">
                      <span>信息 {logStats.info}</span>
                      <span>警告 {logStats.warning}</span>
                      <span>错误 {logStats.error}</span>
                    </div>
                    <button
                      className="collapse-toggle"
                      onClick={() => togglePanel('logs')}
                    >
                      {collapsedPanels.logs ? '展开' : '收起'}
                    </button>
                  </div>
                </div>
                <div className="panel-content">
                <div className="button-row">
                  <button
                    className="small"
                    onClick={() => void exportDownloadLogs()}
                    disabled={desktopLogs.length === 0}
                  >
                    导出日志
                  </button>
                  <button
                    className="small ghost"
                    onClick={() => void clearDownloadLogs()}
                    disabled={desktopLogs.length === 0}
                  >
                    清空日志
                  </button>
                  <span className="pill">当前 {filteredLogs.length} / {logStats.total} 条</span>
                </div>

                <div className="queue-tools">
                  <input
                    className="search-input queue-search"
                    value={logSearchTerm}
                    onChange={(event) => setLogSearchTerm(event.target.value)}
                    placeholder="搜索标题、文件名、适配器、输出路径或日志内容"
                  />
                  <div className="filter-row">
                    {logLevelOptions.map((level) => (
                      <button
                        key={level}
                        className={
                          level === logLevelFilter ? 'filter-chip active' : 'filter-chip'
                        }
                        onClick={() => setLogLevelFilter(level)}
                      >
                        {level}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="log-list">
                  {!desktopContext.isElectron ? (
                    <div className="empty-state">
                      浏览器预览模式下不写入持久化下载日志，请在 Electron 桌面环境查看。
                    </div>
                  ) : desktopLogs.length === 0 ? (
                    <div className="empty-state">
                      还没有日志。加入下载任务、暂停恢复或失败重试后，这里会记录关键事件。
                    </div>
                  ) : filteredLogs.length === 0 ? (
                    <div className="empty-state">
                      没有匹配的日志，试试清空搜索词或切换日志级别筛选。
                    </div>
                  ) : (
                    filteredLogs.map((item) => (
                      <article key={item.id} className="log-row">
                        <div className="log-head">
                          <div>
                            <strong>
                              {item.seriesTitle} · {item.episodeTitle}
                            </strong>
                            <p>
                              {item.adapterId} · {item.fileName}
                            </p>
                          </div>
                          <span className="pill log-pill" data-level={item.level}>
                            {item.level}
                          </span>
                        </div>
                        <div className="log-message">{item.message}</div>
                        <div className="queue-foot">
                          <span>
                            {item.status} · {formatLogTime(item.timestamp)}
                          </span>
                          <span>{item.taskId}</span>
                        </div>
                        {item.outputPath ? <div className="queue-path">{item.outputPath}</div> : null}
                      </article>
                    ))
                  )}
                </div>
                </div>
              </section>
            </div>
          </div>
        </section>
      </div>

      {previewEpisode ? (
        <div className="modal-backdrop" onClick={() => setPreviewEpisode(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-header">
              <div>
                <p className="eyebrow">预览窗口</p>
                <h3>{previewEpisode.title}</h3>
              </div>
              <button className="small ghost" onClick={() => setPreviewEpisode(null)}>
                关闭
              </button>
            </div>
            <video controls className="preview-player" src={previewVideoUrl} />
            <p className="modal-note">
              当前预览使用公共演示视频占位，只验证播放器弹窗和交互结构。
            </p>
          </div>
        </div>
      ) : null}
    </>
  )
}

export default App

