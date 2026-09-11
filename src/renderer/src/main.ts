import './style.css'
import { NOTE_INSET_X, NOTE_INSET_Y } from '@shared/window'
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
let composerDraft = ''
const completing = new Set<string>()
let suppressClick = false
let archive: ArchiveHandle | null = null
let gestureFiredAt = 0

const note = document.getElementById('note') as HTMLElement
const goalsEl = document.querySelector('.goals') as HTMLElement
const tasksEl = document.querySelector('.tasks') as HTMLElement
const menuEl = document.getElementById('menu') as HTMLElement
note.style.setProperty('--note-inset-x', `${NOTE_INSET_X}px`)
note.style.setProperty('--note-inset-y', `${NOTE_INSET_Y}px`)
menuEl.setAttribute('role', 'menu')

interface MenuItem {
  label: string
  checked?: boolean
  sep?: boolean
  action?: () => void
}

function persist(): void {
  void window.qink.setData(data)
}

function render(): void {
  note.dataset.size = data.settings.fontSize
  if (!goalsEl.querySelector('input')) renderGoals()
  if (!archive?.isOpen() && !tasksEl.querySelector('input')) renderTasks()
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
    row.tabIndex = 0
    row.setAttribute('role', 'button')
    row.setAttribute('aria-label', `改写${PERIOD_LABEL[kind]}核心目标：${text ?? GUIDE[kind]}`)
    row.addEventListener('click', () => startGoalEdit(kind))
    row.addEventListener('keydown', (e) => {
      if (e.target === row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); startGoalEdit(kind) }
    })
    goalsEl.appendChild(row)
  }
}

function startGoalEdit(kind: PeriodKind): void {
  const row = goalsEl.children[GOAL_ORDER.indexOf(kind)] as HTMLElement | undefined
  if (!row || row.querySelector('input')) return
  const current = effectiveGoal(data.goals[kind], kind, new Date()) ?? ''

  const input = document.createElement('input')
  input.className = 'goal-input'
  input.value = current
  input.placeholder = GUIDE[kind]
  input.setAttribute('aria-label', `改写${PERIOD_LABEL[kind]}核心目标`)
  row.classList.remove('ghost')
  const span = row.querySelector('.gtext') as HTMLElement
  span.replaceWith(input)
  input.focus()
  input.select()

  let finished = false
  const restoreRow = (): void => {
    const text = effectiveGoal(data.goals[kind], kind, new Date())
    span.textContent = text ?? GUIDE[kind]
    row.classList.toggle('ghost', !text)
    row.setAttribute('aria-label', `改写${PERIOD_LABEL[kind]}核心目标：${span.textContent}`)
    input.replaceWith(span)
  }
  const commit = (): void => {
    if (finished) return
    finished = true
    const text = input.value.trim()
    data.goals[kind] = text ? { periodKey: periodKeyFor(kind, new Date()), text } : null
    persist()
    restoreRow()
  }
  input.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter') commit()
    else if (e.key === 'Escape') {
      finished = true // 放弃修改：不算保存
      restoreRow()
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
  if (archive?.isOpen()) return
  const scrollTop = tasksEl.scrollTop
  tasksEl.innerHTML = ''
  for (const t of orderedTasks()) {
    if (!completing.has(t.id)) tasksEl.appendChild(taskRow(t))
  }

  if (composerOpen) {
    const composer = document.createElement('input')
    composer.className = 'composer'
    composer.placeholder = '回车添加，继续写下一件事…'
    composer.value = composerDraft
    composer.setAttribute('aria-label', '新增今日任务')
    composer.addEventListener('input', () => { composerDraft = composer.value })
    composer.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.isComposing || e.keyCode === 229) return
      if (e.key === 'Enter') {
        const text = composer.value.trim()
        if (text) {
          const t = { id: crypto.randomUUID(), text, createdAt: new Date().toISOString() }
          data.tasks.push(t)
          void window.qink.setData(data) // 原位插入不整区重建，落盘单独触发
          tasksEl.insertBefore(taskRow(t), composer) // 焦点原位保留（避免拆卸重建导致焦点重置）
          composer.value = ''
          composerDraft = ''
          composer.scrollIntoView({ block: 'nearest' })
          return
        }
        composerOpen = false
        renderTasks()
      } else if (e.key === 'Escape') {
        composerOpen = false
        renderTasks()
      }
    })
    composer.addEventListener('blur', () => {
      if (!composer.isConnected) return
      composerDraft = composer.value
      composerOpen = false
      // 只替换输入行，不销毁用户刚点中的任务或目标。
      composer.replaceWith(composerHint())
    })
    tasksEl.appendChild(composer)
    composer.focus()
  } else {
    tasksEl.appendChild(composerHint())
  }
  tasksEl.scrollTop = scrollTop
}

