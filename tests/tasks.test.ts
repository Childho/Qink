// src/shared/tasks.ts 的分区排序与拖动重排：纯函数直测，不碰 DOM / Electron。
// 时间基准：2026-09-11 为「今天」，09-10 及更早创建 = 滚入（isRolledIn 按本地自然日）。
// M15 起四层分区：紧急(dueAt 热态,红,自动) > 标记(紫) > 滚入(琥珀橙) > 今日。

import { describe, expect, it } from 'vitest'
import type { Task } from '../src/shared/dates'
import { applyReorder, composeTaskOrder } from '../src/shared/tasks'

const now = new Date('2026-09-11T12:00:00')
const TODAY = '2026-09-11T08:00:00'
const YDAY = '2026-09-10T23:00:00'

function task(id: string, createdAt: string, pinned?: boolean, dueAt?: string): Task {
  return { id, text: id, createdAt, pinned, dueAt }
}

describe('composeTaskOrder 四层分区', () => {
  it('标记 > 滚入 > 今日，各区内保持数组顺序', () => {
    const tasks = [
      task('f1', TODAY),
      task('r1', YDAY),
      task('p1', YDAY, true),
      task('f2', TODAY),
      task('r2', YDAY),
      task('p2', TODAY, true)
    ]
    expect(composeTaskOrder(tasks, now).map((t) => t.id)).toEqual([
      'p1',
      'p2', // 标记区：数组顺序 p1 在前
      'r1',
      'r2', // 滚入区
      'f1',
      'f2' // 今日区
    ])
  })

  it('旧数据无 pinned/dueAt 字段时与原滚入分区行为一致', () => {
    const tasks = [task('f1', TODAY), task('r1', YDAY)]
    const legacy = tasks.map(({ id, text, createdAt }) => ({ id, text, createdAt }))
    expect(composeTaskOrder(legacy, now).map((t) => t.id)).toEqual(['r1', 'f1'])
  })

  it('标记与滚入叠加时归入标记区（主动标记优先于被动滚入）', () => {
    const tasks = [task('r1', YDAY), task('p1', YDAY, true)]
    expect(composeTaskOrder(tasks, now).map((t) => t.id)).toEqual(['p1', 'r1'])
  })

  it('紧急（今天到期/未到时刻）压在标记之上，逾期同样入紧急区', () => {
    const tasks = [
      task('p1', TODAY, true),
      task('u1', TODAY, false, '2026-09-11T00:00:00'), // 今天到期（日期粒度）
      task('u2', YDAY, false, '2026-09-09T00:00:00'), // 已逾期
      task('u3', TODAY, false, '2026-09-11T15:00:00') // 今天 15:00 未到
    ]
    expect(composeTaskOrder(tasks, now).map((t) => t.id)).toEqual(['u1', 'u2', 'u3', 'p1'])
  })

  it('紧急与标记叠加时归入紧急区（客观时间紧迫 > 主观标记），pinned 字段保留', () => {
    const tasks = [task('p1', TODAY, true), task('u1', TODAY, true, '2026-09-11T00:00:00')]
    const out = composeTaskOrder(tasks, now)
    expect(out.map((t) => t.id)).toEqual(['u1', 'p1'])
    expect(out[0].pinned).toBe(true) // 信息无损，只是位置被时间接管
  })

  it('带未来 dueAt 的滚入任务留在滚入区（琥珀橙说它从哪来，标注说它要去哪）', () => {
    const tasks = [task('r1', YDAY, false, '2026-09-12T00:00:00'), task('f1', TODAY)]
    expect(composeTaskOrder(tasks, now).map((t) => t.id)).toEqual(['r1', 'f1'])
  })
})

describe('applyReorder 拖动重排', () => {
  const tasks = [
    task('p1', TODAY, true),
    task('r1', YDAY),
    task('r2', YDAY),
    task('f1', TODAY),
    task('f2', TODAY),
    task('f3', TODAY)
  ] // 显示序：p1 | r1 r2 | f1 f2 f3

  it('同分区内移动：f3 拖到今日区顶（显示索引 3）', () => {
    const out = applyReorder(tasks, 'f3', 3, now)
    expect(out.map((t) => t.id)).toEqual(['p1', 'r1', 'r2', 'f3', 'f1', 'f2'])
  })

  it('同分区内后移：r1 拖到滚入区底（显示索引 2）', () => {
    const out = applyReorder(tasks, 'r1', 2, now)
    expect(out.map((t) => t.id)).toEqual(['p1', 'r2', 'r1', 'f1', 'f2', 'f3'])
  })

  it('跨分区目标被钳制：f1 拖到标记区索引 0 → 落在今日区顶（索引 3）', () => {
    const out = applyReorder(tasks, 'f1', 0, now)
    expect(out.map((t) => t.id)).toEqual(['p1', 'r1', 'r2', 'f1', 'f2', 'f3'])
  })

  it('跨分区目标被钳制：r2 拖到最底（索引 5）→ 落在滚入区底（索引 2）', () => {
    const out = applyReorder(tasks, 'r2', 5, now)
    expect(out.map((t) => t.id)).toEqual(['p1', 'r1', 'r2', 'f1', 'f2', 'f3'])
  })

  it('重排后数组顺序即显示顺序（composeTaskOrder 幂等不变量）', () => {
    const out = applyReorder(tasks, 'f3', 3, now)
    expect(composeTaskOrder(out, now)).toEqual(out)
  })

  it('dragId 不存在时原样返回', () => {
    const out = applyReorder(tasks, 'nope', 0, now)
    expect(out).toBe(tasks)
  })

  it('四分区钳制：紧急区任务拖到最底 → 落在紧急区底；今日任务拖到最顶 → 落在今日区顶', () => {
    const four = [
      task('u1', TODAY, false, '2026-09-11T00:00:00'),
      task('p1', TODAY, true),
      task('r1', YDAY),
      task('f1', TODAY)
    ] // 显示序：u1 | p1 | r1 | f1
    expect(applyReorder(four, 'u1', 3, now).map((t) => t.id)).toEqual(['u1', 'p1', 'r1', 'f1'])
    expect(applyReorder(four, 'f1', 0, now).map((t) => t.id)).toEqual(['u1', 'p1', 'r1', 'f1'])
  })
})
