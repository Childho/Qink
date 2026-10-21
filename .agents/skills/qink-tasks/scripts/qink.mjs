#!/usr/bin/env node
// qink.mjs —— qink-tasks skill 的命令行入口：读/写 Qink 数据文件（文档/Qink/data.json）。
//
// 安全模型（ADR-0010）：
//   读  —— 坏 JSON / 形状不对 → 拒绝写入并报错，绝不覆盖现场；
//   写  —— 校验通过的数据经「tmp + fsync + rename 原子写」落主文件，并同步写
//          AppData 备份（与 Qink 自身 store-io 相同的双写策略）；
//   核验 —— 写后等一个 Qink 防抖周期（300ms）再读回核验；若被 Qink 内存态顶掉
//          （撞车窗口：用户正好有未落盘编辑），基于最新文件重试一次，仍失败如实报错。
//
// 破坏性操作（delete / replace）必须显式 --yes：调用方（AI）要先向用户列出
// 受影响任务并取得确认（见 SKILL.md 确认门槛）。
//
// 用法：
//   node qink.mjs read
//   node qink.mjs add      '[{"text":"写周报","due":"15:30"},{"text":"标记项","pinned":true}]'
//   node qink.mjs complete '{"text":"写周报"}'
//   node qink.mjs delete   '{"id":"…"}' --yes
//   node qink.mjs goal     quarter '发布 Qink 1.0'
//   node qink.mjs goal     week --clear
//   node qink.mjs replace  '[{"text":"只有这一件事"}]' --yes
//   可选：--file=路径（显式指定 data.json）、--yes（破坏性操作放行）
//
// 输出一律为 JSON：{ ok, ... }；退出码 0=成功 1=失败 2=破坏性操作待确认。

import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import os from 'node:os'
import {
  applyOps, dateKey, dueStatus, emptyData, isRolledIn, periodKeyFor, validateQinkData, verifyApplied
} from './qink-core.mjs'