function composerHint(): HTMLElement {
  const hint = document.createElement('div')
  hint.className = 'composer-hint'
  hint.textContent = composerDraft ? '继续写下刚才的事…' : '点击这里写下今天的事…'
  hint.tabIndex = 0
  hint.setAttribute('role', 'button')
  hint.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      composerOpen = true
      renderTasks()
    }
  })
  return hint
}

function taskRow(t: Task): HTMLElement {
  const row = document.createElement('div')
  row.className = 'task' + (isRolledIn(t.createdAt, new Date()) ? ' rolled' : '')
  row.dataset.id = t.id

  const circle = document.createElement('button')
  circle.className = 'circle'
  circle.type = 'button'
  circle.setAttribute('aria-label', `完成：${t.text}`)
  circle.title = '完成任务'
  circle.addEventListener('click', (e) => {
    e.stopPropagation()
    completeTask(t.id)
  })

  const text = document.createElement('span')
  text.className = 'text'
  text.textContent = t.text
  text.title = '双击改写 · 右键更多操作'
  text.addEventListener('dblclick', () => startTaskEdit(t.id))

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
  if (!row || !task || completing.has(id) || row.querySelector('input')) return
  const span = row.querySelector('.text') as HTMLElement
  const input = document.createElement('input')
  input.className = 'task-input'
  input.value = task.text
  input.setAttribute('aria-label', '改写任务')
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
    span.textContent = task.text
    input.replaceWith(span)
    row.querySelector('button')?.setAttribute('aria-label', `完成：${task.text}`)
  }
  input.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter') commit()
    else if (e.key === 'Escape') {
      finished = true
      input.replaceWith(span)
    }
  })
  input.addEventListener('blur', commit)
}

function deleteTask(id: string): void {
  if (completing.has(id)) return
  data.tasks = data.tasks.filter((t) => t.id !== id)
  persist()
  renderTasks()
}

function completeTask(id: string): void {
  if (completing.has(id)) return
  completing.add(id)
  const row = tasksEl.querySelector(`[data-id="${id}"]`) as HTMLElement | null
  const finish = (): void => {
    completing.delete(id)
    const idx = data.tasks.findIndex((t) => t.id === id)
    if (idx === -1) return
    const [t] = data.tasks.splice(idx, 1)
    data.archive.push({ ...t, completedAt: new Date().toISOString() })
    persist()
    row?.remove()
  }
  if (!row) {
    finish()
    return
  }
  const button = row.querySelector('button')
  if (button) button.disabled = true
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return }
  // 玻璃碎裂（M6）：碎片落地后再归档
  void shatterRow(note, row).then(finish)
}

/* ---------- 右键抽屉与全局 ---------- */

