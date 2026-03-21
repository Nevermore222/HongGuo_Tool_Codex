import { useDeferredValue, useEffect, useMemo, useState, startTransition } from 'react'
import './App.css'
import { mockCatalog } from './catalog'
import {
  fallbackDesktopContext,
  fallbackDesktopSettings,
  isDesktopShellAvailable,
} from './desktop'
import type { Episode, Resolution, Series } from './catalog'
import type { DesktopContext, DesktopSettings } from './desktop'
import type { FormEvent } from 'react'

type QueueStatus = '等待中' | '下载中' | '已完成' | '已暂停'

type QueueItem = {
  id: string
  seriesId: string
  seriesTitle: string
  episodeId: string
  episodeTitle: string
  resolution: Resolution
  progress: number
  status: QueueStatus
  sourceType: 'mock' | 'manual'
}

type ManualSourceForm = {
  title: string
  category: string
  totalEpisodes: number
  urlTemplate: string
  note: string
}

const queueStorageKey = 'hongguo-tool-framework-queue'
const manualStorageKey = 'hongguo-tool-framework-manual'
const previewVideoUrl =
  'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'

const defaultManualForm: ManualSourceForm = {
  title: '',
  category: '手动导入',
  totalEpisodes: 12,
  urlTemplate: '',
  note: '',
}

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

const categories = ['全部', ...new Set(mockCatalog.map((item) => item.category)), '手动导入']

const buildManualSeries = (form: ManualSourceForm): Series => ({
  id: `manual-${Date.now()}`,
  title: form.title.trim(),
  category: form.category.trim() || '手动导入',
  status: '手动导入',
  description: '你手动录入的合法资源，仅在本地保存元信息，不包含任何平台解析逻辑。',
  tags: ['手动导入', '本地配置'],
  totalEpisodes: Number(form.totalEpisodes),
  updatedAt: '刚刚',
  posterGradient: 'linear-gradient(160deg, #0f172a 0%, #1d4ed8 100%)',
  sourceNote: form.note.trim() || form.urlTemplate.trim() || '未填写资源说明',
  episodes: Array.from({ length: Number(form.totalEpisodes) }, (_, index) => ({
    id: `manual-${Date.now()}-${index + 1}`,
    index: index + 1,
    title: `第${index + 1}集`,
    duration: '待补充',
    sizeLabel: '待获取',
    hasPreview: false,
  })),
})

const formatUpdatedAt = (value: string) =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未同步'

