// 纯任务列表逻辑：无 IO、无 DOM、无 Electron 依赖，renderer 消费，vitest 直接测试。
// 顺序约定：data.tasks 的数组顺序即显示顺序（标记/拖动后重排写回）。
// 渲染前经 composeTaskOrder 四层分区：紧急(红,自动) > 标记(紫) > 滚入(琥珀橙) > 今日，
// 各区内保持数组顺序。紧急/逾期由 dueAt 实时推导（不落盘），跨午夜自然换区。

import { isRolledIn, type Task } from './dates'
import { isDueHot } from './due'

/** 分区序：0 紧急 > 1 标记 > 2 滚入 > 3 今日（composeTaskOrder 与 applyReorder 共用） */
export function zoneOf(t: Task, now: Date): 0 | 1 | 2 | 3 {
  if (t.dueAt && isDueHot(t.dueAt, now)) return 0
  if (t.pinned) return 1
  if (isRolledIn(t.createdAt, now)) return 2
  return 3
}

/** 显示顺序：紧急 > 标记 > 滚入 > 今日，各区内部稳定保持数组顺序。 */
export function composeTaskOrder(tasks: Task[], now: Date): Task[] {
  const zones: Task[][] = [[], [], [], []]
  for (const t of tasks) zones[zoneOf(t, now)].push(t)
  return [...zones[0], ...zones[1], ...zones[2], ...zones[3]]
}

/**
 * 拖动落点重排。targetDisplayIndex 是「包含被拖行的完整显示列表」里的目标索引，
 * 与 UI 让位预览的落点语义一致；被钳制到被拖行同分区内（拖不跨区，
 * 避免「拖到顶却被滚入区挡住」的困惑）。返回数组顺序 = 完整显示顺序，直接赋回 data.tasks。
 */
export function applyReorder(
  tasks: Task[],
  dragId: string,
  targetDisplayIndex: number,
  now: Date
): Task[] {
  const display = composeTaskOrder(tasks, now)
  const from = display.findIndex((t) => t.id === dragId)
  if (from < 0) return tasks

  const counts = [0, 0, 0, 0]
  for (const t of display) counts[zoneOf(t, now)]++
  const zoneEnds = [counts[0], counts[0] + counts[1], counts[0] + counts[1] + counts[2], display.length]
  const zone = zoneOf(display[from], now)
  const start = zone === 0 ? 0 : zoneEnds[zone - 1]
  const target = Math.min(Math.max(targetDisplayIndex, start), zoneEnds[zone] - 1)

  const [moved] = display.splice(from, 1)
  display.splice(target, 0, moved)
  return display
}
