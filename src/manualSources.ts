import type { ManualSourceRecord } from './sourceAdapters'

export type ManualSourceManifest = {
  version: 1
  exportedAt: string
  sources: ManualSourceRecord[]
}

const isManualSourceRecord = (value: unknown): value is ManualSourceRecord => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.category === 'string' &&
    typeof candidate.totalEpisodes === 'number' &&
    typeof candidate.urlTemplate === 'string' &&
    typeof candidate.note === 'string'
  )
}

export const createManualSourceManifest = (
  sources: ManualSourceRecord[],
): ManualSourceManifest => ({
  version: 1,
  exportedAt: new Date().toISOString(),
  sources,
})

export const stringifyManualSourceManifest = (sources: ManualSourceRecord[]) =>
  JSON.stringify(createManualSourceManifest(sources), null, 2)

export const parseManualSourceManifest = (
  raw: string,
): ManualSourceRecord[] => {
  const parsed = JSON.parse(raw) as Partial<ManualSourceManifest> | ManualSourceRecord[]

  const sourceList = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.sources)
      ? parsed.sources
      : null

  if (!sourceList) {
    throw new Error('资源清单格式无效，未找到 sources 数组。')
  }

  const normalized = sourceList.filter(isManualSourceRecord)

  if (normalized.length !== sourceList.length) {
    throw new Error('资源清单里存在格式不正确的条目。')
  }

  return normalized.map((item) => ({
    ...item,
    title: item.title.trim(),
    category: item.category.trim() || '手动导入',
    totalEpisodes: Math.max(1, Number(item.totalEpisodes) || 1),
    urlTemplate: item.urlTemplate.trim(),
    note: item.note.trim(),
  }))
}

export const mergeManualSources = (
  current: ManualSourceRecord[],
  incoming: ManualSourceRecord[],
) => {
  const merged = new Map(current.map((item) => [item.id, item]))

  for (const item of incoming) {
    merged.set(item.id, item)
  }

  return Array.from(merged.values())
}
