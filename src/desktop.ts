import type { Resolution } from './catalog'

export type DesktopContext = {
  isElectron: boolean
  platform: string
  version: string
  userDataPath: string
}

export type DesktopSettings = {
  downloadDirectory: string
  maxConcurrentDownloads: number
  preferredResolution: Resolution
  updatedAt: string
}

export const fallbackDesktopContext: DesktopContext = {
  isElectron: false,
  platform: 'web',
  version: 'browser',
  userDataPath: '浏览器模式下不可用',
}

export const fallbackDesktopSettings: DesktopSettings = {
  downloadDirectory: '未选择下载目录',
  maxConcurrentDownloads: 3,
  preferredResolution: '720p',
  updatedAt: '',
}

export const isDesktopShellAvailable = () =>
  typeof window !== 'undefined' && Boolean(window.desktopApi?.isElectron)
