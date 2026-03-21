export type Resolution = '1080p' | '720p'

export type Episode = {
  id: string
  adapterId: string
  sourceId: string
  index: number
  title: string
  duration: string
  sizeLabel: string
  hasPreview: boolean
}

export type Series = {
  id: string
  adapterId: string
  sourceId: string
  title: string
  category: string
  status: '免费样例' | '手动导入' | '资源发现'
  description: string
  tags: string[]
  totalEpisodes: number
  updatedAt: string
  posterGradient: string
  sourceNote: string
  episodes: Episode[]
}

const createEpisodes = (
  count: number,
  adapterId: string,
  prefix: string,
): Episode[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
    adapterId,
    sourceId: `${prefix}:${index + 1}`,
    index: index + 1,
    title: `第${index + 1}集`,
    duration: `${1 + ((index * 7) % 3)}分${10 + ((index * 11) % 45)}秒`,
    sizeLabel: `${index % 2 === 0 ? '约 53MB' : '约 91MB'}`,
    hasPreview: index < 3,
  }))

export const mockCatalog: Series[] = [
  {
    id: 'demo-urban-rise',
    adapterId: 'demo-library',
    sourceId: 'demo-urban-rise',
    title: '逆风翻盘计划',
    category: '高热短篇',
    status: '免费样例',
    description:
      '通用下载框架演示数据，用来验证搜索、筛选、分辨率切换、队列加入和预览窗口。',
    tags: ['演示资源', '都市', '逆袭'],
    totalEpisodes: 18,
    updatedAt: '今天 09:30',
    posterGradient: 'linear-gradient(160deg, #ea580c 0%, #7c2d12 100%)',
    sourceNote: '仅用于界面联调，不代表任何第三方平台内容。',
    episodes: createEpisodes(18, 'demo-library', 'urban-rise'),
  },
  {
    id: 'demo-protector',
    adapterId: 'demo-library',
    sourceId: 'demo-protector',
    title: '她的守护时刻',
    category: '都市情感',
    status: '免费样例',
    description:
      '偏情感类的样例条目，方便测试长列表、批量任务和已完成状态的展示。',
    tags: ['演示资源', '情感', '短剧'],
    totalEpisodes: 24,
    updatedAt: '今天 12:15',
    posterGradient: 'linear-gradient(160deg, #db2777 0%, #4c1d95 100%)',
    sourceNote: '示例内容可替换为你合法持有的直链资源。',
    episodes: createEpisodes(24, 'demo-library', 'protector'),
  },
  {
    id: 'demo-legend',
    adapterId: 'demo-library',
    sourceId: 'demo-legend',
    title: '长夜奇谭',
    category: '古风玄幻',
    status: '免费样例',
    description:
      '用于验证分类浏览、标签渲染与不同封面风格，不包含实际平台接口。',
    tags: ['演示资源', '古风', '玄幻'],
    totalEpisodes: 16,
    updatedAt: '昨天 19:42',
    posterGradient: 'linear-gradient(160deg, #2563eb 0%, #1e293b 100%)',
    sourceNote: '框架模式只支持演示数据和手动导入源。',
    episodes: createEpisodes(16, 'demo-library', 'legend'),
  },
  {
    id: 'demo-growth',
    adapterId: 'demo-library',
    sourceId: 'demo-growth',
    title: '微光里的答案',
    category: '成长励志',
    status: '免费样例',
    description:
      '适合测试搜索命中、剧集详情切换和任务列表刷新节奏的另一组样例。',
    tags: ['演示资源', '成长', '励志'],
    totalEpisodes: 20,
    updatedAt: '昨天 08:05',
    posterGradient: 'linear-gradient(160deg, #059669 0%, #164e63 100%)',
    sourceNote: '这里预留了未来接入自有资源库的空间。',
    episodes: createEpisodes(20, 'demo-library', 'growth'),
  },
]
