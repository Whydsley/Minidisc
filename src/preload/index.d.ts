import { ElectronAPI } from '@electron-toolkit/preload'

interface Api {
  startHost(): Promise<{ localUrl: string; publicUrl: string }>
  stopHost(): Promise<void>
  getScreenSources(): Promise<{ id: string; name: string; thumbnail: string }[]>
  selectScreenSource(id: string): Promise<void>
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  close(): Promise<void>
  onMaximizeChange(cb: (maximized: boolean) => void): () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}