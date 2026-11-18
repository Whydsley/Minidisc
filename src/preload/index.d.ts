import { ElectronAPI } from '@electron-toolkit/preload'

interface Api {
  startHost(): Promise<{ localUrl: string; publicUrl: string }>
  stopHost(): Promise<void>
  getScreenSources(): Promise<{ id: string; name: string; thumbnail: string }[]>
  selectScreenSource(id: string, withAudio: boolean): Promise<void>
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  close(): Promise<void>
  onMaximizeChange(cb: (maximized: boolean) => void): () => void
  log(source: string, message: string): void
  openLogs(): Promise<void>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}