const args = process.argv.slice(2)
const command = args[0]
const flags = new Set(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')[0]))
const positionals = args.slice(1).filter((a) => !a.startsWith('--'))
const flagValue = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

const output = (obj) => console.log(JSON.stringify(obj, null, 2))
const fail = (error, extra = {}) => {
  output({ ok: false, error, ...extra })
  process.exit(1)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ---------- 路径解析：优先级 显式 --file > 环境变量 QINK_DATA > 系统文档目录 ---------- */

function documentsDir() {
  if (process.platform === 'win32') {
    try {
      // PowerShell 问的是系统「已知文件夹」（被 OneDrive 重定向也拿真身）；开头切 UTF8 防中文用户名乱码
      const out = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command',
          "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;[Console]::Out.Write([Environment]::GetFolderPath('MyDocuments'))"],
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim()
      if (out) return out
    } catch {
      /* 回退到 homedir/Documents */
    }
  }
  return join(os.homedir(), 'Documents')
}

/** 备份文件与 Qink 自身约定一致：userData 目录下 data-backup.json（找不到既有目录时按默认名落） */
function guessBackup() {
  const bases = []
  if (process.platform === 'win32' && process.env.APPDATA) {
    bases.push(join(process.env.APPDATA, 'qink'), join(process.env.APPDATA, 'Qink'))
  } else if (process.platform === 'darwin') {
    bases.push(join(os.homedir(), 'Library', 'Application Support', 'qink'),
      join(os.homedir(), 'Library', 'Application Support', 'Qink'))
  }
  for (const b of bases) {
    const f = join(b, 'data-backup.json')
    if (existsSync(f)) return f
  }
  return bases[0] ? join(bases[0], 'data-backup.json') : null
}

function resolvePaths() {
  const explicit = flagValue('file')
  if (explicit) return { dataFile: explicit, backupFile: null }
  const envFile = process.env.QINK_DATA
  if (envFile) return { dataFile: envFile, backupFile: guessBackup() }
  const candidates = [join(documentsDir(), 'Qink', 'data.json'), join(os.homedir(), 'Documents', 'Qink', 'data.json')]
  const dataFile = candidates.find((f) => existsSync(f)) ?? candidates[0]
  return { dataFile, backupFile: guessBackup() }
}

/* ---------- 环境探测：Qink 是否在跑（决定写入是「热重载实时刷新」还是「下次启动生效」） ---------- */

function detectQink() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Qink.exe', '/NH'],
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
      return out.includes('Qink.exe')
    }
    execFileSync('pgrep', ['-x', 'Qink'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/* ---------- 读写（原子写复刻 store-io 的 tmp + fsync + rename） ---------- */

function readData(file) {
  let raw
  try {
    raw = readFileSync(file, 'utf-8')
  } catch {
    return emptyData() // ENOENT = 首次运行
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    fail(`data.json 不是合法 JSON，拒绝写入以保护现场：${file}`)
  }
  const v = validateQinkData(parsed)
  if (!v.ok) fail(`data.json 结构校验失败，拒绝写入：${v.reason}`)
  return parsed
}

function atomicWrite(file, json) {
  mkdirSync(dirname(file), { recursive: true })
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

function writeBoth({ dataFile, backupFile }, data) {
  const json = JSON.stringify(data, null, 2)
  atomicWrite(dataFile, json)
  if (backupFile) {
    try {
      atomicWrite(backupFile, json)
    } catch (err) {
      console.error('[qink-tasks] 备份写入失败（不影响主文件）：', err.message)
    }
  }
}

/* ---------- 命令与主流程 ---------- */

function parseJSONPayload(what) {
  try {
    return JSON.parse(positionals[0])
  } catch {
    return fail(`${what} 的参数不是合法 JSON：${positionals[0] ?? '(空)'}`)
  }
}

function buildOps() {
  switch (command) {
    case 'add': {
      let items = parseJSONPayload('add')
      if (!Array.isArray(items)) items = [items]
      return { add: items }
    }
    case 'complete':
    case 'delete': {
      let matchers = parseJSONPayload(command)
      if (!Array.isArray(matchers)) matchers = [matchers]
      return command === 'complete' ? { complete: matchers } : { delete: matchers }
    }
    case 'replace': {
      let items = parseJSONPayload('replace')
      if (!Array.isArray(items)) items = [items]
      return { replace: items }
    }
    case 'goal': {
      const kind = positionals[0]
      if (!['quarter', 'month', 'week'].includes(kind)) fail('goal 第一个参数需是 quarter | month | week')
      const text = positionals.slice(1).join(' ').trim()
      const clear = flags.has('clear')
      if (!text && !clear) fail('goal 需要目标文本，或 --clear 清除该周期目标')
      return { goal: { kind, text, clear } }
    }
    default:
      return fail(`未知命令「${command}」。可用：read / add / complete / delete / goal / replace`)
  }
}

/** read 的机器可读摘要：目标（含周期是否当前）、任务（含分区）、归档计数 */
function summarize(data, now) {
  const goals = {}
  for (const kind of ['quarter', 'month', 'week']) {
    const stored = data.goals[kind] ?? null
    const current = periodKeyFor(kind, now)
    goals[kind] = stored
      ? { text: stored.text, periodKey: stored.periodKey, current, effective: stored.periodKey === current }
      : null
  }
  const zoneOf = (t) => {
    if (t.dueAt && (dueStatus(t.dueAt, now) === 'urgent' || dueStatus(t.dueAt, now) === 'overdue')) return 'urgent'
    if (t.pinned) return 'pinned'
    if (isRolledIn(t.createdAt, now)) return 'rolled'
    return 'today'
  }
  return {
    today: dateKey(now),
    goals,
    tasks: data.tasks.map((t) => ({
      id: t.id, text: t.text, zone: zoneOf(t), dueAt: t.dueAt ?? null,
      pinned: t.pinned === true, createdAt: t.createdAt
    })),
    archiveCount: data.archive.length
  }
}

async function main() {
  if (!command) fail('缺少命令。可用：read / add / complete / delete / goal / replace')
  const now = new Date()
  const paths = resolvePaths()
  const qinkRunning = detectQink()
  const pathsInfo = { dataFile: paths.dataFile, backupFile: paths.backupFile, qinkRunning, note: qinkRunning ? 'Qink 运行中，写入将热重载实时刷新（需 0.4.0+）' : 'Qink 未运行，写入将在下次启动时生效' }

  if (command === 'read') {
    const data = readData(paths.dataFile)
    output({ ok: true, ...pathsInfo, ...summarize(data, now), data })
    return
  }

  const ops = buildOps()
  const data = readData(paths.dataFile)
  const applied = applyOps(data, ops, now)
  if (!applied.ok) fail(applied.reason)

  const r = applied.report
  const changed = r.added.length > 0 || r.completed.length > 0 || r.deleted.length > 0 || r.goal !== null || r.replaced !== null

  // 破坏性操作门槛：delete/replace 必须显式 --yes（AI 应已在对话里列清单征得用户同意）
  if ((command === 'delete' || command === 'replace') && changed && !flags.has('yes')) {
    output({ ok: false, needsConfirmation: true, plan: r, hint: '破坏性操作需 --yes：请先向用户列出受影响任务并获得确认后重跑' })
    process.exit(2)
  }

  if (!changed) {
    // 没有任何有效变更（全是重复/未命中）：不写盘，如实汇报
    output({ ok: true, changed: false, report: r, ...pathsInfo })
    return
  }

  writeBoth(paths, applied.data)

  // 撞车核验（ADR-0010 撞车规则）：Qink 若在 300ms 防抖窗口内有未落盘编辑，会用自己的
  // 内存态覆盖本次写入。等一个周期后读回核验；被顶掉则基于最新文件重试一次。
  await sleep(700)
  let disk = readData(paths.dataFile)
  if (!verifyApplied(disk, applied.report)) {
    const retry = applyOps(disk, ops, now)
    if (!retry.ok) fail(`写入被并发修改顶掉，基于最新文件重试失败：${retry.reason}`)
    writeBoth(paths, retry.data)
    await sleep(500)
    disk = readData(paths.dataFile)
    if (!verifyApplied(disk, retry.report)) {
      fail('写入后核验两次失败：Qink 可能正在持续写盘，请稍后重试', { report: retry.report, ...pathsInfo })
    }
    output({ ok: true, retried: true, report: retry.report, ...pathsInfo })
    return
  }
  output({ ok: true, report: applied.report, ...pathsInfo })
}

main().catch((err) => fail(err?.stack ?? String(err)))
