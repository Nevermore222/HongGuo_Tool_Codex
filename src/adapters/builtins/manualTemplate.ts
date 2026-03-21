import { replaceTemplateTokens, sanitizeFileName } from '../utils'
import type { AdapterDefinition } from '../types'

export const manualTemplateAdapter: AdapterDefinition = {
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
