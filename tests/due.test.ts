// src/shared/due.ts 的判定表与输入解析：纯函数直测。
// 时间基准：2026-09-27（周日）12:00 为「今天」。粒度约定：dueAt 0 点 = 日期，非 0 = 时刻。

import { describe, expect, it } from 'vitest'
import { dueHint, dueStatus, isDueHot, parseDueInput } from '../src/shared/due'

const NOW = new Date('2026-09-27T12:00:00')

describe('dueStatus 判定表（spec 唯一事实表）', () => {
  it('日期任务：今天 < D-1 → future；= D-1 → tomorrow；= D → urgent；> D → overdue', () => {
    expect(dueStatus('2026-10-05T00:00:00', NOW)).toBe('future') // 8 天后
    expect(dueStatus('2026-09-28T00:00:00', NOW)).toBe('tomorrow') // 明天（27 的 +1 天）
    expect(dueStatus('2026-09-27T00:00:00', NOW)).toBe('urgent') // D = 今天（全天紧急）
    expect(dueStatus('2026-09-26T00:00:00', NOW)).toBe('overdue') // 昨天到期，已过完
  })

  it('时刻任务：now < T → urgent；now ≥ T → overdue；跨夜后 → overdue', () => {
    expect(dueStatus('2026-09-27T15:00:00', NOW)).toBe('urgent')
    expect(dueStatus('2026-09-27T11:59:00', NOW)).toBe('overdue')
    // 昨天 23:00 设的时刻任务，今天看
    expect(dueStatus('2026-09-26T23:00:00', NOW)).toBe('overdue')
  })

  it('时刻任务判定取时刻边界而非日期边界（12:00 前后同日不同状态）', () => {
    expect(dueStatus('2026-09-27T12:00:00', NOW)).toBe('overdue') // 恰好到点 = 逾期
    expect(dueStatus('2026-09-27T12:01:00', NOW)).toBe('urgent')
  })

  it('isDueHot：紧急与逾期为热态（自动置顶区），其余与无时间任务为否', () => {
    expect(isDueHot('2026-09-27T15:00:00', NOW)).toBe(true)
    expect(isDueHot('2026-09-26T00:00:00', NOW)).toBe(true)
    expect(isDueHot('2026-09-29T00:00:00', NOW)).toBe(false)
    expect(isDueHot(undefined, NOW)).toBe(false)
  })

  it('dueHint：明天 → 「明天」，更远 → 「M/D」，紧急/逾期/无时间 → null', () => {
    expect(dueHint('2026-09-28T00:00:00', NOW)).toBe('明天')
    expect(dueHint('2026-09-29T00:00:00', NOW)).toBe('9/29')
    expect(dueHint('2026-10-05T00:00:00', NOW)).toBe('10/5')
    expect(dueHint('2026-09-27T15:00:00', NOW)).toBe(null) // 紧急不加文字
    expect(dueHint('2026-09-26T00:00:00', NOW)).toBe(null) // 逾期不加文字
    expect(dueHint(undefined, NOW)).toBe(null)
  })
})

describe('parseDueInput 语法解析', () => {
  it('H / H:MM → 今天时刻（本地 ISO 无时区）', () => {
    expect(parseDueInput('15', NOW)).toEqual({ ok: true, dueAt: '2026-09-27T15:00:00' })
    expect(parseDueInput('15:30', NOW)).toEqual({ ok: true, dueAt: '2026-09-27T15:30:00' })
    expect(parseDueInput('19:5', NOW)).toEqual({ ok: true, dueAt: '2026-09-27T19:05:00' })
    expect(parseDueInput('23:59', NOW)).toEqual({ ok: true, dueAt: '2026-09-27T23:59:00' })
  })

  it('M/D → 日期（0 点粒度）；当天有效 = 全天紧急', () => {
    expect(parseDueInput('9/29', NOW)).toEqual({ ok: true, dueAt: '2026-09-29T00:00:00' })
    expect(parseDueInput('10/2', NOW)).toEqual({ ok: true, dueAt: '2026-10-02T00:00:00' })
    expect(parseDueInput('9/27', NOW)).toEqual({ ok: true, dueAt: '2026-09-27T00:00:00' })
  })

  it('明天 / 后天 → 相对日期', () => {
    expect(parseDueInput('明天', NOW)).toEqual({ ok: true, dueAt: '2026-09-28T00:00:00' })
    expect(parseDueInput('后天', NOW)).toEqual({ ok: true, dueAt: '2026-09-29T00:00:00' })
  })

  it('未来最近匹配：今年该日已过 → 顺延一年', () => {
    const dec = new Date('2026-12-01T10:00:00')
    expect(parseDueInput('1/5', dec)).toEqual({ ok: true, dueAt: '2027-01-05T00:00:00' })
    expect(parseDueInput('12/25', dec)).toEqual({ ok: true, dueAt: '2026-12-25T00:00:00' })
  })

  it('已过时刻拒绝（多半是输错）；恰好等于现在也拒绝', () => {
    const afternoon = new Date('2026-09-27T16:00:00')
    expect(parseDueInput('15', afternoon)).toEqual({ ok: false })
    expect(parseDueInput('16:00', afternoon)).toEqual({ ok: false })
    expect(parseDueInput('16:01', afternoon)).toEqual({ ok: true, dueAt: '2026-09-27T16:01:00' })
  })

  it('0:00 拒绝（与日期粒度歧义）', () => {
    expect(parseDueInput('0:00', NOW)).toEqual({ ok: false })
    expect(parseDueInput('00:0', NOW)).toEqual({ ok: false })
  })

  it('越界与无效日期拒绝', () => {
    expect(parseDueInput('24:00', NOW)).toEqual({ ok: false })
    expect(parseDueInput('12:60', NOW)).toEqual({ ok: false })
    expect(parseDueInput('13/1', NOW)).toEqual({ ok: false })
    expect(parseDueInput('2/30', NOW)).toEqual({ ok: false }) // 2 月无 30 日
    expect(parseDueInput('0/10', NOW)).toEqual({ ok: false })
    expect(parseDueInput('9/0', NOW)).toEqual({ ok: false })
  })

  it('长句 / 乱码 / 空白变体拒绝；前后空白与全角数字容忍不做（窄语法）', () => {
    expect(parseDueInput('abc', NOW)).toEqual({ ok: false })
    expect(parseDueInput('下周三', NOW)).toEqual({ ok: false })
    expect(parseDueInput('10月30日', NOW)).toEqual({ ok: false })
    expect(parseDueInput('9 / 30', NOW)).toEqual({ ok: true, dueAt: '2026-09-30T00:00:00' }) // 空白剥掉
    expect(parseDueInput('', NOW)).toEqual({ ok: false })
  })

  it('2/29 非闰年一律拒绝（窄语法，不做跨多年魔法）', () => {
    expect(parseDueInput('2/29', NOW)).toEqual({ ok: false }) // 2026 非闰，明年 2027 也非闰
    const dec = new Date('2026-12-01T10:00:00')
    expect(parseDueInput('2/29', dec)).toEqual({ ok: false }) // 明年 2027 非闰，拒绝
    const leap2028 = new Date('2028-01-15T10:00:00')
    expect(parseDueInput('2/29', leap2028)).toEqual({ ok: true, dueAt: '2028-02-29T00:00:00' })
  })
})
