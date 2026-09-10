import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { QinkData } from '../shared/dates'

// 数据是「文档\Qink\data.json」一个文件（ADR-0001：格式与框架无关，纯 JSON）。

const dataDir = (): string => join(app.getPath('documents'), 'Qink')
const dataFile = (): string => join(dataDir(), 'data.json')
// 备份副本：文档目录曾观察到被外部整体删除（安全软件/清理工具），AppData 副本可兜底恢复
const backupFile = (): string => join(app.getPath('userData'), 'data-backup.json')

export function defaultData(): QinkData {
  return {
    version: 1,
    goals: { quarter: null, month: null, week: null },
    tasks: [],
    archive: [],
    settings: { autostart: true, fontSize: 'medium', noteX: null, noteY: null }
  }
}

let cache: QinkData = defaultData()
let saveTimer: NodeJS.Timeout | null = null

export async function loadData(): Promise<QinkData> {
  for (const file of [dataFile(), backupFile()]) {
    try {
      const raw = await readFile(file, 'utf-8')
      cache = { ...defaultData(), ...JSON.parse(raw) }
      return cache
    } catch {
      // 主文件不可读则试备份；都不可读（首次运行）从默认开始
    }
  }
  cache = defaultData()
  return cache
}

export function getData(): QinkData {
  return cache
}

/** 渲染层是状态源：每次变更发全量数据过来，主进程负责落盘。 */
export function setData(next: QinkData): void {
  cache = { ...defaultData(), ...next }
  queueSave()
}

/** 防抖保存：高频操作（打字、拖动松手）合并成一次落盘。 */
export function queueSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    void persist()
  }, 300)
}

async function persist(): Promise<void> {
  const json = JSON.stringify(cache, null, 2)
  try {
    await mkdir(dataDir(), { recursive: true })
    await writeFile(dataFile(), json, 'utf-8')
  } catch (err) {
    // 主文件落盘失败不致命（内存态仍正确），下次任何 queueSave 会再试
    console.error('[qink] 保存数据失败:', err)
  }
  try {
    await mkdir(app.getPath('userData'), { recursive: true })
    await writeFile(backupFile(), json, 'utf-8')
  } catch {
    // 备份失败静默：备份只是保险，不是主路径
  }
}
