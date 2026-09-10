import type { QinkData } from '@shared/dates'
import type { GlassInfo, WallpaperImage } from '@shared/glass'

export {}

declare global {
  interface QinkAPI {
    getData(): Promise<QinkData>
    setData(data: QinkData): Promise<void>
    setAutostart(enabled: boolean): Promise<void>
    openDataFolder(): Promise<void>
    quit(): void
    dragStart(): void
    dragMove(dx: number, dy: number): void
    dragEnd(): void
    glassInfo(): Promise<GlassInfo>
    onWallpaperChanged(cb: (w: WallpaperImage) => void): void
    onWinPos(cb: (x: number, y: number) => void): void
    glassReport(r: { ok: boolean; ms?: number; bytes?: number }): void
  }

  interface Window {
    qink: QinkAPI
  }
}
