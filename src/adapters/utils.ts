import type { Resolution, Series } from '../catalog'
import type { ManualSourceRecord } from './types'

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

export const replaceTemplateTokens = (
  template: string,
  series: Series,
  episode: Series['episodes'][number],
  resolution: Resolution,
) =>
  template
    .replaceAll('{seriesId}', series.sourceId)
    .replaceAll('{seriesTitle}', series.title)
    .replaceAll('{episode}', String(episode.index))
    .replaceAll('{episodeIndex}', String(episode.index))
    .replaceAll('{episodeTitle}', episode.title)
    .replaceAll('{resolution}', resolution)

export const sanitizeFileName = (value: string) =>
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
