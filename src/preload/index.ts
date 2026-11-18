import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  startHost: () => ipcRenderer.invoke('host:start'),
  stopHost: () => ipcRenderer.invoke('host:stop'),
  getScreenSources: () => ipcRenderer.invoke('screen:sources'),
  selectScreenSource: (id: string, withAudio: boolean) => ipcRenderer.invoke('screen:select', id, withAudio),

  log: (source: string, message: string) => ipcRenderer.send('log:write', source, message),
  openLogs: () => ipcRenderer.invoke('log:open'),

  minimize: () => ipcRenderer.invoke('win:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('win:toggle-maximize'),
  close: () => ipcRenderer.invoke('win:close'),
  onMaximizeChange: (cb: (maximized: boolean) => void) => {
    const handler = (_e: unknown, value: boolean): void => cb(value)
    ipcRenderer.on('win:maximized', handler)
    return () => {
      ipcRenderer.removeListener('win:maximized', handler)
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}