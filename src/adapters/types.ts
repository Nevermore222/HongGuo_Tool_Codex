import type { Episode, Resolution, Series } from '../catalog'

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

export type AdapterResolveInput = {
  series: Series
  episode: Episode
  resolution: Resolution
  manualSources: ManualSourceRecord[]
}

export type AdapterDefinition = {
  id: string
  name: string
  description: string
  resolveEpisodeDownload: (
    input: AdapterResolveInput,
  ) => DirectDownloadDescriptor
}
