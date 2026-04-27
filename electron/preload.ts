import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  getServerStatus: () => ipcRenderer.invoke('get-server-status'),
  setCompression: (type: string) => ipcRenderer.invoke('set-compression', type),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectFiles: () => ipcRenderer.invoke('select-files'),
  getGameUrl: () => ipcRenderer.invoke('get-game-url'),
  onServerStarted: (callback: (port: number) => void) => {
    ipcRenderer.on('server-started', (_, port) => callback(port))
  },
  onBuildLoaded: (callback: (path: string) => void) => {
    ipcRenderer.on('build-loaded', (_, path) => callback(path))
  },
})