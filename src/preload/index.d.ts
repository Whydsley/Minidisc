import { ElectronAPI } from '@electron-toolkit/preload'

interface Api {
  getScreenSources(): Promise<{ id: string; name: string; thumbnail: string }[]>
  selectScreenSource(id: string): Promise<void>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}