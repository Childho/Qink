import type { QinkData } from '@shared/dates'

export {}

declare global {
  interface QinkAPI {
    getData(): Promise<QinkData>
    setData(data: QinkData): Promise<void>
  }

  interface Window {
    qink: QinkAPI
  }
}
