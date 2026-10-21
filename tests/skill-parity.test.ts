import { describe, expect, it } from 'vitest'
import { dateKey, daysSince, isRolledIn, monthKey, quarterKey, weekKey } from '../src/shared/dates'
import { dueStatus, parseDueInput } from '../src/shared/due'
import {
  applyOps,
  dateKey as sDateKey,
  daysSince as sDaysSince,
  dueStatus as sDueStatus,
  emptyData,
  isRolledIn as sIsRolledIn,
  monthKey as sMonthKey,
  parseDueInput as sParseDueInput,
  quarterKey as sQuarterKey,
  verifyApplied,
  weekKey as sWeekKey
} from '../.agents/skills/qink-tasks/scripts/qink-core.mjs'

// qink-tasks skill（.agents/skills/qink-tasks）为读写数据文件复刻了一份纯逻辑
// （dueAt 解析、周期键等）。本文件做两件事：
//   ① 奇偶校验——复刻实现与 src/shared 源实现逐值对齐（改 shared 不同步 skill 会红）；
//   ② skill 数据操作语义——add 去重 / complete 入档 / delete / goal / replace / 整批拒绝。

const NOW = new Date(2026, 9, 21, 10, 0) // 2026-10-21（周三）10:00 本地

describe('skill 奇偶校验：周期键与日期键', () => {
  it('2026 全年逐日（含年末跨年、ISO 周归属边界）四个键全部一致', () => {
    // 从 2026-01-01 到 2027-01-10：覆盖 2026-W53 跨年周与元旦归属
    for (let i = 0; i <= 375; i++) {
      const d = new Date(2026, 0, 1 + i, 12) // 正午取样，避开午夜时区边缘
      expect(sDateKey(d), `dateKey @ ${d.toString()}`).toBe(dateKey(d))
      expect(sWeekKey(d), `weekKey @ ${d.toString()}`).toBe(weekKey(d))
      expect(sMonthKey(d), `monthKey @ ${d.toString()}`).toBe(monthKey(d))
      expect(sQuarterKey(d), `quarterKey @ ${d.toString()}`).toBe(quarterKey(d))
    }
  })

  it('daysSince / isRolledIn（今日、昨日、跨月、跨年）', () => {
    const cases = [
      '2026-10-21T23:00:00.000Z',
      '2026-10-20T01:00:00.000Z',
      '2026-09-30T12:00:00.000Z',
      '2025-12-31T00:00:00.000Z'
    ]
    for (const iso of cases) {
      expect(sDaysSince(iso, NOW)).toBe(daysSince(iso, NOW))
      expect(sIsRolledIn(iso, NOW)).toBe(isRolledIn(iso, NOW))
    }
  })
})

describe('skill 奇偶校验：dueAt 解析与状态', () => {
  it('窄语法全语法域（合法/已过/越界/乱码/全角）逐条一致', () => {
    const inputs = [
      '15', '15:30', '9', '0:00', '0', '24:00', '23', '23:59', '15:60', '99',
      '9/30', '10/21', '10/22', '2/29', '2/30', '12/31', '1/1', '13/1', '0/5',
      '明天', '后天', '明 天', '', 'abc', '15：30', '15:3', '明天 15:00'
    ]
    const nows = [
      new Date(2026, 9, 21, 10, 0),
      new Date(2026, 9, 21, 23, 30),
      new Date(2026, 11, 31, 10, 0),
      new Date(2027, 1, 1, 9, 0),
      new Date(2028, 1, 1, 9, 0)
    ]
    for (const now of nows) {
      for (const input of inputs) {
        expect(sParseDueInput(input, now), `parseDueInput(${JSON.stringify(input)}) @ ${now.toString()}`)
          .toEqual(parseDueInput(input, now))
      }
    }
  })

  it('dueStatus 判定表（日期粒度 D-1/D/D+1 与时刻粒度今天）逐条一致', () => {
    const dueAts = [
      '2026-10-21T00:00:00', '2026-10-22T00:00:00', '2026-10-23T00:00:00', '2026-10-20T00:00:00',
      '2026-10-21T09:00:00', '2026-10-21T11:00:00', '2027-01-15T00:00:00'
    ]
    for (const dueAt of dueAts) {
      expect(sDueStatus(dueAt, NOW), `dueStatus(${dueAt})`).toBe(dueStatus(dueAt, NOW))
    }
  })
})

