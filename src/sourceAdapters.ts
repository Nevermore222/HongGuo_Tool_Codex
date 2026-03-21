import { mockCatalog } from './catalog'
import type { Episode, Resolution, Series } from './catalog'

export type ManualSourceRecord = {
  id: string
  title: string
  category: string
  totalEpisodes: number
  urlTemplate: string
  note: string
}

export type DirectDownloadDescriptor = {
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

export type AdapterDefinition = {
  id: string
  name: string
  description: string
  resolveEpisodeDownload: (input: {
    series: Series
    episode: Episode
    resolution: Resolution
    manualSources: ManualSourceRecord[]
  }) => DirectDownloadDescriptor
}

const previewSampleUrl =
  'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'

const replaceTemplateTokens = (
  template: string,
  series: Series,
  episode: Episode,
  resolution: Resolution,
) =>
  template
    .replaceAll('{seriesId}', series.sourceId)
    .replaceAll('{seriesTitle}', series.title)
    .replaceAll('{episode}', String(episode.index))
    .replaceAll('{episodeIndex}', String(episode.index))
    .replaceAll('{episodeTitle}', episode.title)
    .replaceAll('{resolution}', resolution)

const invalidFileNameCharacters = new Set([
  '<',
  '>',
  ':',
  '"',
  '/',
  '\\',
  '|',
  '?',
  '*',
])

const sanitizeFileName = (value: string) =>
  Array.from(value)
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      if (invalidFileNameCharacters.has(character) || codePoint < 32) {
        return '_'
      }
      return character
    })
    .join('')

export const buildManualSeries = (record: ManualSourceRecord): Series => ({
  id: `manual-${record.id}`,
  adapterId: 'manual-template',
  sourceId: record.id,
  title: record.title.trim(),
  category: record.category.trim() || '手动导入',
  status: '手动导入',
  description:
    '你手动录入的合法资源。界面层只保存模板与元信息，实际下载由适配器解析为直链任务。',
  tags: ['手动导入', '本地配置'],
  totalEpisodes: Number(record.totalEpisodes),
  updatedAt: '刚刚',
  posterGradient: 'linear-gradient(160deg, #0f172a 0%, #1d4ed8 100%)',
  sourceNote: record.note.trim() || record.urlTemplate.trim() || '未填写资源说明',
  episodes: Array.from({ length: Number(record.totalEpisodes) }, (_, index) => ({
    id: `${record.id}-${index + 1}`,
    adapterId: 'manual-template',
    sourceId: `${record.id}:${index + 1}`,
    index: index + 1,
    title: `第${index + 1}集`,
    duration: '待补充',
    sizeLabel: '待获取',
    hasPreview: false,
  })),
})

const demoAdapter: AdapterDefinition = {
  id: 'demo-library',
  name: '演示源适配器',
  description: '返回公开演示视频直链，用于验证真实下载链路。',
  resolveEpisodeDownload: ({ series, episode, resolution }) => ({
    taskId: `task-${series.id}-${episode.id}-${resolution}`,
    adapterId: 'demo-library',
    seriesId: series.id,
    seriesTitle: series.title,
    episodeId: episode.id,
    episodeTitle: episode.title,
    resolution,
    sourceUrl: previewSampleUrl,
    fileName: sanitizeFileName(`${series.title}-${episode.title}-${resolution}.mp4`),
  }),
}

const manualTemplateAdapter: AdapterDefinition = {
  id: 'manual-template',
  name: '手动模板适配器',
  description:
    '把手动录入的 URL 模板解析成最终下载直链，是后续替换下载源的主要接口层。',
  resolveEpisodeDownload: ({ series, episode, resolution, manualSources }) => {
    const sourceRecord = manualSources.find((item) => item.id === series.sourceId)

    if (!sourceRecord?.urlTemplate.trim()) {
      throw new Error('当前手动资源还没有填写可下载的直链模板。')
    }

    const sourceUrl = replaceTemplateTokens(
      sourceRecord.urlTemplate.trim(),
      series,
      episode,
      resolution,
    )

    return {
      taskId: `task-${series.id}-${episode.id}-${resolution}`,
      adapterId: 'manual-template',
      seriesId: series.id,
      seriesTitle: series.title,
      episodeId: episode.id,
      episodeTitle: episode.title,
      resolution,
      sourceUrl,
      fileName: sanitizeFileName(`${series.title}-${episode.title}-${resolution}.mp4`),
    }
  },
}

export const adapterRegistry: Record<string, AdapterDefinition> = {
  [demoAdapter.id]: demoAdapter,
  [manualTemplateAdapter.id]: manualTemplateAdapter,
}

export const getCatalogFromAdapters = (manualSources: ManualSourceRecord[]): Series[] => [
  ...manualSources.map(buildManualSeries),
  ...mockCatalog,
]

export const getAdapterOptions = () =>
  Object.values(adapterRegistry).map((adapter) => ({
    id: adapter.id,
    name: adapter.name,
    description: adapter.description,
  }))

export const resolveEpisodeDownload = (input: {
  series: Series
  episode: Episode
  resolution: Resolution
  manualSources: ManualSourceRecord[]
}) => {
  const adapter = adapterRegistry[input.series.adapterId]

  if (!adapter) {
    throw new Error(`未找到适配器: ${input.series.adapterId}`)
  }

  return adapter.resolveEpisodeDownload(input)
}
