const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('qink', {
  getData: () => ipcRenderer.invoke('test:get'),
  setData: data => ipcRenderer.invoke('test:set', data),
  glassInfo: () => ipcRenderer.invoke('test:glass'),
  glassReport: report => ipcRenderer.send('test:report', report),
  onWinPos: () => {}, onWallpaperChanged: () => {},
  ignoreMouse: () => {}, setAutostart: async () => {}, openDataFolder: () => {}, quit: () => {},
  dragStart: () => ipcRenderer.send('test:drag', 'start'),
  dragMove: (x, y) => ipcRenderer.send('test:drag', [x, y]),
  dragEnd: () => ipcRenderer.send('test:drag', 'end')
})
