import { contextBridge, ipcRenderer } from 'electron'
import type { QinkData } from '../shared/dates'

// 渲染层是状态源（数据小、单窗口），主进程负责落盘与应用能力（托盘/自启/拖动/形态切换等）。

contextBridge.exposeInMainWorld('qink', {
  getData: (): Promise<QinkData> => ipcRenderer.invoke('qink:data:get'),
  setData: (data: QinkData): Promise<void> => ipcRenderer.invoke('qink:data:set', data),
  setAutostart: (enabled: boolean): Promise<void> => ipcRenderer.invoke('qink:autostart', enabled),
  openDataFolder: (): Promise<void> => ipcRenderer.invoke('qink:open-data-folder'),
  placeMenu: (x: number, y: number, width: number, height: number): Promise<{
    left: number; top: number; dockShiftY: number; maxHeight: number; maxWidth: number
  } | null> => ipcRenderer.invoke('qink:menu-place', x, y, width, height),
  closeMenu: (): void => ipcRenderer.send('qink:menu-close'),
  onMenuDismiss: (cb: () => void): void => { ipcRenderer.on('qink:menu-dismiss', cb) },
  workArea: (): Promise<{ x: number; y: number; width: number; height: number }> =>
    ipcRenderer.invoke('qink:work-area'),
  quit: (): void => ipcRenderer.send('qink:quit'),
  /** 诊断事件上报（boot 完成/形态切换原因等），主进程落 qink.log——现场报告对时间线用 */
  diag: (event: string, detail?: unknown): void => ipcRenderer.send('qink:diag', event, detail),
  ignoreMouse: (ignore: boolean): void => ipcRenderer.send('qink:mouse-ignore', ignore),
  dragStart: (): void => ipcRenderer.send('qink:drag-start'),
  dragMove: (dx: number, dy: number): void => ipcRenderer.send('qink:drag-move', dx, dy),
  dragEnd: (): void => ipcRenderer.send('qink:drag-end'),
  resizeNote: (width: number, height: number, winX?: number): void =>
    ipcRenderer.send('qink:note-resize', width, height, winX),
  /** 双形态切换：球形态固定 56×56，贴纸形态回持久化尺寸（窗口 x 不动）。
   *  invoke 返回 Promise：形变编排要先等窗口切完再揭幕，杜绝换窗瞬间的可见错位 */
  setForm: (mode: 'ball' | 'note'): Promise<{ w: number; h: number }> => ipcRenderer.invoke('qink:form-change', mode),
  onEffectiveNoteWidth: (cb: (width: number, workAreaWidth: number) => void): void => {
    ipcRenderer.on('qink:effective-width', (_e, width, workAreaWidth) => cb(width, workAreaWidth))
  },
  onNoteCapped: (cb: (height: number) => void): void => {
    ipcRenderer.on('qink:note-capped', (_e, h) => cb(h))
  },
  /** 托盘切换置顶后主进程反向同步：渲染层更新本地 data，防止下次全量推送把状态冲掉 */
  onAlwaysOnTop: (cb: (on: boolean) => void): void => {
    ipcRenderer.on('qink:always-on-top', (_e, on) => cb(on))
  },
  onWinPos: (cb: (x: number, y: number) => void): void => {
    ipcRenderer.on('qink:win-pos', (_e, x, y) => cb(x, y))
  },
  /** 失焦收起通知：贴纸展开时点击窗口外 250ms 后触发（挂起期内托盘抬前已在主进程撤销） */
  onBlurCollapse: (cb: () => void): void => {
    ipcRenderer.on('qink:blur-collapse', () => cb())
  }
})
