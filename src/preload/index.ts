import { contextBridge, ipcRenderer } from 'electron'
import type { QinkData } from '../shared/dates'

// 渲染层是状态源（数据小、单窗口），主进程负责落盘与应用能力（托盘/自启/拖动等）。

contextBridge.exposeInMainWorld('qink', {
  getData: (): Promise<QinkData> => ipcRenderer.invoke('qink:data:get'),
  setData: (data: QinkData): Promise<void> => ipcRenderer.invoke('qink:data:set', data),
  setAutostart: (enabled: boolean): Promise<void> => ipcRenderer.invoke('qink:autostart', enabled),
  openDataFolder: (): Promise<void> => ipcRenderer.invoke('qink:open-data-folder'),
  quit: (): void => ipcRenderer.send('qink:quit'),
  dragStart: (): void => ipcRenderer.send('qink:drag-start'),
  dragMove: (dx: number, dy: number): void => ipcRenderer.send('qink:drag-move', dx, dy),
  dragEnd: (): void => ipcRenderer.send('qink:drag-end')
})
