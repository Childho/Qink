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
    /** 菜单打开时按桌面工作区定位，并在必要时临时扩展透明窗口。 */
    placeMenu(x: number, y: number, width: number, height: number): Promise<{
      left: number; top: number; dockShiftY: number; maxHeight: number; maxWidth: number
    } | null>
    closeMenu(): void
    onMenuDismiss(cb: () => void): void
    /** 主显示器工作区（惯性投掷的贴边反弹边界，与主进程拖动夹取同源） */
    workArea(): Promise<QinkRect>
    quit(): void
    /** 诊断事件上报（boot 完成/形态切换原因等），主进程落 qink.log——现场报告对时间线用 */
    diag(event: string, detail?: unknown): void
    ignoreMouse(ignore: boolean): void
    dragStart(): void
    dragMove(dx: number, dy: number): void
    dragEnd(): void
    resizeNote(width: number, height: number, winX?: number): void
    /** 双形态切换：球形态固定 56×56，贴纸形态回持久化尺寸（窗口 x 不动）。
     *  Promise 在主进程切完窗后 resolve——形变编排据此先切窗再揭幕 */
    setForm(mode: 'ball' | 'note'): Promise<{ w: number; h: number }>
    onEffectiveNoteWidth(cb: (width: number, workAreaWidth: number) => void): void
    onNoteCapped(cb: (height: number) => void): void
    /** 托盘切换置顶后的反向同步：更新本地 data.settings.alwaysOnTop */
    onAlwaysOnTop(cb: (on: boolean) => void): void
    onWinPos(cb: (x: number, y: number) => void): void
    /** 失焦收起通知：贴纸展开时点击窗口外 250ms 后触发（挂起期内托盘抬前已在主进程撤销） */
    onBlurCollapse(cb: () => void): void
  }

  interface Window {
    qink: QinkAPI
  }
}
