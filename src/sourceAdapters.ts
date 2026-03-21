export {
  adapterRegistry,
  getAdapterOptions,
  getCatalogFromAdapters,
  resolveEpisodeDownload,
} from './adapters/registry'

export { buildManualSeries, replaceTemplateTokens, sanitizeFileName } from './adapters/utils'

export type {
  AdapterDefinition,
  AdapterResolveInput,
  DirectDownloadDescriptor,
  ManualSourceRecord,
} from './adapters/types'
