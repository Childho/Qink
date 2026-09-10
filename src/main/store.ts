import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { QinkData } from '../shared/dates'

// 数据是「文档\Qink\data.json」一个文件（ADR-0001：格式与框架无关，纯 JSON）。

const dataDir = (): string => join(app.getPath('documents'), 'Qink')
const dataFile = (): string => join(dataDir(), 'data.json')

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
  try {
    const raw = await readFile(dataFile(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<QinkData>
    cache = { ...defaultData(), ...parsed }
  } catch {
    cache = defaultData() // 首次运行或文件不可读：从默认开始，不写坏文件
  }
  return cache
}

export function getData(): QinkData {
  return cache
}

/** 防抖保存：高频操作（打字、拖动松手）合并成一次落盘。 */
export function queueSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    void persist()
  }, 300)
}

async function persist(): Promise<void> {
  try {
    await mkdir(dataDir(), { recursive: true })
    await writeFile(dataFile(), JSON.stringify(cache, null, 2), 'utf-8')
  } catch (err) {
    // 落盘失败不致命（内存态仍正确），下次任何 queueSave 会再试
    console.error('[qink] 保存数据失败:', err)
  }
}
