import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { access, constants, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createStore, defaultData, type Store } from '../src/main/store-io'

// 用真实文件系统 + 临时目录直测耐久策略（原子写 / 坏档留证 / 防抖 / 退出冲刷）。
// 这一层此前零测试，是 2026-10-09 审查（docs/review/06）确认的数据安全最后防线。

let dir = ''
let dataFile = ''
let backupFile = ''
let store: Store

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qink-store-'))
  // 主文件与备份放不同子目录：顺带验证 mkdir recursive 建路径的能力
  dataFile = join(dir, 'docs', 'Qink', 'data.json')
  backupFile = join(dir, 'app', 'data-backup.json')
  store = createStore(() => ({ dataFile, backupFile }))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function exists(file: string): Promise<boolean> {
  try {
    await access(file, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/** 真实定时器轮询等待（防抖 300ms 是真实延时，不用假定时器掺和真实 fs） */
async function until(cond: () => Promise<boolean>, ms = 3000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < ms) {
    if (await cond()) return
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error('等待条件超时')
}

async function filesWithSuffix(suffix: string): Promise<string[]> {
  const found: string[] = []
  for (const sub of ['docs/Qink', 'app']) {
    try {
      found.push(...(await readdir(join(dir, sub))).filter((f) => f.endsWith(suffix)))
    } catch {
      // 目录还不存在 = 没有残留
    }
  }
  return found
}

describe('加载与恢复链', () => {
  it('首次运行：两文件都不存在 → 全新开始，无坏档', async () => {
    const out = await store.load()
    expect(out.source).toBe('fresh')
    expect(out.quarantined).toEqual([])
    expect(store.get()).toEqual(defaultData())
  })

  it('主文件坏、备份好 → 从备份恢复，坏档留证为 .corrupt 且内容原样', async () => {
    const garbage = '{"tasks": [打到一半被拔电'
    await mkdir(dirname(dataFile), { recursive: true })
    await writeFile(dataFile, garbage, 'utf-8')
    const saved = defaultData()
    saved.tasks.push({ id: 'b1', text: '从备份活下来', createdAt: '2026-10-09T01:00:00.000Z' })
    await mkdir(dirname(backupFile), { recursive: true })
    await writeFile(backupFile, JSON.stringify(saved), 'utf-8')

    const out = await store.load()
    expect(out.source).toBe('backup')
    expect(store.get().tasks.map((t) => t.id)).toEqual(['b1'])
    // 现场保住了：坏内容原样躺在 .corrupt 里，原位已让给下次重建
    expect(await readFile(`${dataFile}.corrupt`, 'utf-8')).toBe(garbage)
    expect(await exists(dataFile)).toBe(false)
  })

  it('恢复后 queueSave 重建主文件，内容与备份一致', async () => {
    const saved = defaultData()
    saved.settings.noteX = 320
    await mkdir(dirname(backupFile), { recursive: true })
    await writeFile(backupFile, JSON.stringify(saved), 'utf-8')
    await store.load()

    store.queueSave()
    await until(() => exists(dataFile))
    expect(JSON.parse(await readFile(dataFile, 'utf-8')).settings.noteX).toBe(320)
  })

  it('主文件缺失、备份好（M4 真实事故：文档目录被外部删除）→ 从备份恢复，无坏档', async () => {
    const saved = defaultData()
    saved.archive.push({ id: 'a1', text: '旧账', createdAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-02T00:00:00.000Z' })
    await mkdir(dirname(backupFile), { recursive: true })
    await writeFile(backupFile, JSON.stringify(saved), 'utf-8')

    const out = await store.load()
    expect(out.source).toBe('backup')
    expect(out.quarantined).toEqual([])
    expect(store.get().archive.map((a) => a.id)).toEqual(['a1'])
  })

  it('双坏 → 从空白开始，两个坏档都留证（不再静默销毁现场）', async () => {
    const bad1 = 'not json at all'
    const bad2 = '{"half": '
    await mkdir(dirname(dataFile), { recursive: true })
    await writeFile(dataFile, bad1, 'utf-8')
    await mkdir(dirname(backupFile), { recursive: true })
    await writeFile(backupFile, bad2, 'utf-8')

    const out = await store.load()
    expect(out.source).toBe('fresh')
    expect(out.quarantined).toEqual([`${dataFile}.corrupt`, `${backupFile}.corrupt`])
    expect(await readFile(`${dataFile}.corrupt`, 'utf-8')).toBe(bad1)
    expect(await readFile(`${backupFile}.corrupt`, 'utf-8')).toBe(bad2)
    expect(store.get()).toEqual(defaultData())
  })

  it('合法 JSON 但不是对象（数组）→ 视为损坏留证', async () => {
    await mkdir(dirname(dataFile), { recursive: true })
    await writeFile(dataFile, '[1,2,3]', 'utf-8')

    const out = await store.load()
    expect(out.source).toBe('fresh')
    expect(out.quarantined).toEqual([`${dataFile}.corrupt`])
  })
})

describe('保存', () => {
  it('防抖窗口内不落盘，多次 set 合并为最后一次', async () => {
    await store.load()
    const a = defaultData()
    a.tasks.push({ id: 'a', text: '第一次输入', createdAt: '2026-10-09T01:00:00.000Z' })
    store.set(a)
    await new Promise((r) => setTimeout(r, 100))
    expect(await exists(dataFile)).toBe(false)

    const b = defaultData()
    b.tasks.push({ id: 'b', text: '改了又改', createdAt: '2026-10-09T01:00:01.000Z' })
    store.set(b)
    await until(() => exists(dataFile))
    expect(JSON.parse(await readFile(dataFile, 'utf-8')).tasks[0].id).toBe('b')
  })

  it('主文件与备份双写内容一致，且不留 .tmp 残留；再次保存时 rename 顶替旧文件', async () => {
    await store.load()
    const v1 = defaultData()
    v1.settings.noteY = 100
    store.set(v1)
    await until(async () => (await exists(dataFile)) && (await exists(backupFile)))
    expect(await readFile(backupFile, 'utf-8')).toBe(await readFile(dataFile, 'utf-8'))

    const v2 = defaultData()
    v2.settings.noteY = 200
    store.set(v2)
    await until(async () => (await readFile(dataFile, 'utf-8')) !== JSON.stringify(v1, null, 2))
    expect(JSON.parse(await readFile(dataFile, 'utf-8')).settings.noteY).toBe(200)
    expect(await readFile(backupFile, 'utf-8')).toBe(JSON.stringify(v2, null, 2))
    expect(await filesWithSuffix('.tmp')).toEqual([])
  })
})

describe('退出冲刷', () => {
  it('挂起的防抖写被同步落盘，定时器清除后不再重复写', async () => {
    await store.load()
    const d = defaultData()
    d.settings.noteX = 555
    store.set(d)

    store.flushPendingSync() // 不等 300ms 防抖，立刻完成
    const snapshot = await readFile(dataFile, 'utf-8')
    expect(JSON.parse(snapshot).settings.noteX).toBe(555)
    expect(await exists(backupFile)).toBe(true)

    const backupSnapshot = await readFile(backupFile, 'utf-8')
    await new Promise((r) => setTimeout(r, 450))
    expect(await readFile(dataFile, 'utf-8')).toBe(snapshot)
    expect(await readFile(backupFile, 'utf-8')).toBe(backupSnapshot)
    expect(await filesWithSuffix('.tmp')).toEqual([])
  })

  it('无挂起写时调用是零动作，不抛错', async () => {
    await store.load()
    expect(() => store.flushPendingSync()).not.toThrow()
    expect(await exists(dataFile)).toBe(false)
  })
})
