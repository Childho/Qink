import { contextBridge, ipcRenderer } from 'electron'
import type { QinkData } from '../shared/dates'

// 渲染层是状态源（数据小、单窗口），主进程只负责落盘与应用能力（托盘/自启等）。

contextBridge.exposeInMainWorld('qink', {
  getData: (): Promise<QinkData> => ipcRenderer.invoke('qink:data:get'),
  setData: (data: QinkData): Promise<void> => ipcRenderer.invoke('qink:data:set', data)
})
