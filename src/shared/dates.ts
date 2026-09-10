// 纯日期逻辑：无 IO、无 Electron 依赖，main 与 renderer 共用，vitest 直接测试。
// 一切比较基于本地时区的「自然日」；翻篇 = 本地午夜 0 点（CONTEXT.md 术语）。

export type PeriodKind = 'quarter' | 'month' | 'week'

/** 存储层的目标：带周期键。周期键不匹配当前周期即失效，存储层永不做清空动作。 */
export interface StoredGoal {
  periodKey: string
  text: string
}

export interface Task {
  id: string
  text: string
  createdAt: string
}

export interface ArchivedTask {
  id: string
  text: string
  createdAt: string
  completedAt: string
}

export interface QinkData {
  version: 1
  goals: { quarter: StoredGoal | null; month: StoredGoal | null; week: StoredGoal | null }
  tasks: Task[]
  archive: ArchivedTask[]
  settings: {
    autostart: boolean
    fontSize: 'small' | 'medium' | 'large'
    noteX: number | null
    noteY: number | null
  }
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** 本地日期键：2026-09-10。用于滚入判定与已完成清单按日翻阅，不是周期键。 */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** 季周期键：2026-Q3（自然季 1-3 / 4-6 / 7-9 / 10-12 月） */
export function quarterKey(d: Date): string {
  const q = Math.floor(d.getMonth() / 3) + 1
  return `${d.getFullYear()}-Q${q}`
}

/** 月周期键：2026-09 */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

/** 周周期键：2026-W37。ISO 8601：周一起始，周号属于「本周周四」所在的 ISO 年。 */
export function weekKey(d: Date): string {
  const thursday = startOfDay(d)
  const dayNum = (thursday.getDay() + 6) % 7 // 周一=0 … 周日=6
  thursday.setDate(thursday.getDate() - dayNum + 3)

  const firstThursday = startOfDay(new Date(thursday.getFullYear(), 0, 4))
  const fDayNum = (firstThursday.getDay() + 6) % 7
  firstThursday.setDate(firstThursday.getDate() - fDayNum + 3)

  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86400000))
  return `${thursday.getFullYear()}-W${pad2(week)}`
}

export function periodKeyFor(kind: PeriodKind, d: Date): string {
  switch (kind) {
    case 'quarter':
      return quarterKey(d)
    case 'month':
      return monthKey(d)
    case 'week':
      return weekKey(d)
  }
}

/** 拖延天数 = 创建日到今天跨过的本地午夜数（今天创建 = 0）。完成入档期间不计龄。 */
export function daysSince(createdAtISO: string, now: Date): number {
  const created = new Date(createdAtISO)
  return Math.round((startOfDay(now).getTime() - startOfDay(created).getTime()) / 86400000)
}

/** 是否滚入任务：创建日早于今天（颜色只分两档，不按天数分级）。 */
export function isRolledIn(createdAtISO: string, now: Date): boolean {
  return daysSince(createdAtISO, now) > 0
}

/** 周期键匹配则目标有效；失效（返回 null）时界面显示引导文字。 */
export function effectiveGoal(stored: StoredGoal | null, kind: PeriodKind, now: Date): string | null {
  if (!stored) return null
  return stored.periodKey === periodKeyFor(kind, now) ? stored.text : null
}
