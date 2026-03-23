import type { AdapterDefinition } from '../types'

export const shortDramaLibraryAdapter: AdapterDefinition = {
  id: 'short-drama-library',
  name: '短剧查询索引',
  description:
    '用于维护查询短剧网盘索引。该来源记录的是网盘页链接，不是可直接下载的媒体直链。',
  resolveEpisodeDownload: () => {
    throw new Error(
      '该资源来自短剧查询索引，仅用于维护查询。当前链接为网盘页面地址，不支持直接下载任务。',
    )
  },
}
