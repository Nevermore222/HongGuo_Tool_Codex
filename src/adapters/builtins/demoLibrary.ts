import { sanitizeFileName } from '../utils'
import type { AdapterDefinition } from '../types'

const previewSampleUrl =
  'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'

export const demoLibraryAdapter: AdapterDefinition = {
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