describe('skill 数据操作语义（applyOps / verifyApplied）', () => {
  it('add：生成 id/createdAt，同文本去重，due 语法解析，pinned 可选', () => {
    const base = emptyData()
    base.tasks.push({ id: 'exist', text: '写周报', createdAt: '2026-10-21T01:00:00.000Z' })
    const r = applyOps(base, {
      add: [
        { text: '写周报' },
        { text: '复核 PR', due: '15:30' },
        { text: '标记项', pinned: true },
        { text: '  整理收件箱  ' }
      ]
    }, NOW)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.tasks).toHaveLength(4)
    expect(r.report.skippedDuplicate).toEqual(['写周报'])
    expect(r.report.added).toHaveLength(3)
    const due = r.data.tasks.find((t) => t.text === '复核 PR')
    expect(due?.dueAt).toBe('2026-10-21T15:30:00')
    expect(due?.pinned).toBeUndefined()
    expect(r.data.tasks.find((t) => t.text === '标记项')?.pinned).toBe(true)
    expect(r.data.tasks.find((t) => t.text === '整理收件箱')).toBeTruthy() // 文本已 trim
    expect(verifyApplied(r.data, r.report)).toBe(true)
  })

  it('complete：按 id/文本移入 archive（completedAt 为 UTC ISO）；delete 直接移除', () => {
    const base = emptyData()
    base.tasks.push(
      { id: 'a', text: '写周报', createdAt: '2026-10-21T01:00:00.000Z' },
      { id: 'b', text: '复核 PR', createdAt: '2026-10-21T01:01:00.000Z', dueAt: '2026-10-21T15:30:00' }
    )
    const done = applyOps(base, { complete: [{ text: '写周报' }, { id: 'b' }] }, NOW)
    expect(done.ok).toBe(true)
    if (!done.ok) return
    expect(done.data.tasks).toHaveLength(0)
    expect(done.data.archive).toHaveLength(2)
    const pr = done.data.archive.find((x) => (x as { id?: string }).id === 'b') as
      | { dueAt?: string; completedAt?: string }
      | undefined
    expect(pr?.dueAt).toBe('2026-10-21T15:30:00') // 完成时截止时间原样入档
    expect(typeof pr?.completedAt).toBe('string')
    expect(pr?.completedAt?.endsWith('Z')).toBe(true)
    expect(verifyApplied(done.data, done.report)).toBe(true)

    const base2 = emptyData()
    base2.tasks.push({ id: 'a', text: '写周报', createdAt: '2026-10-21T01:00:00.000Z' })
    const del = applyOps(base2, { delete: [{ text: '写周报' }, { text: '不存在' }] }, NOW)
    expect(del.ok).toBe(true)
    if (!del.ok) return
    expect(del.data.tasks).toHaveLength(0)
    expect(del.report.deleted).toHaveLength(1)
    expect(del.report.notFound).toEqual([JSON.stringify({ text: '不存在' })])
    expect(verifyApplied(del.data, del.report)).toBe(true)
  })

  it('goal：写当前周期键（与 shared 源实现一致）；clear 置 null', () => {
    const r = applyOps(emptyData(), { goal: { kind: 'week', text: '交付热重载', clear: false } }, NOW)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.goals.week).toEqual({ periodKey: weekKey(NOW), text: '交付热重载' })
    expect(verifyApplied(r.data, r.report)).toBe(true)

    const cleared = applyOps(r.data, { goal: { kind: 'week', text: '', clear: true } }, NOW)
    expect(cleared.ok).toBe(true)
    if (!cleared.ok) return
    expect(cleared.data.goals.week).toBeNull()
    expect(verifyApplied(cleared.data, cleared.report)).toBe(true)
  })

  it('replace：整表替换任务数组（oldCount 记账）', () => {
    const base = emptyData()
    base.tasks.push(
      { id: 'old1', text: '旧一', createdAt: '2026-10-20T01:00:00.000Z' },
      { id: 'old2', text: '旧二', createdAt: '2026-10-20T02:00:00.000Z' }
    )
    const r = applyOps(base, { replace: [{ text: '只有这一件事', due: '明天' }] }, NOW)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.tasks).toHaveLength(1)
    expect(r.data.tasks[0].text).toBe('只有这一件事')
    expect(r.report.replaced?.oldCount).toBe(2)
    expect(verifyApplied(r.data, r.report)).toBe(true)
  })

  it('非法输入整批拒绝（all-or-nothing）：due 乱码时一条都不加', () => {
    const r = applyOps(emptyData(), { add: [{ text: '好的' }, { text: '坏的', due: '乱码' }] }, NOW)
    expect(r.ok).toBe(false)
    expect(r).not.toHaveProperty('data')
  })

  it('verifyApplied 对「被顶掉」的盘面如实返回 false（撞车检测依据）', () => {
    const base = emptyData()
    const r = applyOps(base, { add: [{ text: '新任务' }] }, NOW)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(verifyApplied(base, r.report)).toBe(false) // 盘面仍是旧数据 → 检出被顶掉
  })
})
