// qink-core.mjs —— qink-tasks skill 的纯逻辑层：无任何 IO，可被单测直接导入。
// 日期/截止时间函数与 src/shared/dates.ts、src/shared/due.ts 逐行对应，
// 由 tests/skill-parity.test.ts 奇偶校验钉死：改了 shared 必须同步这里，否则测试红。
// 文件读写、路径解析、撞车重试都在 qink.mjs（CLI 层）。

const pad2 = (n) => String(n).padStart(2, '0')

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** 本地日期键：2026-09-10（滚入判定/清单翻页用，不是周期键） */
export function dateKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** 季周期键：2026-Q3（自然季） */
export function quarterKey(d) {
  const q = Math.floor(d.getMonth() / 3) + 1
  return `${d.getFullYear()}-Q${q}`
}

/** 月周期键：2026-09 */
export function monthKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

/** 周周期键：2026-W37。ISO 8601：周一起始，周号属于「本周周四」所在的 ISO 年。 */
export function weekKey(d) {
  const thursday = startOfDay(d)
  const dayNum = (thursday.getDay() + 6) % 7 // 周一=0 … 周日=6
  thursday.setDate(thursday.getDate() - dayNum + 3)

  const firstThursday = startOfDay(new Date(thursday.getFullYear(), 0, 4))
  const fDayNum = (firstThursday.getDay() + 6) % 7
  firstThursday.setDate(firstThursday.getDate() - fDayNum + 3)

  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86400000))
  return `${thursday.getFullYear()}-W${pad2(week)}`
}

export function periodKeyFor(kind, d) {
  if (kind === 'quarter') return quarterKey(d)
  if (kind === 'month') return monthKey(d)
  if (kind === 'week') return weekKey(d)
  throw new Error(`未知的周期类型: ${kind}`)
}

/** 拖延天数 = 创建日到今天跨过的本地午夜数（今天创建 = 0） */
export function daysSince(createdAtISO, now) {
  const created = new Date(createdAtISO)
  return Math.round((startOfDay(now).getTime() - startOfDay(created).getTime()) / 86400000)
}

/** 是否滚入任务：创建日早于今天 */
export function isRolledIn(createdAtISO, now) {
  return daysSince(createdAtISO, now) > 0
}

/** 本地 ISO 无时区（与 Qink 解析产物同构），日期粒度 = 当日 0 点 */
function localISO(y, m, d, hh = 0, mm = 0) {
  return `${y}-${pad2(m)}-${pad2(d)}T${pad2(hh)}:${pad2(mm)}:00`
}

/**
 * 「设定时间」语法解析（与 src/shared/due.ts 完全一致的窄语法）：
 *   15 / 15:30 → 今天时刻（已过拒绝；0:00 拒绝——与日期粒度歧义）
 *   9/30、10/2 → 日期（未来最近匹配：今年已过顺延一年；非闰 2/29 拒绝）
 *   明天 / 后天 → 相对日期
 * 其他一律拒绝。
 */
export function parseDueInput(raw, now) {
  const text = String(raw).trim().replace(/\s+/g, '')

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
    if (h === 0 && min === 0) return { ok: false }
    const due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, min)
    if (due.getTime() <= now.getTime()) return { ok: false }
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
    const tryYear = (y) => {
      const t = new Date(y, mo - 1, d)
      return t.getMonth() === mo - 1 && t.getDate() === d ? t : null // 2/30、非闰 2/29 → null
    }
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    let due = tryYear(now.getFullYear())
    if (due && todayStart.getTime() > due.getTime()) {
      due = tryYear(now.getFullYear() + 1)
    }
    if (!due) return { ok: false }
    return { ok: true, dueAt: localISO(due.getFullYear(), mo, d) }
  }

  return { ok: false }
}

