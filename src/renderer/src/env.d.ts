import type { QinkData } from '@shared/dates'

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
  }

  interface Window {
    qink: QinkAPI
  }
}
