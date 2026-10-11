import { mkdir, open, readFile, rename } from 'node:fs/promises'
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'
import type { QinkData } from '../shared/dates'

// 数据耐久核心（ADR-0009）：不依赖 electron，路径由调用方注入，可被 vitest 直接测。
// 三件事：原子写（tmp + fsync + rename）、坏档留证（.corrupt 而非静默清零）、退出冲刷（同步落盘）。

const DEBOUNCE_MS = 300

export interface StorePaths {
  /** 主文件（文档目录） */
  dataFile: string
  /** 备份文件（AppData；文档目录曾被外部整体删除过，见 M4 事件） */
  backupFile: string
}

export interface LoadOutcome {
  /** 本次启动的数据从哪来：主文件 / 备份 / 全新（两者都不可用） */
  source: 'main' | 'backup' | 'fresh'
  /** 被判损坏并留证为 .corrupt 的文件路径（含 .corrupt 后缀），供上层提示用户 */
  quarantined: string[]
}

export interface Store {
  load(): Promise<LoadOutcome>
  get(): QinkData
  set(next: QinkData): void
  queueSave(): void
  /** 退出前同步冲刷挂起的防抖写：before-quit 里没有机会等异步回调跑完 */
  flushPendingSync(): void
}

export function defaultData(): QinkData {
  return {
    version: 1,
    goals: { quarter: null, month: null, week: null },
    tasks: [],
    archive: [],
    settings: { autostart: true, fontSize: 'medium', noteX: null, noteY: null, noteW: null, noteH: null, noteMode: 'note', alwaysOnTop: false }
  }
}

/** 单文件读取结果：missing=不存在（首次运行）；corrupt=存在但读不出/不是 JSON 对象 */
type ReadResult =
  | { kind: 'missing' }
  | { kind: 'ok'; data: QinkData }
  | { kind: 'corrupt' }

async function readOne(file: string): Promise<ReadResult> {
  let raw: string
  try {
    raw = await readFile(file, 'utf-8')
  } catch (err) {
    // ENOENT 才是「没有」；权限异常等一律按坏档对待（宁可留证，不可误判为首次运行）
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? { kind: 'missing' } : { kind: 'corrupt' }
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { kind: 'corrupt' }
    // 浅合并沿用既有语义：未知字段保留、缺失字段补默认（深层合并属 schema 升级范畴，另案）
    return { kind: 'ok', data: { ...defaultData(), ...(parsed as Partial<QinkData>) } }
  } catch {
    return { kind: 'corrupt' }
  }
}

/** 坏档留证：改名成 .corrupt 保住现场（后续同名 .corrupt 会被最新坏档替换）。改名失败则原文件原地保留。 */
async function quarantine(file: string): Promise<string | null> {
  const kept = `${file}.corrupt`
  try {
    await rename(file, kept)
    return kept
  } catch (err) {
    console.error('[qink] 坏档留证失败（原件原地保留，切勿当作可覆盖）:', file, err)
    return null
  }
}

/** 原子写：先写 .tmp 并 fsync，再 rename 顶替。崩溃/断电的结果只有「旧文件」或「新文件」两种，
 *  永远不会留下写了一半的 data.json——半写文件正是旧恢复链静默清零的入口。 */
async function writeFileAtomic(file: string, json: string): Promise<void> {
  const tmp = `${file}.tmp`
  const handle = await open(tmp, 'w')
  try {
    await handle.writeFile(json, 'utf-8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(tmp, file)
}

/** 同步版原子写：退出冲刷专用（退出路径等不了异步回调） */
function writeFileAtomicSync(file: string, json: string): void {
  const tmp = `${file}.tmp`
  const fd = openSync(tmp, 'w')
  try {
    const buf = Buffer.from(json, 'utf-8')
    let written = 0
    while (written < buf.length) written += writeSync(fd, buf, written)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tmp, file)
}

export function createStore(paths: () => StorePaths): Store {
  let cache: QinkData = defaultData()
  let saveTimer: NodeJS.Timeout | null = null

  /** 防抖保存：高频操作（打字、拖动松手）合并成一次落盘。 */
  function queueSave(): void {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void persist()
    }, DEBOUNCE_MS)
  }

  async function persist(): Promise<void> {
    const json = JSON.stringify(cache, null, 2)
    const { dataFile, backupFile } = paths()
    try {
      await mkdir(dirname(dataFile), { recursive: true })
      await writeFileAtomic(dataFile, json)
    } catch (err) {
      // 主文件落盘失败不致命（内存态仍正确），下次任何 queueSave 会再试
      console.error('[qink] 保存数据失败:', err)
    }
    try {
      await mkdir(dirname(backupFile), { recursive: true })
      await writeFileAtomic(backupFile, json)
    } catch {
      // 备份失败静默：备份只是保险，不是主路径
    }
  }

  return {
    async load(): Promise<LoadOutcome> {
      const { dataFile, backupFile } = paths()
      const quarantined: string[] = []

      const main = await readOne(dataFile)
      if (main.kind === 'ok') {
        cache = main.data
        return { source: 'main', quarantined }
      }
      if (main.kind === 'corrupt') {
        const kept = await quarantine(dataFile)
        if (kept) quarantined.push(kept)
        console.error('[qink] 主数据文件损坏，已留证为', kept ?? `${dataFile}.corrupt（改名失败，原件原地保留）`)
      }

      const backup = await readOne(backupFile)
      if (backup.kind === 'ok') {
        cache = backup.data
        return { source: 'backup', quarantined }
      }
      if (backup.kind === 'corrupt') {
        const kept = await quarantine(backupFile)
        if (kept) quarantined.push(kept)
        console.error('[qink] 备份文件损坏，已留证为', kept ?? `${backupFile}.corrupt（改名失败，原件原地保留）`)
      }

      // 双坏（或主坏备缺）：从空白开始。上层据 quarantined 弹窗告知用户，坏档已留证可手动抢救。
      cache = defaultData()
      return { source: 'fresh', quarantined }
    },

    get(): QinkData {
      return cache
    },

    /** 渲染层是状态源：每次变更发全量数据过来，主进程负责落盘。 */
    set(next: QinkData): void {
      cache = { ...defaultData(), ...next }
      queueSave()
    },

    queueSave,

    flushPendingSync(): void {
      if (!saveTimer) return
      clearTimeout(saveTimer)
      saveTimer = null
      const json = JSON.stringify(cache, null, 2)
      const { dataFile, backupFile } = paths()
      for (const file of [dataFile, backupFile]) {
        try {
          mkdirSync(dirname(file), { recursive: true })
          writeFileAtomicSync(file, json)
        } catch (err) {
          console.error('[qink] 退出冲刷失败:', file, err)
        }
      }
    }
  }
}
