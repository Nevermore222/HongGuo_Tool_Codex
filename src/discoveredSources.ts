import type { Series } from './catalog'

export type DiscoveredEpisodeRecord = {
  index: number
  title: string
  duration: string
  sizeLabel: string
  hasPreview: boolean
}

export type DiscoveredSeriesStatus = '免费样例' | '手动导入' | '资源发现'

export type DiscoveredSeriesRecord = {
  id: string
  title: string
  category: string
  adapterId: string
  sourceId: string
  status: DiscoveredSeriesStatus
  description: string
  tags: string[]
  totalEpisodes: number
  updatedAt: string
  posterGradient: string
  sourceNote: string
  episodes: DiscoveredEpisodeRecord[]
}

export type DiscoveredSeriesManifest = {
  version: 1
  exportedAt: string
  series: DiscoveredSeriesRecord[]
}

const posterGradients = [
  'linear-gradient(160deg, #0f172a 0%, #1d4ed8 100%)',
  'linear-gradient(160deg, #1f2937 0%, #ea580c 100%)',
  'linear-gradient(160deg, #164e63 0%, #059669 100%)',
  'linear-gradient(160deg, #3f3f46 0%, #db2777 100%)',
  'linear-gradient(160deg, #312e81 0%, #2563eb 100%)',
]

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object'

const normalizeEpisodeRecord = (
  value: unknown,
  fallbackIndex: number,
): DiscoveredEpisodeRecord | null => {
  if (!isObject(value)) {
    return null
  }

  const index = Math.max(1, Number(value.index) || fallbackIndex)
  return {
    index,
    title:
      typeof value.title === 'string' && value.title.trim()
        ? value.title.trim()
        : `第${index}集`,
    duration:
      typeof value.duration === 'string' && value.duration.trim()
        ? value.duration.trim()
        : '待补充',
    sizeLabel:
      typeof value.sizeLabel === 'string' && value.sizeLabel.trim()
        ? value.sizeLabel.trim()
        : '待获取',
    hasPreview: Boolean(value.hasPreview),
  }
}

const normalizeStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    : []

const normalizeSeriesRecord = (
  value: unknown,
  fallbackIndex: number,
): DiscoveredSeriesRecord | null => {
  if (!isObject(value)) {
    return null
  }

  if (
    typeof value.adapterId !== 'string' ||
    !value.adapterId.trim() ||
    typeof value.sourceId !== 'string' ||
    !value.sourceId.trim() ||
    typeof value.title !== 'string' ||
    !value.title.trim()
  ) {
    return null
  }

  const id =
    typeof value.id === 'string' && value.id.trim()
      ? value.id.trim()
      : `discovered-series-${fallbackIndex}`
  const totalEpisodes = Math.max(1, Number(value.totalEpisodes) || 1)
  const rawEpisodes = Array.isArray(value.episodes) ? value.episodes : []
  const normalizedEpisodes = rawEpisodes
    .map((item, index) => normalizeEpisodeRecord(item, index + 1))
    .filter((item): item is DiscoveredEpisodeRecord => Boolean(item))
    .sort((left, right) => left.index - right.index)
  const effectiveEpisodeCount = Math.max(
    totalEpisodes,
    normalizedEpisodes[normalizedEpisodes.length - 1]?.index || 0,
  )

  return {
    id,
    title:
      value.title.trim(),
    category:
      typeof value.category === 'string' && value.category.trim()
        ? value.category.trim()
        : '资源发现',
    adapterId:
      value.adapterId.trim(),
    sourceId: value.sourceId.trim(),
    status:
      value.status === '免费样例' || value.status === '手动导入'
        ? value.status
        : '资源发现',
    description:
      typeof value.description === 'string' && value.description.trim()
        ? value.description.trim()
        : '从本地 JSON 清单导入的资源条目，可配合适配器层生成可下载任务。',
    tags: normalizeStringArray(value.tags),
    totalEpisodes: effectiveEpisodeCount,
    updatedAt:
      typeof value.updatedAt === 'string' && value.updatedAt.trim()
        ? value.updatedAt.trim()
        : '刚刚',
    posterGradient:
      typeof value.posterGradient === 'string' && value.posterGradient.trim()
        ? value.posterGradient.trim()
        : posterGradients[fallbackIndex % posterGradients.length],
    sourceNote:
      typeof value.sourceNote === 'string' && value.sourceNote.trim()
        ? value.sourceNote.trim()
        : '资源发现层只负责展示与组织合法资源元数据，实际下载由适配器解析。',
    episodes: normalizedEpisodes,
  }
}

export const createDiscoveredSeriesManifest = (
  series: DiscoveredSeriesRecord[],
): DiscoveredSeriesManifest => ({
  version: 1,
  exportedAt: new Date().toISOString(),
  series,
})

export const stringifyDiscoveredSeriesManifest = (
  series: DiscoveredSeriesRecord[],
) => JSON.stringify(createDiscoveredSeriesManifest(series), null, 2)

export const parseDiscoveredSeriesManifest = (raw: string): DiscoveredSeriesRecord[] => {
  const parsed = JSON.parse(raw) as Partial<DiscoveredSeriesManifest> | DiscoveredSeriesRecord[]

  const sourceList = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.series)
      ? parsed.series
      : null

  if (!sourceList) {
    throw new Error('资源库清单格式无效，未找到 series 数组。')
  }

  const normalized = sourceList
    .map((item, index) => normalizeSeriesRecord(item, index + 1))
    .filter((item): item is DiscoveredSeriesRecord => Boolean(item))

  if (normalized.length !== sourceList.length) {
    throw new Error('资源库清单里存在格式不正确的条目。')
  }

  return normalized
}

export const mergeDiscoveredSeries = (
  current: DiscoveredSeriesRecord[],
  incoming: DiscoveredSeriesRecord[],
) => {
  const merged = new Map(current.map((item) => [item.id, item]))

  for (const item of incoming) {
    merged.set(item.id, item)
  }

  return Array.from(merged.values())
}

export const buildDiscoveredSeries = (record: DiscoveredSeriesRecord): Series => {
  const episodeMap = new Map(record.episodes.map((item) => [item.index, item]))

  return {
    id: `catalog-${record.id}`,
    adapterId: record.adapterId,
    sourceId: record.sourceId,
    title: record.title,
    category: record.category,
    status: record.status,
    description: record.description,
    tags: record.tags,
    totalEpisodes: record.totalEpisodes,
    updatedAt: record.updatedAt,
    posterGradient: record.posterGradient,
    sourceNote: record.sourceNote,
    episodes: Array.from({ length: record.totalEpisodes }, (_, index) => {
      const episodeIndex = index + 1
      const details = episodeMap.get(episodeIndex)

      return {
        id: `${record.id}-${episodeIndex}`,
        adapterId: record.adapterId,
        sourceId: `${record.sourceId}:${episodeIndex}`,
        index: episodeIndex,
        title: details?.title || `第${episodeIndex}集`,
        duration: details?.duration || '待补充',
        sizeLabel: details?.sizeLabel || '待获取',
        hasPreview: details?.hasPreview ?? false,
      }
    }),
  }
}
