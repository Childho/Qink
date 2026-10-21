import { app } from 'electron'
import { join } from 'node:path'
import type { QinkData } from '../shared/dates'
import { createStore, defaultData, type LoadOutcome, type Store } from './store-io'

// 数据是「文档\Qink\data.json」一个文件（ADR-0001：格式与框架无关，纯 JSON）。
// 备份副本：文档目录曾观察到被外部整体删除（安全软件/清理工具），AppData 副本可兜底恢复。
// 读写与耐久策略（原子写/坏档留证/退出冲刷）全部在 store-io.ts，可被 vitest 直接测。

const store: Store = createStore(() => ({
  dataFile: join(app.getPath('documents'), 'Qink', 'data.json'),
  backupFile: join(app.getPath('userData'), 'data-backup.json')
}))

export { defaultData }
export type { LoadOutcome }

export function loadData(): Promise<LoadOutcome> {
  return store.load()
}

export function getData() {
  return store.get()
}

/** 渲染层是状态源：每次变更发全量数据过来，主进程负责落盘。 */
export function setData(next: QinkData): void {
  store.set(next)
}

/** 防抖保存：高频操作（打字、拖动松手）合并成一次落盘。 */
export function queueSave(): void {
  store.queueSave()
}

/** 退出前冲刷：before-quit 里把防抖窗口内挂起的最后一份修改同步落盘 */
export function flushPendingSync(): void {
  store.flushPendingSync()
}

/** 外部写入热重载（ADR-0010）：主文件被外部工具原子修改且校验通过时，回调最新全量数据 */
export function watchExternalData(onExternal: (data: QinkData) => void): void {
  store.watchExternal(onExternal)
}
