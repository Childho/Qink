// 截止时间（M15 spec：.scratch/task-due-time/spec.md）纯逻辑：无 IO、无 DOM。
// 两个职责：
//   dueStatus     —— 存储的 dueAt 相对「现在」处于哪个时间阶段（分区与颜色的唯一依据）
//   parseDueInput —— 「设定时间」输入框的语法解析（时刻 / 日期 / 明天后天）
// 粒度约定：dueAt 为本地 ISO 无时区字符串；0 点 = 日期粒度（该日结束前完成），
// 非 0 点 = 时刻粒度（仅解析器允许的「今天」）。解析器拒绝 0:00 保证二者无歧义。

import { daysSince } from './dates'

export type DueStatus = 'future' | 'tomorrow' | 'urgent' | 'overdue'

/**
 * 判定表（spec 唯一事实表）：
 *   日期任务（到期日 D，存 D 日 0 点）：今天 < D-1 → future；= D-1 → tomorrow；
 *     = D → urgent（最后 24 小时，该日全天）；> D → overdue（次日 0 点起）
 *   时刻任务（今天 T）：now < T → urgent；now ≥ T 或已跨夜 → overdue
 * 到期日当天做掉不算逾期——到期锚点是到期日的「次日 0 点」。
 */
export function dueStatus(dueAt: string, now: Date): DueStatus {
  const due = new Date(dueAt)
  const dayDiff = -daysSince(dueAt, now) // >0 未来 / 0 今天 / <0 过去
  const isDateOnly = due.getHours() === 0 && due.getMinutes() === 0
  if (isDateOnly) {
    if (dayDiff >= 2) return 'future'
    if (dayDiff === 1) return 'tomorrow'
    if (dayDiff === 0) return 'urgent'
    return 'overdue'
  }
  if (dayDiff > 0) return 'future' // 防御：解析器不产生未来的时刻任务
  if (dayDiff === 0) return now.getTime() < due.getTime() ? 'urgent' : 'overdue'
  return 'overdue'
}

/** 紧急/逾期（进入自动置顶区，红色，行内不加文字） */
export function isDueHot(dueAt: string | undefined, now: Date): boolean {
  if (!dueAt) return false
  const s = dueStatus(dueAt, now)
  return s === 'urgent' || s === 'overdue'
}

/**
 * 行尾淡字标注：明天 → 「明天」，更远 → 「9/30」。
 * 紧急/逾期返回 null（spec：红不加文字）。
 */
export function dueHint(dueAt: string | undefined, now: Date): string | null {
  if (!dueAt) return null
  const s = dueStatus(dueAt, now)
  if (s === 'urgent' || s === 'overdue') return null
  if (s === 'tomorrow') return '明天'
  const due = new Date(dueAt)
  return `${due.getMonth() + 1}/${due.getDate()}`
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** 本地 ISO 无时区（与解析产物同构），日期粒度 = 当日 0 点 */
function localISO(y: number, m: number, d: number, hh = 0, mm = 0): string {
  return `${y}-${pad2(m)}-${pad2(d)}T${pad2(hh)}:${pad2(mm)}:00`
}

export type DueParse = { ok: true; dueAt: string } | { ok: false }

/**
 * 语法（spec：刻意窄，静默存错是信任杀手）：
 *   15 / 15:30 → 今天时刻（已过时刻拒绝——多半是输错；0:00 拒绝——与日期粒度歧义）
 *   9/30、10/2 → 日期（未来最近匹配：今年已过则顺延一年；当天有效 = 全天紧急）
 *   明天 / 后天 → 相对日期
 * 其他（含长句、乱码、越界值）一律拒绝，由 UI 抖动提示，可重试或 Esc。
 */
export function parseDueInput(raw: string, now: Date): DueParse {
  const text = raw.trim().replace(/\s+/g, '')

  if (text === '明天' || text === '后天') {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    d.setDate(d.getDate() + (text === '明天' ? 1 : 2))
    return { ok: true, dueAt: localISO(d.getFullYear(), d.getMonth() + 1, d.getDate()) }
  }

  let m = /^(\d{1,2}):(\d{1,2})$/.exec(text)
  if (m) {
    const h = Number(m[1])
    const min = Number(m[2])
    if (h > 23 || min > 59) return { ok: false }
    if (h === 0 && min === 0) return { ok: false } // 与日期粒度（0 点）歧义
    const due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, min)
    if (due.getTime() <= now.getTime()) return { ok: false } // 已过时刻
    return { ok: true, dueAt: localISO(now.getFullYear(), now.getMonth() + 1, now.getDate(), h, min) }
  }

  m = /^(\d{1,2})$/.exec(text)
  if (m) {
    const h = Number(m[1])
    if (h > 23) return { ok: false }
    const due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h)
    if (due.getTime() <= now.getTime()) return { ok: false }
    return { ok: true, dueAt: localISO(now.getFullYear(), now.getMonth() + 1, now.getDate(), h) }
  }

  m = /^(\d{1,2})\/(\d{1,2})$/.exec(text)
  if (m) {
    const mo = Number(m[1])
    const d = Number(m[2])
    if (mo < 1 || mo > 12 || d < 1) return { ok: false }
    const tryYear = (y: number): Date | null => {
      const t = new Date(y, mo - 1, d)
      return t.getMonth() === mo - 1 && t.getDate() === d ? t : null // 2/30、非闰 2/29 → null
    }
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    let due = tryYear(now.getFullYear())
    if (due && todayStart.getTime() > due.getTime()) {
      // 未来最近匹配：今年该日已完全过去 → 明年；明年也无效（如 2/29）→ 拒绝
      due = tryYear(now.getFullYear() + 1)
    }
    if (!due) return { ok: false }
    return { ok: true, dueAt: localISO(due.getFullYear(), mo, d) }
  }

  return { ok: false }
}
