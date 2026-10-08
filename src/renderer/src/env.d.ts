import type { QinkData } from '@shared/dates'

export {}

// 样式表由 Vite 处理（构建时抽成 .css 文件注入 <link>），TS 只需认得这个导入
declare module '*.css' {
  const css: string
  export default css
}

declare global {
  interface QinkRect {
    x: number
    y: number
    width: number
    height: number
  }

  interface QinkAPI {
    getData(): Promise<QinkData>
    setData(data: QinkData): Promise<void>
    setAutostart(enabled: boolean): Promise<void>
    openDataFolder(): Promise<void>
    /** 主显示器工作区（惯性投掷的贴边反弹边界，与主进程拖动夹取同源） */
    workArea(): Promise<QinkRect>
    quit(): void
    ignoreMouse(ignore: boolean): void
    dragStart(): void
    dragMove(dx: number, dy: number): void
    dragEnd(): void
    resizeNote(width: number, height: number, winX?: number): void
    /** 双形态切换：球形态固定 56×56，贴纸形态回持久化尺寸（窗口 x 不动）。
     *  Promise 在主进程切完窗后 resolve——形变编排据此先切窗再揭幕 */
    setForm(mode: 'ball' | 'note'): Promise<void>
    onNoteCapped(cb: (height: number) => void): void
    onWinPos(cb: (x: number, y: number) => void): void
  }

  interface Window {
    qink: QinkAPI
  }
}
