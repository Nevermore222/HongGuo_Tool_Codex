/**
 * 自定义适配器模板
 *
 * 用法：
 * 1. 复制本文件
 * 2. 修改 adapter id / 名称 / 描述
 * 3. 在 resolveEpisodeDownload 中接入你自己的资源定位逻辑
 * 4. 把结果注册到 src/sourceAdapters.ts 的 adapterRegistry
 *
 * 注意：
 * - 这里只处理“你已经合法持有”的直链或本地文件路径
 * - 不要在这里实现第三方平台抓取、绕过限制或未授权下载
 */

import type { Episode, Resolution, Series } from '../src/catalog'
import type {
  AdapterDefinition,
  DirectDownloadDescriptor,
  ManualSourceRecord,
} from '../src/sourceAdapters'

type ResolveInput = {
  series: Series
  episode: Episode
  resolution: Resolution
  manualSources: ManualSourceRecord[]
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

const buildTaskId = (series: Series, episode: Episode, resolution: Resolution) =>
  `task-${series.adapterId}-${series.sourceId}-${episode.index}-${resolution}`

const buildResult = (
  input: ResolveInput,
  sourceUrl: string,
  fileExtension = 'mp4',
): DirectDownloadDescriptor => ({
  taskId: buildTaskId(input.series, input.episode, input.resolution),
  adapterId: input.series.adapterId,
  seriesId: input.series.id,
  seriesTitle: input.series.title,
  episodeId: input.episode.id,
  episodeTitle: input.episode.title,
  resolution: input.resolution,
  sourceUrl,
  fileName: sanitizeFileName(
    `${input.series.title}-${input.episode.title}-${input.resolution}.${fileExtension}`,
  ),
})

const resolveFromYourSystem = (_input: ResolveInput) => {
  /**
   * 在这里写你的实际逻辑，例如：
   *
   * 方案 A：根据 series.sourceId / episode.index 拼接授权直链
   * const sourceUrl = `https://files.example.com/${input.series.sourceId}/${input.episode.index}.mp4`
   *
   * 方案 B：从你本地维护的映射表中查找
   * const sourceUrl = myEpisodeMap[input.series.sourceId]?.[input.episode.index]
   *
   * 方案 C：读取你自己的 API 返回结果
   * const sourceUrl = await myApi.getEpisodeUrl(...)
   *
   * 然后返回 buildResult(...)
   */

  throw new Error(
    `请在自定义适配器里实现 resolveFromYourSystem。当前 series.sourceId=${_input.series.sourceId}`,
  )
}

export const customDirectFileAdapter: AdapterDefinition = {
  id: 'custom-direct-file',
  name: '自定义直链适配器',
  description: '适用于你自己的文件服务、NAS、对象存储或本地目录映射。',
  resolveEpisodeDownload: (input) => {
    const sourceUrl = resolveFromYourSystem(input)
    return buildResult(input, sourceUrl, 'mp4')
  },
}
