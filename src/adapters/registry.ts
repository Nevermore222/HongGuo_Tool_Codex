import { mockCatalog } from '../catalog'
import { buildDiscoveredSeries } from '../discoveredSources'
import { demoLibraryAdapter } from './builtins/demoLibrary'
import { manualTemplateAdapter } from './builtins/manualTemplate'
import { customAdapters } from './custom'
import { buildManualSeries } from './utils'
import type { ManualSourceRecord, AdapterResolveInput, AdapterDefinition } from './types'
import type { DiscoveredSeriesRecord } from '../discoveredSources'

const builtInAdapters: AdapterDefinition[] = [
  demoLibraryAdapter,
  manualTemplateAdapter,
]

export const adapterRegistry: Record<string, AdapterDefinition> = Object.fromEntries(
  [...builtInAdapters, ...customAdapters].map((adapter) => [adapter.id, adapter]),
)

export const getCatalogFromAdapters = (
  manualSources: ManualSourceRecord[],
  discoveredSeries: DiscoveredSeriesRecord[] = [],
) => [
  ...discoveredSeries.map(buildDiscoveredSeries),
  ...manualSources.map(buildManualSeries),
  ...mockCatalog,
]

export const getAdapterOptions = () =>
  Object.values(adapterRegistry).map((adapter) => ({
    id: adapter.id,
    name: adapter.name,
    description: adapter.description,
  }))

export const resolveEpisodeDownload = (input: AdapterResolveInput) => {
  const adapter = adapterRegistry[input.series.adapterId]

  if (!adapter) {
    throw new Error(`未找到适配器: ${input.series.adapterId}`)
  }

  return adapter.resolveEpisodeDownload(input)
}
