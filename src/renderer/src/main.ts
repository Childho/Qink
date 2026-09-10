import type { PeriodKind, QinkData, Task } from '@shared/dates'
import { dateKey, effectiveGoal, isRolledIn, periodKeyFor } from '@shared/dates'
import { initGlass } from './glass'
import { shatterRow } from './shatter'
import { createArchiveView } from './archive'
import type { ArchiveHandle } from './archive'

// 贴纸交互（M3）：目标引导文字与点击改写、任务添加/完成（淡出占位）/右键改删、
// 字号三选、滚入任务琥珀橙置顶、跨午夜自动重算。

const GUIDE: Record<PeriodKind, string> = {
  quarter: '这个季度，最重要的是______',
  month: '这个月，最重要的是______',
  week: '这一周，最重要的是______'
}
const PERIOD_LABEL: Record<PeriodKind, string> = { quarter: '季', month: '月', week: '周' }
const GOAL_ORDER: PeriodKind[] = ['quarter', 'month', 'week']

let data: QinkData
let lastDateKey = ''
let composerOpen = false
let archive: ArchiveHandle | null = null
let gestureFiredAt = 0

const note = document.getElementById('note') as HTMLElement
const goalsEl = document.querySelector('.goals') as HTMLElement
const tasksEl = document.querySelector('.tasks') as HTMLElement
const menuEl = document.getElementById('menu') as HTMLElement

interface MenuItem {
  label: string
  checked?: boolean
  sep?: boolean
  action?: () => void
}

function persist(): void {
  void window.qink.setData(data)
  render()
}

function render(): void {
  note.dataset.size = data.settings.fontSize
  renderGoals()
  renderTasks()
}

/* ---------- 目标区 ---------- */

function renderGoals(): void {
  goalsEl.innerHTML = ''
  const now = new Date()
  for (const kind of GOAL_ORDER) {
    const text = effectiveGoal(data.goals[kind], kind, now)
    const row = document.createElement('div')
    row.className = 'goal' + (text ? '' : ' ghost')
    row.dataset.kind = kind
    const label = document.createElement('span')
    label.className = 'plabel'
    label.textContent = PERIOD_LABEL[kind]
    const span = document.createElement('span')
    span.className = 'gtext'
    span.textContent = text ?? GUIDE[kind]
    row.append(label, span)
    row.addEventListener('click', () => startGoalEdit(kind))
    goalsEl.appendChild(row)
  }
}

function startGoalEdit(kind: PeriodKind): void {
  const row = goalsEl.children[GOAL_ORDER.indexOf(kind)] as HTMLElement | undefined
  if (!row) return
  const current = effectiveGoal(data.goals[kind], kind, new Date()) ?? ''

  const input = document.createElement('input')
  input.className = 'goal-input'
  input.value = current
  input.placeholder = GUIDE[kind]
  row.innerHTML = ''
  row.appendChild(input)
  input.focus()
  input.select()

  let finished = false
  const commit = (): void => {
    if (finished) return
    finished = true
    const text = input.value.trim()
    data.goals[kind] = text ? { periodKey: periodKeyFor(kind, new Date()), text } : null
    persist()
  }
  input.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') commit()
    else if (e.key === 'Escape') {
      finished = true // 放弃修改：不算保存
      render()
    }
  })
  // 点别处（失焦）= 保存，温和不做丢弃确认
  input.addEventListener('blur', commit)
}

/* ---------- 任务区 ---------- */

function orderedTasks(): Task[] {
  const now = new Date()
  const rolled: Task[] = []
  const fresh: Task[] = []
  for (const t of data.tasks) {
    ;(isRolledIn(t.createdAt, now) ? rolled : fresh).push(t)
  }
  return [...rolled, ...fresh] // 滚入任务在最上方，各自保持原顺序
}

function renderTasks(): void {
  tasksEl.innerHTML = ''
  for (const t of orderedTasks()) {
    tasksEl.appendChild(taskRow(t))
  }

  if (composerOpen) {
    const composer = document.createElement('input')
    composer.className = 'composer'
    composer.placeholder = '做完一条按回车，继续输入下一条…'
    composer.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') {
        const text = composer.value.trim()
        if (text) {
          data.tasks.push({ id: crypto.randomUUID(), text, createdAt: new Date().toISOString() })
          persist()
          return // persist 会重渲染并重建输入框，保持连续输入
        }
        composerOpen = false
        render()
      } else if (e.key === 'Escape') {
        composerOpen = false
        render()
      }
    })
    composer.addEventListener('blur', () => {
      // 点到别处：轻轻收起输入行
      composerOpen = false
      render()
    })
    tasksEl.appendChild(composer)
    composer.focus()
  } else {
    const hint = document.createElement('div')
    hint.className = 'composer-hint'
    hint.textContent = '点击这里写下今天的事…'
    tasksEl.appendChild(hint)
  }
}

