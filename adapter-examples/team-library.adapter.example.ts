/**
 * 示例自定义适配器
 *
 * 这个示例演示一种很常见的接法：
 * - 资源列表由你自己维护
 * - 下载时根据 sourceId + episodeIndex + resolution 从映射表里取直链
 * - 最终把直链交给系统已有的 Electron 下载执行层
 *
 * 使用方式：
 * 1. 参考本文件复制一个你自己的适配器
 * 2. 把 mockEpisodeLibrary 替换为你自己的资源索引
 * 3. 在 src/sourceAdapters.ts 中注册该适配器
 */

import type { Episode, Resolution, Series } from '../src/catalog'
import type {
  AdapterDefinition,
  ManualSourceRecord,
} from '../src/sourceAdapters'

type ResolveInput = {
  series: Series
  episode: Episode
  resolution: Resolution
  manualSources: ManualSourceRecord[]
}

type EpisodeVariant = {
  '720p'?: string
  '1080p'?: string
}

type LibraryMap = Record<string, Record<number, EpisodeVariant>>

const mockEpisodeLibrary: LibraryMap = {
  'team-drama-alpha': {
    1: {
      '720p': 'https://media.example.com/team-drama-alpha/ep01-720p.mp4',
      '1080p': 'https://media.example.com/team-drama-alpha/ep01-1080p.mp4',
    },
    2: {
      '720p': 'https://media.example.com/team-drama-alpha/ep02-720p.mp4',
      '1080p': 'https://media.example.com/team-drama-alpha/ep02-1080p.mp4',
    },
  },
}

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

const resolveSeriesKey = (series: Series) => series.sourceId

const resolveSourceUrl = (
  seriesKey: string,
  episodeIndex: number,
  resolution: Resolution,
) => {
  const variants = mockEpisodeLibrary[seriesKey]?.[episodeIndex]
  if (!variants) {
    throw new Error(`资源库里没有找到 ${seriesKey} 第 ${episodeIndex} 集。`)
  }

  const preferred = variants[resolution]
  const fallback = variants['720p'] ?? variants['1080p']

  if (!preferred && !fallback) {
    throw new Error(`资源库里没有找到 ${seriesKey} 第 ${episodeIndex} 集的可用地址。`)
  }

  return preferred ?? fallback ?? ''
}

export const teamLibraryAdapterExample: AdapterDefinition = {
  id: 'team-library-example',
  name: '团队资源库示例适配器',
  description: '通过本地映射表按集数和清晰度定位授权直链。',
  resolveEpisodeDownload: (input: ResolveInput) => {
    const seriesKey = resolveSeriesKey(input.series)
    const sourceUrl = resolveSourceUrl(
      seriesKey,
      input.episode.index,
      input.resolution,
    )

    return {
      taskId: `task-${input.series.sourceId}-${input.episode.index}-${input.resolution}`,
      adapterId: 'team-library-example',
      seriesId: input.series.id,
      seriesTitle: input.series.title,
      episodeId: input.episode.id,
      episodeTitle: input.episode.title,
      resolution: input.resolution,
      sourceUrl,
      fileName: sanitizeFileName(
        `${input.series.title}-${input.episode.title}-${input.resolution}.mp4`,
      ),
    }
  },
}