function App() {
  const [desktopContext, setDesktopContext] =
    useState<DesktopContext>(fallbackDesktopContext)
  const [desktopSettings, setDesktopSettings] =
    useState<DesktopSettings>(fallbackDesktopSettings)
  const [desktopReady, setDesktopReady] = useState(false)
  const [manualSeries, setManualSeries] = useState<Series[]>(() =>
    readStorage(manualStorageKey, []),
  )
  const [queue, setQueue] = useState<QueueItem[]>(() =>
    readStorage(queueStorageKey, []),
  )
  const [activeCategory, setActiveCategory] = useState('全部')
  const [searchTerm, setSearchTerm] = useState('')
  const deferredSearch = useDeferredValue(searchTerm.trim().toLowerCase())
  const [selectedResolution, setSelectedResolution] =
    useState<Resolution>(fallbackDesktopSettings.preferredResolution)
  const [selectedSeriesId, setSelectedSeriesId] = useState<string>(
    mockCatalog[0].id,
  )
  const [previewEpisode, setPreviewEpisode] = useState<Episode | null>(null)
  const [manualForm, setManualForm] = useState<ManualSourceForm>(defaultManualForm)

  const allSeries = useMemo(
    () => [...manualSeries, ...mockCatalog],
    [manualSeries],
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

  const selectedSeries =
    filteredSeries.find((item) => item.id === selectedSeriesId) ??
    allSeries.find((item) => item.id === selectedSeriesId) ??
    filteredSeries[0] ??
    allSeries[0]

  useEffect(() => {
    let disposed = false

    const bootstrapDesktop = async () => {
      if (!isDesktopShellAvailable() || !window.desktopApi) {
        if (!disposed) {
          setDesktopReady(true)
        }
        return
      }

      const [context, settings] = await Promise.all([
        window.desktopApi.getContext(),
        window.desktopApi.getSettings(),
      ])

      if (disposed) {
        return
      }

      startTransition(() => {
        setDesktopContext(context)
        setDesktopSettings(settings)
        setSelectedResolution(settings.preferredResolution)
        setDesktopReady(true)
      })
    }

    void bootstrapDesktop()

    return () => {
      disposed = true
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem(queueStorageKey, JSON.stringify(queue))
  }, [queue])

  useEffect(() => {
    window.localStorage.setItem(manualStorageKey, JSON.stringify(manualSeries))
  }, [manualSeries])

  const maxConcurrentDownloads = Math.max(1, desktopSettings.maxConcurrentDownloads || 1)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setQueue((current) => {
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
            status: nextProgress >= 100 ? '已完成' : '下载中',
          }
        })
      })
    }, 900)

    return () => window.clearInterval(timer)
  }, [maxConcurrentDownloads])

  const queueStats = useMemo(() => {
    const completed = queue.filter((item) => item.status === '已完成').length
    const downloading = queue.filter((item) => item.status === '下载中').length
    const waiting = queue.filter((item) => item.status === '等待中').length
    const paused = queue.filter((item) => item.status === '已暂停').length
    return {
      completed,
      downloading,
      waiting,
      paused,
      total: queue.length,
    }
  }, [queue])

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

  const appendEpisodes = (episodes: Episode[], sourceType: 'mock' | 'manual') => {
    if (!selectedSeries) {
      return
    }

    setQueue((current) => {
      const dedup = new Set(
        current.map((item) => `${item.seriesId}:${item.episodeId}:${item.resolution}`),
      )
      const additions = episodes
        .filter(
          (episode) =>
            !dedup.has(`${selectedSeries.id}:${episode.id}:${selectedResolution}`),
        )
        .map<QueueItem>((episode) => ({
          id: `queue-${selectedSeries.id}-${episode.id}-${selectedResolution}`,
          seriesId: selectedSeries.id,
          seriesTitle: selectedSeries.title,
          episodeId: episode.id,
          episodeTitle: episode.title,
          resolution: selectedResolution,
          progress: 0,
          status: '等待中',
          sourceType,
        }))

      return [...current, ...additions]
    })
  }

  const handleImport = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!manualForm.title.trim()) {
      return
    }

    startTransition(() => {
      const next = buildManualSeries(manualForm)
      setManualSeries((current) => [next, ...current])
      setSelectedSeriesId(next.id)
      setActiveCategory('手动导入')
      setSearchTerm(next.title)
      setManualForm(defaultManualForm)
    })
  }

  const toggleQueueItem = (itemId: string) => {
    setQueue((current) =>
      current.map((item) => {
        if (item.id !== itemId || item.status === '已完成') {
          return item
        }

        if (item.status === '已暂停') {
          return { ...item, status: '等待中' }
        }

        return { ...item, status: '已暂停' }
      }),
    )
  }

  const clearCompleted = () => {
    setQueue((current) => current.filter((item) => item.status !== '已完成'))
  }

  return (
    <>
      <div className="shell">
        <header className="topbar">
          <div>
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
            <span className="pill">仅支持演示数据 / 手动合法资源</span>
          </div>
        </header>

        <section className="hero-panel">
          <div className="hero-copy">
            <h2>前端工作台已经升级成桌面壳骨架</h2>
            <p>
              现在除了原来的资源库、任务队列和预览交互，已经接上了
              Electron 主进程、原生目录选择、桌面配置文件持久化和打开下载目录。
            </p>
          </div>
          <div className="hero-metrics">
            <div className="metric-card">
              <span>资源条目</span>
              <strong>{allSeries.length}</strong>
            </div>
            <div className="metric-card">
              <span>任务队列</span>
              <strong>{queueStats.total}</strong>
            </div>
            <div className="metric-card">
              <span>已完成</span>
              <strong>{queueStats.completed}</strong>
            </div>
          </div>
        </section>

        <section className="workspace">
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
                <span className="section-meta">{filteredSeries.length} 条</span>
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
              <span className="section-label">桌面化方向</span>
              <ul>
                <li>窗口和原生系统能力由 Electron 主进程接管。</li>
                <li>下载目录、默认分辨率和并发数写入用户配置目录。</li>
                <li>后续如果接合法下载引擎，可以直接复用当前 IPC 结构。</li>
              </ul>
            </div>
          </aside>

          <main className="catalog-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">资源库</p>
                <h3>短剧列表</h3>
              </div>
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
            </div>

            <div className="catalog-list">
              {filteredSeries.map((series) => (
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
                      <span>{series.updatedAt}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </main>

          <section className="detail-panel">
            {selectedSeries ? (
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
                    </div>
                  </div>
                </div>

                <div className="detail-actions">
                  <button
                    className="primary"
                    onClick={() =>
                      appendEpisodes(
                        selectedSeries.episodes,
                        selectedSeries.status === '手动导入' ? 'manual' : 'mock',
                      )
                    }
                  >
                    全部加入队列
                  </button>
                  <button className="secondary" onClick={clearCompleted}>
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
                        <button
                          className="small"
                          onClick={() =>
                            appendEpisodes(
                              [episode],
                              selectedSeries.status === '手动导入' ? 'manual' : 'mock',
                            )
                          }
                        >
                          下载
                        </button>
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
              </div>
            </div>

            <div className="queue-list">
              {queue.length === 0 ? (
                <div className="empty-state">
                  还没有任务，先从左侧资源库加入几集试试。
                </div>
              ) : (
                queue.map((item) => (
                  <article key={item.id} className="queue-row">
                    <div className="queue-head">
                      <div>
                        <strong>
                          {item.seriesTitle} · {item.episodeTitle}
                        </strong>
                        <p>
                          {item.resolution} · {item.sourceType === 'mock' ? '演示源' : '手动源'}
                        </p>
                      </div>
                      <button className="small ghost" onClick={() => toggleQueueItem(item.id)}>
                        {item.status === '已暂停' ? '恢复' : '暂停'}
                      </button>
                    </div>
                    <div className="progress-track">
                      <div
                        className="progress-bar"
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                    <div className="queue-foot">
                      <span>{item.status}</span>
                      <span>{item.progress}%</span>
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>

          <div className="import-panel card">
            <div className="panel-stack">
              <section className="desktop-panel">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">桌面环境</p>
                    <h3>Electron 工作区</h3>
                  </div>
                  <span className="pill">
                    {desktopContext.platform} · v{desktopContext.version}
                  </span>
                </div>

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
                  当前队列模拟器已经会按照这个并发数推进任务，后续可直接复用到真实下载执行层。
                </p>
              </section>

              <section>
                <div className="section-header">
                  <div>
                    <p className="eyebrow">资源适配</p>
                    <h3>手动导入合法资源</h3>
                  </div>
                  <span className="pill">本地持久化</span>
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
                    <span>资源模板或说明</span>
                    <textarea
                      value={manualForm.urlTemplate}
                      onChange={(event) =>
                        setManualForm((current) => ({
                          ...current,
                          urlTemplate: event.target.value,
                        }))
                      }
                      placeholder="填写你有权使用的 MP4/M3U8 直链模板，或先写备注占位。"
                    />
                  </label>

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
