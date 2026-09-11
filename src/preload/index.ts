import { contextBridge, ipcRenderer } from 'electron'
import type { QinkData } from '../shared/dates'
import type { GlassInfo, WallpaperImage } from '../shared/glass'

// 渲染层是状态源（数据小、单窗口），主进程负责落盘与应用能力（托盘/自启/拖动/玻璃等）。

contextBridge.exposeInMainWorld('qink', {
  getData: (): Promise<QinkData> => ipcRenderer.invoke('qink:data:get'),
  setData: (data: QinkData): Promise<void> => ipcRenderer.invoke('qink:data:set', data),
  setAutostart: (enabled: boolean): Promise<void> => ipcRenderer.invoke('qink:autostart', enabled),
  openDataFolder: (): Promise<void> => ipcRenderer.invoke('qink:open-data-folder'),
  quit: (): void => ipcRenderer.send('qink:quit'),
  ignoreMouse: (ignore: boolean): void => ipcRenderer.send('qink:mouse-ignore', ignore),
  dragStart: (): void => ipcRenderer.send('qink:drag-start'),
  dragMove: (dx: number, dy: number): void => ipcRenderer.send('qink:drag-move', dx, dy),
  dragEnd: (): void => ipcRenderer.send('qink:drag-end'),
  glassInfo: (): Promise<GlassInfo> => ipcRenderer.invoke('qink:glass-info'),
  onWallpaperChanged: (cb: (w: WallpaperImage) => void): void => {
    ipcRenderer.on('qink:wallpaper-changed', (_e, w) => cb(w))
  },
  onWinPos: (cb: (x: number, y: number) => void): void => {
    ipcRenderer.on('qink:win-pos', (_e, x, y) => cb(x, y))
  },
  glassReport: (r: { ok: boolean; ms?: number; bytes?: number }): void => {
    ipcRenderer.send('qink:glass-report', r)
  }
})
