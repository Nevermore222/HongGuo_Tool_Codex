import type { DesktopContext, DesktopSettings } from './desktop'

type DesktopApi = {
  isElectron: boolean
  getContext: () => Promise<DesktopContext>
  getSettings: () => Promise<DesktopSettings>
  updateSettings: (
    patch: Partial<DesktopSettings>,
  ) => Promise<DesktopSettings>
  chooseDownloadDirectory: () => Promise<string | null>
  openPath: (targetPath: string) => Promise<string>
}

declare global {
  interface Window {
    desktopApi?: DesktopApi
  }
}

export {}