function openMenu(items: MenuItem[], x: number, y: number): void {
  menuEl.innerHTML = ''
  for (const it of items) {
    const div = document.createElement(it.sep ? 'div' : 'button')
    if (it.sep) {
      div.className = 'menu-sep'
      menuEl.appendChild(div)
      continue
    }
    div.setAttribute('role', 'menuitem')
    div.className = 'menu-item' + (it.checked ? ' checked' : '')
    div.textContent = (it.checked ? '✓ ' : '') + it.label
    div.addEventListener('click', (e) => {
      e.stopPropagation()
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
  menuEl.querySelector<HTMLElement>('.menu-item')?.focus()
}

function closeMenu(): void {
  menuEl.hidden = true
}

function blankMenu(x: number, y: number): void {
  const size = data.settings.fontSize
  openMenu(
    [
      { label: '已完成清单', action: openArchive },
      { label: '', sep: true },
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
  note.dataset.size = size
}

function openArchive(): void {
  if (archive?.isOpen()) return
  closeMenu()
  gestureFiredAt = Date.now()
  archive = createArchiveView({
    note,
    scrollEl: tasksEl,
    entriesFor: (k) =>
      data.archive
        .filter((a) => dateKey(new Date(a.completedAt)) === k)
        .sort((a, b) => a.completedAt.localeCompare(b.completedAt)),
    onClose: () => { renderTasks() },
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
  document.addEventListener('click', (e) => {
    if (!suppressClick) return
    suppressClick = false
    e.preventDefault()
    e.stopImmediatePropagation()
  }, true)
  document.addEventListener('keydown', (e) => {
    if (!menuEl.hidden) {
      const items = Array.from(menuEl.querySelectorAll<HTMLElement>('.menu-item'))
      const i = items.indexOf(document.activeElement as HTMLElement)
      if (e.key === 'Escape') { closeMenu(); e.preventDefault(); e.stopImmediatePropagation() }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
      }
    } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'h') {
      e.preventDefault()
      if (archive?.isOpen()) archive.close()
      else openArchive()
    }
  })
  let ignored = false
  document.addEventListener('pointermove', (e) => {
    if (e.buttons) return
    const target = e.target as Element
    const next = !target.closest('#note, #menu')
    if (next !== ignored) { ignored = next; window.qink.ignoreMouse(next) }
  })
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault() // 原生菜单全禁：自绘菜单（M7 手势也依赖此设定）
    if (Date.now() - gestureFiredAt < 600) return // 手势刚触发过，不开菜单
    const target = e.target as HTMLElement
    if (!target.closest('#note') || target.closest('.task, input, .archive')) {
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
      renderTasks()
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
  let tracking = false
  let dragging = false
  let startX = 0
  let startY = 0
  let pendingDx = 0
  let pendingDy = 0
  let raf = 0
  const flush = (): void => {
    raf = 0
    if (dragging) window.qink.dragMove(pendingDx, pendingDy)
  }
  note.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target as Element).closest('input, button, .composer-hint, .archive')) return
    tracking = true
    dragging = false
    startX = e.screenX
    startY = e.screenY
  })
  window.addEventListener('pointermove', (e) => {
    if (!tracking) return
    pendingDx = e.screenX - startX
    pendingDy = e.screenY - startY
    if (!dragging) {
      if (Math.hypot(pendingDx, pendingDy) < 4) return
      dragging = true
      note.classList.add('dragging')
      window.qink.dragStart()
      note.setPointerCapture(e.pointerId)
    }
    if (!raf) raf = requestAnimationFrame(flush)
  })
  const end = (e?: PointerEvent): void => {
    if (!tracking) return
    tracking = false
    if (raf) { cancelAnimationFrame(raf); raf = 0 }
    if (dragging) {
      flush()
      suppressClick = true
      setTimeout(() => { suppressClick = false }, 0)
      window.qink.dragEnd()
    }
    dragging = false
    note.classList.remove('dragging')
    if (e && note.hasPointerCapture(e.pointerId)) note.releasePointerCapture(e.pointerId)
  }
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
  window.addEventListener('blur', () => end())
}

async function boot(): Promise<void> {
  data = await window.qink.getData()
  lastDateKey = dateKey(new Date())
  render()
  wire()
  void initGlass()
}

void boot()
