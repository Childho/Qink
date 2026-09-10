import { describe, expect, it } from 'vitest'
import {
  dateKey,
  quarterKey,
  monthKey,
  weekKey,
  daysSince,
  isRolledIn,
  effectiveGoal
} from '../src/shared/dates'

describe('周期键：自然边界', () => {
  it('季：自然季 1-3/4-6/7-9/10-12', () => {
    expect(quarterKey(new Date(2026, 8, 10))).toBe('2026-Q3') // 9月10日
    expect(quarterKey(new Date(2026, 0, 1))).toBe('2026-Q1') // 1月1日
    expect(quarterKey(new Date(2026, 2, 31))).toBe('2026-Q1') // 3月31日
    expect(quarterKey(new Date(2026, 3, 1))).toBe('2026-Q2') // 4月1日
    expect(quarterKey(new Date(2026, 11, 31))).toBe('2026-Q4') // 12月31日
    expect(quarterKey(new Date(2027, 0, 1))).toBe('2027-Q1') // 跨年即跨季
  })

  it('月：自然月', () => {
    expect(monthKey(new Date(2026, 8, 1))).toBe('2026-09')
    expect(monthKey(new Date(2026, 8, 30))).toBe('2026-09')
    expect(monthKey(new Date(2026, 11, 31))).toBe('2026-12')
  })

  it('周：周一为一周之始，周日与周一同周', () => {
    // 2026-09-07 是周一、2026-09-13 是周日，同属 2026-W37
    expect(weekKey(new Date(2026, 8, 7))).toBe('2026-W37')
    expect(weekKey(new Date(2026, 8, 13))).toBe('2026-W37')
  })

  it('周：年初 1 月 1 日按 ISO 归属（周四所在年）', () => {
    expect(weekKey(new Date(2026, 0, 1))).toBe('2026-W01') // 2026-01-01 周四 → W01
    // 2027-01-01 是周五，属于 2026 年最后一周（2026-12-31 周四）
    expect(weekKey(new Date(2027, 0, 1))).toBe('2026-W53')
    expect(weekKey(new Date(2026, 11, 31))).toBe('2026-W53')
  })
})

describe('翻篇与滚入', () => {
  it('今天创建的任务不是滚入任务', () => {
    const now = new Date(2026, 8, 10, 15, 0)
    expect(isRolledIn('2026-09-10T08:00:00', now)).toBe(false)
    expect(daysSince('2026-09-10T00:30:00', now)).toBe(0)
  })

  it('刚过午夜：昨晚 23:59 的任务是滚入任务，拖延 1 天', () => {
    const now = new Date(2026, 8, 10, 0, 5)
    expect(isRolledIn('2026-09-09T23:59:00', now)).toBe(true)
    expect(daysSince('2026-09-09T23:59:00', now)).toBe(1)
  })

  it('修复回来的老任务拖延天数如实（跨 3 个午夜 = 3 天）', () => {
    const now = new Date(2026, 8, 10, 12, 0)
    expect(daysSince('2026-09-07T09:00:00', now)).toBe(3)
  })
})

describe('目标失效（周期更替）', () => {
  it('周期键不匹配 → 失效', () => {
    const stale = { periodKey: '2026-W36', text: '旧目标' }
    expect(effectiveGoal(stale, 'week', new Date(2026, 8, 10))).toBeNull()
  })

  it('周期键匹配 → 有效', () => {
    const goal = { periodKey: '2026-W37', text: '当前目标' }
    expect(effectiveGoal(goal, 'week', new Date(2026, 8, 10))).toBe('当前目标')
  })

  it('月末跨月：30 日的月目标到 1 日失效', () => {
    const goal = { periodKey: '2026-09', text: '九月目标' }
    expect(effectiveGoal(goal, 'month', new Date(2026, 8, 30))).toBe('九月目标')
    expect(effectiveGoal(goal, 'month', new Date(2026, 9, 1))).toBeNull()
  })
})

describe('日期键', () => {
  it('本地日期键用于归档翻日', () => {
    expect(dateKey(new Date(2026, 8, 10, 23, 59))).toBe('2026-09-10')
    expect(dateKey(new Date(2026, 0, 3, 0, 0))).toBe('2026-01-03')
  })
})