function taskRow(t: Task): HTMLElement {
  const row = document.createElement('div')
  row.className = 'task' + (isRolledIn(t.createdAt, new Date()) ? ' rolled' : '')
  row.dataset.id = t.id

  const circle = document.createElement('span')
  circle.className = 'circle'
  circle.addEventListener('click', (e) => {
    e.stopPropagation()
    completeTask(t.id)
  })

  const text = document.createElement('span')
  text.className = 'text'
  text.textContent = t.text

  row.append(circle, text)

  row.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    e.stopPropagation()
    openMenu(
      [
        { label: '改写', action: () => startTaskEdit(t.id) },
        { label: '删除', action: () => deleteTask(t.id) }
      ],
      e.clientX,
      e.clientY
    )
  })

  return row
}

function startTaskEdit(id: string): void {
  const row = tasksEl.querySelector(`[data-id="${id}"]`) as HTMLElement | null
  const task = data.tasks.find((t) => t.id === id)
  if (!row || !task) return
  const span = row.querySelector('.text') as HTMLElement
  const input = document.createElement('input')
  input.className = 'task-input'
  input.value = task.text
  span.replaceWith(input)
  input.focus()
  input.select()

  let finished = false
  const commit = (): void => {
    if (finished) return
    finished = true
    const text = input.value.trim()
    if (text) task.text = text
    persist()
  }
  input.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') commit()
    else if (e.key === 'Escape') {
      finished = true
      render()
    }
  })
  input.addEventListener('blur', commit)
}

function deleteTask(id: string): void {
  data.tasks = data.tasks.filter((t) => t.id !== id)
  persist()
}

function completeTask(id: string): void {
  const row = tasksEl.querySelector(`[data-id="${id}"]`) as HTMLElement | null
  const finish = (): void => {
    const idx = data.tasks.findIndex((t) => t.id === id)
    if (idx === -1) return
    const [t] = data.tasks.splice(idx, 1)
    data.archive.push({ ...t, completedAt: new Date().toISOString() })
    persist()
  }
  if (!row) {
    finish()
    return
  }
  // 玻璃碎裂（M6）：碎片落地后再归档
  void shatterRow(note, row).then(finish)
}

/* ---------- 右键抽屉与全局 ---------- */

function openMenu(items: MenuItem[], x: number, y: number): void {
  menuEl.innerHTML = ''
  for (const it of items) {
    const div = document.createElement('div')
    if (it.sep) {
      div.className = 'menu-sep'
      menuEl.appendChild(div)
      continue
    }
    div.className = 'menu-item' + (it.checked ? ' checked' : '')
    div.textContent = (it.checked ? '✓ ' : '') + it.label
    div.addEventListener('click', () => {
      closeMenu()
      it.action?.()
    })
    menuEl.appendChild(div)
  }
  menuEl.hidden = false
  const clampX = Math.min(x, window.innerWidth - menuEl.offsetWidth - 4)
  const clampY = Math.min(y, window.innerHeight - menuEl.offsetHeight - 4)
  menuEl.style.left = Math.max(0, clampX) + 'px'
  menuEl.style.top = Math.max(0, clampY) + 'px'
}

function closeMenu(): void {
  menuEl.hidden = true
}

function blankMenu(x: number, y: number): void {
  const size = data.settings.fontSize
  openMenu(
    [
      { label: '字号 · 小', checked: size === 'small', action: () => setFontSize('small') },
      { label: '字号 · 中', checked: size === 'medium', action: () => setFontSize('medium') },
      { label: '字号 · 大', checked: size === 'large', action: () => setFontSize('large') },
      { label: '', sep: true },
      {
        label: '开机自启',
        checked: data.settings.autostart,
        action: () => {
          data.settings.autostart = !data.settings.autostart
          void window.qink.setAutostart(data.settings.autostart)
          persist()
        }
      },
      { label: '打开数据文件夹', action: () => void window.qink.openDataFolder() },
      { label: '退出 Qink', action: () => window.qink.quit() }
    ],
    x,
    y
  )
}

function setFontSize(size: QinkData['settings']['fontSize']): void {
  data.settings.fontSize = size
  persist()
}