/** 截止状态判定（分区/颜色唯一依据；与 src/shared/due.ts 同表） */
export function dueStatus(dueAt, now) {
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

// ---------- 数据校验与操作（全量数据进、全量数据出；失败整批拒绝，不落半套） ----------

/** 与 store-io 的 defaultData 同构的空白档（文件不存在时用） */
export function emptyData() {
  return {
    version: 1,
    goals: { quarter: null, month: null, week: null },
    tasks: [],
    archive: [],
    settings: {
      autostart: true, fontSize: 'medium',
      noteX: null, noteY: null, noteW: null, noteH: null,
      noteMode: 'note', alwaysOnTop: false
    }
  }
}

/** 写入前的形状校验：不过就整批拒绝，绝不把坏数据落盘 */
export function validateQinkData(d) {
  if (typeof d !== 'object' || d === null || Array.isArray(d)) return { ok: false, reason: '顶层不是 JSON 对象' }
  if (!Array.isArray(d.tasks)) return { ok: false, reason: 'tasks 不是数组' }
  if (!Array.isArray(d.archive)) return { ok: false, reason: 'archive 不是数组' }
  if (typeof d.goals !== 'object' || d.goals === null || Array.isArray(d.goals)) return { ok: false, reason: 'goals 不是对象' }
  if (typeof d.settings !== 'object' || d.settings === null || Array.isArray(d.settings)) return { ok: false, reason: 'settings 不是对象' }
  for (const t of d.tasks) {
    if (typeof t !== 'object' || t === null) return { ok: false, reason: '任务不是对象' }
    if (typeof t.id !== 'string' || !t.id) return { ok: false, reason: '任务缺 id' }
    if (typeof t.text !== 'string' || !t.text.trim()) return { ok: false, reason: `任务 ${t.id} 缺有效文本` }
    if (typeof t.createdAt !== 'string' || Number.isNaN(new Date(t.createdAt).getTime()))
      return { ok: false, reason: `任务「${t.text}」的 createdAt 不是合法时间` }
  }
  for (const a of d.archive) {
    if (typeof a !== 'object' || a === null) return { ok: false, reason: '归档项不是对象' }
    if (typeof a.id !== 'string' || typeof a.text !== 'string' || typeof a.completedAt !== 'string')
      return { ok: false, reason: '归档项缺 id/text/completedAt' }
  }
  return { ok: true }
}

const RAW_DUE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/

/**
 * AI 输入的任务条目 → 存储 Task。id/createdAt 自动生成；
 * due 用 Qink 输入语法（15 / 15:30 / 9/30 / 明天 / 后天）；
 * dueAt 直写必须是本地无时区整秒格式，且非 0 点时刻只允许今天（产品规则，违者显示错乱）。
 */
function normalizeTaskItem(item, now) {
  if (typeof item !== 'object' || item === null) return { ok: false, reason: '任务条目不是对象' }
  const text = typeof item.text === 'string' ? item.text.trim() : ''
  if (!text) return { ok: false, reason: '任务文本为空' }
  const task = { id: crypto.randomUUID(), text, createdAt: new Date(now).toISOString() }
  if (item.pinned === true) task.pinned = true
  if (item.due != null && item.due !== '') {
    const p = parseDueInput(item.due, now)
    if (!p.ok) return { ok: false, reason: `任务「${text}」的 due「${item.due}」无法解析（语法：15 / 15:30 / 9/30 / 明天 / 后天）` }
    task.dueAt = p.dueAt
  } else if (item.dueAt != null && item.dueAt !== '') {
    if (typeof item.dueAt !== 'string' || !RAW_DUE_RE.test(item.dueAt) || Number.isNaN(new Date(item.dueAt).getTime()))
      return { ok: false, reason: `任务「${text}」的 dueAt 需为 YYYY-MM-DDTHH:mm:00（本地无时区整秒）` }
    const due = new Date(item.dueAt)
    if (!(due.getHours() === 0 && due.getMinutes() === 0) && dateKey(due) !== dateKey(now))
      return { ok: false, reason: `任务「${text}」：非 0 点的 dueAt 只允许今天；未来日期请写当日 0 点` }
    task.dueAt = item.dueAt
  }
  return { ok: true, task }
}

/** 匹配器（{id} 或 {text} 或纯文本串）→ 命中的任务列表 */
function matchTasks(tasks, matcher) {
  if (typeof matcher === 'string') matcher = { text: matcher }
  if (typeof matcher !== 'object' || matcher === null) return { ok: false, reason: '匹配器需是 {id} / {text} 对象或文本串' }
  if (matcher.id != null) return { ok: true, hits: tasks.filter((t) => t.id === matcher.id) }
  if (matcher.text != null) return { ok: true, hits: tasks.filter((t) => t.text.trim() === String(matcher.text).trim()) }
  return { ok: false, reason: '匹配器需提供 id 或 text' }
}

/**
 * 在全量数据上应用操作（goal → replace → delete/complete → add）。
 * 任何一条非法 → 整批拒绝（ok:false），调用方不得写盘。
 * 成功返回新全量数据 + report（逐条明细，含 skippedDuplicate / notFound）。
 */
export function applyOps(data, ops, now) {
  const pre = validateQinkData(data)
  if (!pre.ok) return { ok: false, reason: `数据校验失败：${pre.reason}` }
  const next = structuredClone(data)
  const report = { added: [], skippedDuplicate: [], completed: [], deleted: [], notFound: [], goal: null, replaced: null }

  if (ops.goal) {
    const { kind } = ops.goal
    if (!['quarter', 'month', 'week'].includes(kind)) return { ok: false, reason: `未知周期类型：${kind}` }
    const from = next.goals[kind]
    const set = ops.goal.clear || !ops.goal.text ? null : { periodKey: periodKeyFor(kind, now), text: String(ops.goal.text).trim() }
    if (!set && !ops.goal.clear) return { ok: false, reason: 'goal 需要文本或显式 clear' }
    next.goals[kind] = set
    report.goal = { kind, from: from ? { periodKey: from.periodKey, text: from.text } : null, set }
  }

  if (ops.replace) {
    if (!Array.isArray(ops.replace)) return { ok: false, reason: 'replace 需要任务数组' }
    const tasks = []
    for (const item of ops.replace) {
      const n = normalizeTaskItem(item, now)
      if (!n.ok) return n
      tasks.push(n.task)
    }
    report.replaced = { oldCount: next.tasks.length, tasks }
    next.tasks = tasks
  }

  for (const key of ['delete', 'complete']) {
    const matchers = ops[key]
    if (!matchers) continue
    for (const matcher of Array.isArray(matchers) ? matchers : [matchers]) {
      const m = matchTasks(next.tasks, matcher)
      if (!m.ok) return m
      if (m.hits.length === 0) {
        report.notFound.push(typeof matcher === 'object' && matcher !== null ? JSON.stringify(matcher) : String(matcher))
        continue
      }
      for (const t of m.hits) {
        next.tasks.splice(next.tasks.indexOf(t), 1)
        if (key === 'complete') {
          next.archive.push({ ...t, completedAt: new Date(now).toISOString() })
          report.completed.push({ id: t.id, text: t.text })
        } else {
          report.deleted.push({ id: t.id, text: t.text })
        }
      }
    }
  }

  if (ops.add) {
    if (!Array.isArray(ops.add)) return { ok: false, reason: 'add 需要任务数组' }
    for (const item of ops.add) {
      const n = normalizeTaskItem(item, now)
      if (!n.ok) return n
      if (next.tasks.some((t) => t.text.trim() === n.task.text)) {
        report.skippedDuplicate.push(n.task.text)
        continue
      }
      next.tasks.push(n.task)
      report.added.push({ id: n.task.id, text: n.task.text, dueAt: n.task.dueAt ?? null })
    }
  }

  const post = validateQinkData(next)
  if (!post.ok) return { ok: false, reason: `操作结果校验失败（未写入）：${post.reason}` }
  return { ok: true, data: next, report }
}

/** 写后核验：盘上数据是否仍体现本次操作（撞车检测，见 qink.mjs） */
export function verifyApplied(data, report) {
  const v = validateQinkData(data)
  if (!v.ok) return false
  for (const a of report.added) if (!data.tasks.some((t) => t.id === a.id)) return false
  for (const c of report.completed) {
    if (data.tasks.some((t) => t.id === c.id)) return false
    if (!data.archive.some((x) => x.id === c.id)) return false
  }
  for (const d of report.deleted) if (data.tasks.some((t) => t.id === d.id)) return false
  if (report.goal) {
    const g = data.goals[report.goal.kind]
    if (report.goal.set) {
      if (!g || g.text !== report.goal.set.text || g.periodKey !== report.goal.set.periodKey) return false
    } else if (g != null) return false
  }
  if (report.replaced) {
    for (const t of report.replaced.tasks) if (!data.tasks.some((x) => x.id === t.id)) return false
  }
  return true
}
