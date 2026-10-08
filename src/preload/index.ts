import { contextBridge, ipcRenderer } from 'electron'
import type { QinkData } from '../shared/dates'

// 渲染层是状态源（数据小、单窗口），主进程负责落盘与应用能力（托盘/自启/拖动/形态切换等）。

contextBridge.exposeInMainWorld('qink', {
  getData: (): Promise<QinkData> => ipcRenderer.invoke('qink:data:get'),
  setData: (data: QinkData): Promise<void> => ipcRenderer.invoke('qink:data:set', data),
  setAutostart: (enabled: boolean): Promise<void> => ipcRenderer.invoke('qink:autostart', enabled),
  openDataFolder: (): Promise<void> => ipcRenderer.invoke('qink:open-data-folder'),
  workArea: (): Promise<{ x: number; y: number; width: number; height: number }> =>
    ipcRenderer.invoke('qink:work-area'),
  quit: (): void => ipcRenderer.send('qink:quit'),
  ignoreMouse: (ignore: boolean): void => ipcRenderer.send('qink:mouse-ignore', ignore),
  dragStart: (): void => ipcRenderer.send('qink:drag-start'),
  dragMove: (dx: number, dy: number): void => ipcRenderer.send('qink:drag-move', dx, dy),
  dragEnd: (): void => ipcRenderer.send('qink:drag-end'),
  resizeNote: (width: number, height: number, winX?: number): void =>
    ipcRenderer.send('qink:note-resize', width, height, winX),
  /** 双形态切换：球形态固定 56×56，贴纸形态回持久化尺寸（窗口 x 不动）。
   *  invoke 返回 Promise：形变编排要先等窗口切完再揭幕，杜绝换窗瞬间的可见错位 */
  setForm: (mode: 'ball' | 'note'): Promise<void> => ipcRenderer.invoke('qink:form-change', mode),
  onNoteCapped: (cb: (height: number) => void): void => {
    ipcRenderer.on('qink:note-capped', (_e, h) => cb(h))
  },
  onWinPos: (cb: (x: number, y: number) => void): void => {
    ipcRenderer.on('qink:win-pos', (_e, x, y) => cb(x, y))
  }
})