function openArchive(): void {
  if (archive?.isOpen()) return
  gestureFiredAt = Date.now()
  archive = createArchiveView({
    note,
    scrollEl: tasksEl,
    entriesFor: (k) =>
      data.archive
        .filter((a) => dateKey(new Date(a.completedAt)) === k)
        .sort((a, b) => a.completedAt.localeCompare(b.completedAt)),
    onRestore: (id) => {
      // 修复：从档案消失，作为未完成任务回到今日（滚入琥珀橙由创建日如实推导）
      const idx = data.archive.findIndex((a) => a.id === id)
      if (idx === -1) return
      const [a] = data.archive.splice(idx, 1)
      data.tasks.push({ id: a.id, text: a.text, createdAt: a.createdAt })
      persist()
    }
  })
  archive.open()
}

function wire(): void {
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault() // 原生菜单全禁：自绘菜单（M7 手势也依赖此设定）
    if (Date.now() - gestureFiredAt < 600) return // 手势刚触发过，不开菜单
    const target = e.target as HTMLElement
    if (target.closest('.task') || target.closest('.goal-input') || target.closest('.task-input')) {
      return // 任务右键已在行上处理；输入框内不弹菜单
    }
    blankMenu(e.clientX, e.clientY)
  })

  document.addEventListener('click', (e) => {
    closeMenu()
    if (archive?.isOpen()) return // 清单打开时不开输入行
    const target = e.target as HTMLElement
    // 点击任务区空白或提示行 = 打开输入（spec：点击空白处添加任务）
    if (target.closest('.composer-hint') || (target === tasksEl && !composerOpen)) {
      composerOpen = true
      render()
    }
  })

  // 招牌手势：任务区空白处按住右键 ~300ms 并轻轻晃动 → 已完成清单（碎片合并）
  const HOLD_MS = 300
  const WIGGLE_PATH_PX = 26
  let gTracking = false
  tasksEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 2) return
    const t = e.target as HTMLElement
    if (t.closest('.task, input, .composer-hint')) return // 只在空白处生效
    gTracking = true
    const downAt = Date.now()
    let path = 0
    let lastX = e.clientX
    let lastY = e.clientY
    let fired = false
    const move = (ev: PointerEvent): void => {
      if (!gTracking) return
      path += Math.hypot(ev.clientX - lastX, ev.clientY - lastY)
      lastX = ev.clientX
      lastY = ev.clientY
      if (!fired && Date.now() - downAt >= HOLD_MS && path > WIGGLE_PATH_PX) {
        fired = true
        openArchive()
      }
    }
    const up = (): void => {
      gTracking = false
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  })

  // 跨午夜自动翻篇（30 秒对一次表，零定时器清空，渲染时按周期键推导）
  setInterval(() => {
    const k = dateKey(new Date())
    if (k !== lastDateKey) {
      lastDateKey = k
      render()
    }
  }, 30_000)

  wireDrag()
}

/* ---------- 自绘拖动 ----------
 * 抓住贴纸任意非交互空白处拖动。位移按 rAF 合帧上报，主进程按「按下时锚点 + 位移」
 * 定位窗口（不累加增量，杜绝丢帧漂移）。不用 -webkit-app-region：它会吞掉鼠标事件，
 * M7 的右键长按晃动手势就做不成。 */

function wireDrag(): void {
  let dragging = false
  let startX = 0
  let startY = 0
  let pendingDx = 0
  let pendingDy = 0
  let rafScheduled = false

  const flush = (): void => {
    rafScheduled = false
    if (!dragging) return
    window.qink.dragMove(pendingDx, pendingDy)
  }

  note.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    const t = e.target as HTMLElement
    if (t.closest('input, .circle, .composer-hint, #menu, .menu-item')) return
    dragging = true
    startX = e.clientX
    startY = e.clientY
    pendingDx = 0
    pendingDy = 0
    window.qink.dragStart()
    note.setPointerCapture(e.pointerId)
  })

  note.addEventListener('pointermove', (e) => {
    if (!dragging) return
    const dx = e.clientX - startX
    const dy = e.clientY - startY
    // 3px 阈值内不算拖动，让纯点击（改写目标等）不牵动窗口
    if (Math.hypot(dx, dy) < 3) return
    pendingDx = dx
    pendingDy = dy
    if (!rafScheduled) {
      rafScheduled = true
      requestAnimationFrame(flush)
    }
  })

  const end = (): void => {
    if (!dragging) return
    dragging = false
    window.qink.dragEnd()
  }
  note.addEventListener('pointerup', end)
  note.addEventListener('pointercancel', end)
}

async function boot(): Promise<void> {
  data = await window.qink.getData()
  lastDateKey = dateKey(new Date())
  render()
  wire()
  void initGlass()
}

void boot()
