import './style.css'
import {
  ADAPTIVE_MIN_HEIGHT,
  BALL_INSET_X,
  BALL_SIZE,
  clampNoteWidth,
  NOTE_INSET_BOTTOM,
  NOTE_INSET_X,
  NOTE_INSET_Y,
  NOTE_MIN_HEIGHT,
  NOTE_WIDTH
} from '@shared/window'
import type { PeriodKind, QinkData, Task } from '@shared/dates'
import { dateKey, effectiveGoal, isRolledIn, periodKeyFor } from '@shared/dates'
import { applyReorder, composeTaskOrder } from '@shared/tasks'
import { dueHint, dueStatus, isDueHot, parseDueInput } from '@shared/due'
import { shatterRow } from './shatter'
import { LOGO_MASK_DATA_URL } from './logo'
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

const prefersReduce = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches

let data: QinkData
let lastDateKey = ''
let composerOpen = false
let composerDraft = ''
const completing = new Set<string>()
let suppressClick = false
let archive: ArchiveHandle | null = null
let gestureFiredAt = 0

/* ---------- 空闲自动收起（M16） ----------
 * 动因：用户进入工作状态后不到完成任务不会看贴纸，展开态长期占桌面。
 * 「操作」= 贴纸上的真实交互（点击/按键/滚轮），鼠标路过不算（工作时不慎滑过不续命）；
 * 拖动中 / 输入框聚焦 / 已完成清单打开时不收（避免打断正在发生的事）。
 * 收起走 setForm('ball')：与手动点 × 完全同路（含 noteMode 落盘）。 */
const IDLE_COLLAPSE_MS = 10 * 60_000 // 空闲收起窗口：10 分钟（实测断言时临时改小跑 idle-check.cjs）
let lastNoteActivity = Date.now()
const noteActivity = (): void => {
  lastNoteActivity = Date.now()
}
function noteIdleExpired(now: number): boolean {
  if (form !== 'note' || archive?.isOpen() || taskDrag) return false
  if ((document.activeElement as HTMLElement | null)?.closest('input')) return false
  return now - lastNoteActivity >= IDLE_COLLAPSE_MS
}

const note = document.getElementById('note') as HTMLElement
const goalsEl = document.querySelector('.goals') as HTMLElement
const tasksEl = document.querySelector('.tasks') as HTMLElement
const tasksWrap = document.querySelector('.tasks-wrap') as HTMLElement
const tasksThumb = document.querySelector('.tasks-thumb') as HTMLElement
const menuEl = document.getElementById('menu') as HTMLElement
const dock = document.getElementById('dock') as HTMLElement
const fab = document.getElementById('fab') as HTMLButtonElement
const quickInput = document.getElementById('quick-input') as HTMLInputElement
const closeBtn = document.querySelector('.note-close') as HTMLButtonElement
const fabLogo = document.querySelector('#fab .logo') as HTMLElement
note.style.setProperty('--note-inset-x', `${NOTE_INSET_X}px`)
note.style.setProperty('--note-inset-y', `${NOTE_INSET_Y}px`)
note.style.setProperty('--note-inset-bottom', `${NOTE_INSET_BOTTOM}px`)
note.style.setProperty('--note-min-h', `${ADAPTIVE_MIN_HEIGHT}px`)
// 球形态窗口两侧为速记胶囊留了空间，#dock 的落点 = 胶囊空间（与主进程 BALL_INSET_X 同源）
dock.style.setProperty('--ball-inset-x', `${BALL_INSET_X}px`)
menuEl.setAttribute('role', 'menu')

// 悬浮球 Q logo:mask 图由生成物 logo.ts 提供,CSS 只定几何与墨色(见 style.css #fab .logo)
fabLogo.style.setProperty('mask-image', `url("${LOGO_MASK_DATA_URL}")`)
fabLogo.style.setProperty('-webkit-mask-image', `url("${LOGO_MASK_DATA_URL}")`)

// 空闲收起的交互记录：贴纸上任何真实交互（点击/按键/滚轮，capture 全捕获）即续命
for (const type of ['pointerdown', 'keydown', 'wheel'] as const) {
  note.addEventListener(type, noteActivity, { capture: true, passive: true })
}

/* ---------- 便签尺寸（ADR-0005 + M14） ----------
 * 宽度恒为手动值（默认 320，边缘拖拽可改，双击边缘恢复）；
 * 高度两档：manualH 为 null → 自适应（上报内容期望高度），有值 → 固定（用户拖定）。
 * 尺寸持久化在 settings.noteW/noteH，主进程启动即用它们建窗，避免跳变。 */

let curW = NOTE_WIDTH
let manualH: number | null = null
let winX = 0
let winY = 0
/** 双形态（悬浮球 spec）：'note' = 展开贴纸，'ball' = 收起为 App logo 圆球 */
let form: 'ball' | 'note' = 'note'
/** 形变进行中：挡尺寸上报/拖拽/缩放/重复切换，动画演完放行 */
let morphLock = false
window.qink.onWinPos((x, y) => {
  winX = x
  winY = y
  // 速记胶囊换边随窗口位置实时计算：球左缘 = winX + BALL_INSET_X，胶囊左缘再往左
  // 一个胶囊空间 = winX。winX<0 即胶囊会伸出屏幕左缘 → 换到球的右侧
  if (form === 'ball') dock.classList.toggle('flip', x < 0)
})

function applySize(): void {
  note.style.width = `${curW}px`
  note.style.height = manualH != null ? `${manualH}px` : ''
}

/* ---------- 尺寸上报（ADR-0005） ----------
 * 自适应模式下必须上报「内容需要的高度」= 当前高 + 被上限截住的滚动溢出量——
 * 若只报可见高，窗口永远不会长大（CSS 上限随窗口走，形成死锁）。
 * 内容变化由 MutationObserver 捕获，窗口/字号变化由 ResizeObserver 捕获，
 * rAF 合帧 + 去重，动画期间不逐帧轰炸主进程。 */

let lastSentSize = ''
let reportRaf = 0

function desiredNoteHeight(): number {
  const overflow = (el: HTMLElement): number => Math.max(0, el.scrollHeight - el.clientHeight)
  return note.offsetHeight + overflow(tasksEl) + overflow(goalsEl)
}

function scheduleReport(): void {
  if (form === 'ball' || morphLock) return // 球形态/形变中：窗口尺寸由 qink:form-change 管理，不报内容高度
  if (reportRaf) return
  reportRaf = requestAnimationFrame(() => {
    reportRaf = 0
    const h = manualH ?? Math.round(desiredNoteHeight())
    const key = `${curW}:${h}`
    if (key === lastSentSize) return
    lastSentSize = key
    window.qink.resizeNote(curW, h)
  })
}

// 主进程把高度截到工作区内时回传实际值：手动模式下同步 CSS 并落盘，
// 自适应模式 CSS max-height（100vh - 上下边距）天然跟随，无需处理
window.qink.onNoteCapped((h) => {
  if (manualH == null || h >= manualH) return
  manualH = h
  applySize()
  if (data) {
    data.settings.noteH = manualH
    persist()
  }
})

new ResizeObserver(scheduleReport).observe(note)
new MutationObserver(scheduleReport).observe(note, {
  childList: true,
  subtree: true,
  characterData: true
})

/* ---------- 双形态：贴纸 ⇄ 悬浮球（悬浮球 spec） ---------- */

function applyForm(): void {
  document.body.dataset.form = form
  if (form === 'ball') {
    dock.classList.toggle('flip', winX < 0)
    window.qink.setForm('ball').catch(() => {}) // 即发即忘；测试假环境可能无此通道
  } else {
    window.qink.setForm('note').catch(() => {})
    renderTasks() // 球形态期间速记新增的任务在此补渲染
    scheduleReport() // 窗口切回贴纸尺寸后，让自适应高度立刻校正一次
  }
}

function setForm(next: 'ball' | 'note'): void {
  if (form === next || morphLock) return
  form = next
  noteActivity() // 形态切换即交互：展开瞬间起算新的空闲窗口，避免刚展开就被下一个 tick 收走
  data.settings.noteMode = next
  persist()
  cancelGlide() // 滑行中切形态：先归还锚点，边界随窗口尺寸重算
  if (prefersReduce()) {
    applyForm()
    return
  }
  if (next === 'note') expandMorph()
  else collapseMorph()
}

/* ---------- 球⇄贴纸连续形变：窗口 x 全程不动（主进程 setBounds 保持 x），
   贴纸在窗口内从自身锚滑向球的元素位（x + BALL_INSET_X），形状与位置一条签名缓动
   同步插值，内容交错进出场，全程无瞬移 ---------- */

/** 展开：await 切窗（窗口换到贴纸尺寸、x 不动）→ 贴纸以球元素位 56px 圆出现
 *  → 形状与位置同步长到自然尺寸 → 内容逐层浮现 → logo 替身溶解 */
async function expandMorph(): Promise<void> {
  morphLock = true
  document.body.classList.add('form-morphing')
  // 切窗落定前 data-form 仍是 ball，屏幕上无任何可见变化；落定后贴纸起始帧恰好盖住球
  await window.qink.setForm('note')
  document.body.dataset.form = 'note'
  renderTasks() // 球形态期间速记新增的任务在此补渲染
  // 探针阶段关过渡量自然尺寸：起始帧若在一次「带过渡的重算」里生效，会自己触发
  // 过渡、被目标帧瞬间回弹（展开吸附成硬切的根因），故先 none 落定起始帧再恢复
  note.style.transition = 'none'
  applySize() // 宽度回持久化值，量出自然目标尺寸
  const targetW = note.offsetWidth
  const targetH = note.offsetHeight
  // 自适应高度先撑窗：目标高于持久化窗高时，不先撑窗形变期间贴纸底部会被窗口裁掉
  window.qink.resizeNote(curW, targetH)
  // logo 替身：球刚换影成贴纸时盖在球心，随形变溶解（dock 已随 data-form 隐藏）
  const logo = document.createElement('i')
  logo.className = 'morph-logo'
  logo.style.maskImage = `url("${LOGO_MASK_DATA_URL}")`
  logo.style.webkitMaskImage = `url("${LOGO_MASK_DATA_URL}")`
  note.appendChild(logo)
  note.classList.add('morphing', 'morphing-in')
  note.style.minHeight = '0px' // 解除 420px 下限：起始帧才是 56px 圆，不是被托底的竖长条
  note.style.left = `${BALL_INSET_X}px`
  note.style.width = `${BALL_SIZE}px`
  note.style.height = `${BALL_SIZE}px`
  note.style.borderRadius = `${BALL_SIZE / 2}px`
  if (prefersReduce()) {
    logo.remove()
  } else {
    logo.animate([{ opacity: 0.9 }, { opacity: 0 }], { duration: 160, easing: 'ease-out', fill: 'forwards' }).finished.then(
      () => logo.remove(),
      () => logo.remove()
    )
  }
  void note.offsetHeight // 起始帧在无过渡下生效为首帧渲染状态
  note.style.transition = '' // 恢复 #note.morphing 的签名缓动
  note.style.left = '' // 回到样式表锚（--note-inset-x），位置随形状一起滑
  note.style.width = `${targetW}px`
  note.style.height = `${targetH}px`
  note.style.borderRadius = ''
  note.classList.remove('morphing-in') // 摘除隐藏态 → 内容按层级交错浮现
  window.setTimeout(() => {
    note.classList.remove('morphing')
    document.body.classList.remove('form-morphing')
    morphLock = false
    note.style.minHeight = ''
    applySize()
    scheduleReport() // 形变期间被拦下的尺寸上报，落定后补一次
  }, 500)
}

/** 收起：内容先退场 → 贴纸原地收拢并滑向球元素位 → 300ms 处切窗（x 不动、屏幕零位移，
 *  球在同一锚点接棒）→ 演完收尾 */
function collapseMorph(): void {
  morphLock = true
  document.body.classList.add('form-morphing')
  note.style.width = `${note.offsetWidth}px`
  note.style.height = `${note.offsetHeight}px`
  fabLogo.style.opacity = '0'
  note.classList.add('morphing', 'morphing-out')
  note.style.minHeight = '0px' // 解除 420px 下限：收拢末端才是 56px 圆，不是被托底的竖长条
  void note.offsetHeight
  // 目标帧：滑向球的元素位并收拢成球——落点即球位，全程无瞬移
  note.style.left = `${BALL_INSET_X}px`
  note.style.width = `${BALL_SIZE}px`
  note.style.height = `${BALL_SIZE}px`
  note.style.borderRadius = `${BALL_SIZE / 2}px`
  window.setTimeout(() => {
    void window.qink.setForm('ball').then(() => {
      // 窗口已切到球尺寸（x 不动 → 屏幕上内容零位移），球在贴纸的落点接棒
      document.body.dataset.form = 'ball'
      dock.classList.toggle('flip', winX < 0)
      requestAnimationFrame(() => {
        fabLogo.style.opacity = '' // logo 随球浮现（160ms 过渡）
      })
    })
  }, 300)
  window.setTimeout(() => {
    note.classList.remove('morphing', 'morphing-out')
    note.style.left = ''
    note.style.width = ''
    note.style.height = ''
    note.style.borderRadius = ''
    note.style.minHeight = ''
    applySize()
    document.body.classList.remove('form-morphing')
    morphLock = false
  }, 520)
}

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
  input.className = 'goal-input input-active'
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
    // 落定确认（A）：下边框扫实一次，扫完再落定，把失焦保存变得可感知
    input.classList.remove('input-active')
    input.classList.add('input-flash')
    setTimeout(() => {
      persist()
      restoreRow()
    }, 150)
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
  // 三层分区：标记(紫) > 滚入(琥珀橙) > 今日，区内保持数组顺序（纯函数，单测覆盖）
  return composeTaskOrder(data.tasks, new Date())
}

function renderTasks(): void {
  if (archive?.isOpen() || taskDrag) return // 拖动排序中不重建，防止翻篇等销毁被拖行
  const scrollTop = tasksEl.scrollTop
  tasksEl.innerHTML = ''
  for (const t of orderedTasks()) {
    if (!completing.has(t.id)) tasksEl.appendChild(taskRow(t))
  }

  if (composerOpen) {
    const composer = document.createElement('input')
    composer.className = 'composer input-active'
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
          const row = taskRow(t)
          // 高度柔性展开：新行从 0 高长出，下方内容被平滑推开，不是瞬间插入
          row.style.maxHeight = '0'
          row.style.minHeight = '0'
          row.style.opacity = '0'
          row.style.transform = 'translateY(6px)'
          tasksEl.insertBefore(row, composer) // 焦点原位保留（避免拆卸重建导致焦点重置）
          requestAnimationFrame(() => {
            row.style.maxHeight = ''
            row.style.minHeight = ''
            row.style.opacity = ''
            row.style.transform = ''
          })
          composer.value = ''
          composerDraft = ''
          composer.scrollIntoView({ block: 'nearest' })
          // 落定确认（A）：扫实一遍后自清理，允许下一条再次触发
          composer.classList.remove('input-active')
          composer.classList.add('input-flash')
          composer.addEventListener(
            'animationend',
            () => {
              composer.classList.remove('input-flash')
              composer.classList.add('input-active')
            },
            { once: true }
          )
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
    composer.classList.add('flip-in')
    composer.focus()
  } else {
    const hint = composerHint()
    hint.classList.add('flip-in')
    tasksEl.appendChild(hint)
  }
  tasksEl.scrollTop = scrollTop
  syncThumb()
  updateBallCrack() // 删除/翻篇等一切重建路径统一核对球裂缝
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
  const now = new Date()
  const hot = isDueHot(t.dueAt, now)
  const row = document.createElement('div')
  row.className =
    'task' +
    (hot ? ' urgent' : '') +
    (isRolledIn(t.createdAt, now) ? ' rolled' : '') +
    (t.pinned ? ' pinned' : '')
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
  text.title = t.pinned ? '单击改写 · 双击取消标记' : '单击改写 · 双击标记置顶'
  // 单击=改写、双击=标记，两者共用 click 序列：单击延迟判定（同 Windows 桌面图标），
  // 双击先到则取消待命的改写。代价：单击改写有约 260ms 延迟感。
  text.addEventListener('click', () => {
    if (suppressClick) return
    clearTimeout(editTimer)
    editTimer = window.setTimeout(() => startTaskEdit(t.id), EDIT_DELAY_MS)
  })
  text.addEventListener('dblclick', () => {
    if (suppressClick || Date.now() - lastDragAt < 400) return
    clearTimeout(editTimer)
    togglePin(t.id)
  })

  row.append(circle, text)
  // 截止时间标注：紧急/逾期只有红不加文字（spec），其余带时间任务行尾淡字「明天 / 9/30」
  const hint = dueHint(t.dueAt, now)
  if (hint) {
    const tag = document.createElement('span')
    tag.className = 'due-hint'
    tag.textContent = hint
    row.appendChild(tag)
  }
  wireTaskDrag(row, t)

  row.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    e.stopPropagation()
    openMenu(
      [
        { label: t.pinned ? '取消标记' : '标记置顶', action: () => togglePin(t.id) },
        { label: '改写', action: () => startTaskEdit(t.id) },
        { label: '设定时间', action: () => startDueEdit(t.id) },
        { label: '删除', action: () => deleteTask(t.id) }
      ],
      e.clientX,
      e.clientY
    )
  })

  return row
}

/* ---------- 标记置顶（双击切换） ---------- */

const EDIT_DELAY_MS = 260
let editTimer = 0

function togglePin(id: string): void {
  const task = data.tasks.find((t) => t.id === id)
  if (!task || completing.has(id)) return
  task.pinned = !task.pinned
  // 数组顺序同步为显示顺序（不变量：data.tasks 数组序即所见顺序）
  data.tasks = composeTaskOrder(data.tasks, new Date())
  persist()
  flipRender()
}

/** 重建任务区并让跳位的行从旧位置平滑滑到新位置（FLIP，复用行自身的 transform 过渡） */
function flipRender(): void {
  const before = new Map<string, number>()
  for (const row of tasksEl.querySelectorAll<HTMLElement>('.task')) {
    before.set(row.dataset.id ?? '', row.getBoundingClientRect().top)
  }
  renderTasks()
  for (const row of tasksEl.querySelectorAll<HTMLElement>('.task')) {
    const prev = before.get(row.dataset.id ?? '')
    if (prev == null) continue
    const delta = prev - row.getBoundingClientRect().top
    if (Math.abs(delta) < 1) continue
    row.style.transition = 'none'
    row.style.transform = `translateY(${delta}px)`
    row.getBoundingClientRect() // 强制回流，让起始位移先生效
    row.style.transition = ''
    row.style.transform = ''
  }
}

/* ---------- 任务行拖动排序 ----------
 * 任务行专用于排序（wireDrag 已排除 .task，拖窗口去目标区/空白按住）。
 * 按住行移动超 4px 启动：被拖行 translateY 跟随，其余行按「被拖中心越过谁」
 * 让位平移（保留行自身过渡）。预览落点钳制在同分区内（与 applyReorder 同逻辑），
 * 松手才写回数组；拖动期间 renderTasks 跳过重建。 */

interface DragRowSnapshot {
  el: HTMLElement
  center: number
  height: number
}

let taskDrag: {
  id: string
  row: HTMLElement
  fromIndex: number
  zoneStart: number
  zoneEnd: number
  rows: DragRowSnapshot[]
  gap: number
  preview: number
} | null = null
/** 最近一次行拖动的时间：双击判定据此忽略「拖动后紧接的合成双击」 */
let lastDragAt = 0
/** 落位动画收尾：松手后先演完滑入 + 浮起渐隐，到点再重建列表净化内联样式 */
let landingTimer = 0
/** 略长于让位/落位过渡（0.26s），等动画演完再重建 */
const SORT_LAND_MS = 300

function wireTaskDrag(row: HTMLElement, task: Task): void {
  row.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || taskDrag || archive?.isOpen() || completing.has(task.id)) return
    if ((e.target as Element).closest('input, button')) return // 编辑框 / 完成圈不参与

    const startX = e.clientX
    const startY = e.clientY
    let started = false
    let prevY = e.clientY
    let tilt = 0 // 跟手倾斜：行身朝运动方向微倾，快拖倾得多、停手自然回正

    const begin = (): void => {
      if (landingTimer) {
        // 上一次落位未收尾：先净化再快照，避免快照混入未清的内联位移
        clearTimeout(landingTimer)
        landingTimer = 0
        tasksEl.classList.remove('sorting')
        renderTasks()
      }
      const gap = parseFloat(getComputedStyle(tasksEl).rowGap) || 12
      const rows: DragRowSnapshot[] = Array.from(
        tasksEl.querySelectorAll<HTMLElement>('.task')
      ).map((el) => {
        const r = el.getBoundingClientRect()
        return { el, center: r.top + r.height / 2, height: r.height }
      })
      const fromIndex = rows.findIndex((s) => s.el === row)
      if (fromIndex < 0) return
      // 分区边界与 applyReorder/zoneOf 同源：紧急(红,自动) > 标记(紫) > 滚入 > 今日，拖不跨区
      const urgentCount = rows.filter((s) => s.el.classList.contains('urgent')).length
      const pinnedCount = rows.filter(
        (s) => s.el.classList.contains('pinned') && !s.el.classList.contains('urgent')
      ).length
      const rolledCount = rows.filter(
        (s) =>
          s.el.classList.contains('rolled') &&
          !s.el.classList.contains('urgent') &&
          !s.el.classList.contains('pinned')
      ).length
      const zone = row.classList.contains('urgent')
        ? 0
        : row.classList.contains('pinned')
          ? 1
          : row.classList.contains('rolled')
            ? 2
            : 3
      const zoneStart = [0, urgentCount, urgentCount + pinnedCount, urgentCount + pinnedCount + rolledCount][zone]
      const zoneEnd = [urgentCount, urgentCount + pinnedCount, urgentCount + pinnedCount + rolledCount, rows.length][zone]
      taskDrag = {
        id: task.id,
        row,
        fromIndex,
        zoneStart,
        zoneEnd,
        rows,
        gap,
        preview: fromIndex
      }
      lastDragAt = Date.now()
      tasksEl.classList.add('sorting') // 让位/落位行走专用缓出曲线（见 style.css）
      row.classList.add('drag-sorting')
    }

    const dragTo = (dy: number): void => {
      const st = taskDrag
      if (!st) return
      const dragCenter = st.rows[st.fromIndex].center + dy
      let preview = 0
      for (let i = 0; i < st.rows.length; i++) {
        if (i === st.fromIndex) continue
        if (dragCenter > st.rows[i].center) preview++
      }
      st.preview = Math.min(Math.max(preview, st.zoneStart), st.zoneEnd - 1)
      // 落点变更时让夹在中间的行整体平移一个身位（含间距），其余归位
      const span = st.rows[st.fromIndex].height + st.gap
      for (let i = 0; i < st.rows.length; i++) {
        if (i === st.fromIndex) continue
        let offset = 0
        if (st.fromIndex < st.preview && i > st.fromIndex && i <= st.preview) offset = -span
        else if (st.fromIndex > st.preview && i >= st.preview && i < st.fromIndex) offset = span
        st.rows[i].el.style.transform = offset ? `translateY(${offset}px)` : ''
      }
      // 捏起 1.02 + 速度倾斜（角度钳在 ±2.4°，低通平滑防抖动）；松手滑向槽位时
      // 目标 transform 不带 scale/rotate，浏览器按矩阵插值边滑边回正，无生硬跳变
      row.style.transform = `translateY(${dy}px) scale(1.02) rotate(${tilt.toFixed(2)}deg)`
    }

    const move = (ev: PointerEvent): void => {
      const dy = ev.clientY - startY
      if (!started) {
        if (Math.hypot(ev.clientX - startX, dy) < 4) return
        started = true
        begin()
      }
      const vy = ev.clientY - prevY
      prevY = ev.clientY
      const target = Math.max(-2.4, Math.min(2.4, vy * 0.35))
      tilt = tilt * 0.72 + target * 0.28
      dragTo(dy)
    }
    const up = (): void => finish(true)
    const cancel = (): void => finish(false)
    const finish = (commit: boolean): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
      const st = taskDrag
      taskDrag = null
      if (!st) return
      if (!commit) {
        tasksEl.classList.remove('sorting')
        for (const s of st.rows) {
          s.el.style.transform = '' // 有过渡，滑回原位
          s.el.classList.remove('drag-sorting') // 浮起效果渐隐
        }
        return
      }
      suppressClick = true
      setTimeout(() => {
        suppressClick = false
      }, 0)
      data.tasks = applyReorder(data.tasks, st.id, st.preview, new Date())
      persist()
      // 落位动画：先不重建——被拖行去掉 drag-sorting（浮起渐隐、transform 过渡恢复），
      // 滑向最终槽位（preview 槽与原槽的中心差），让位行保持；动画演完再 renderTasks
      // 净化内联样式（data 已是新序，重建后布局即最终位置，无视觉跳变）
      st.row.classList.remove('drag-sorting')
      st.row.style.transform =
        st.preview === st.fromIndex
          ? ''
          : `translateY(${st.rows[st.preview].center - st.rows[st.fromIndex].center}px)`
      landingTimer = window.setTimeout(() => {
        landingTimer = 0
        tasksEl.classList.remove('sorting')
        renderTasks()
      }, SORT_LAND_MS)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
  })
}

function startTaskEdit(id: string): void {
  const row = tasksEl.querySelector(`[data-id="${id}"]`) as HTMLElement | null
  const task = data.tasks.find((t) => t.id === id)
  if (!row || !task || completing.has(id) || row.querySelector('input')) return
  const span = row.querySelector('.text') as HTMLElement
  const input = document.createElement('input')
  input.className = 'task-input input-active'
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
    // 落定确认（A）：扫实一次再落定
    input.classList.remove('input-active')
    input.classList.add('input-flash')
    setTimeout(() => {
      persist()
      span.textContent = task.text
      input.replaceWith(span)
      row.querySelector('button')?.setAttribute('aria-label', `完成：${task.text}`)
    }, 150)
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

/* ---------- 设定时间（M15）：右键行内输入，窄语法解析 ---------- */

/** 预填当前 dueAt 的可编辑形式：日期粒度 → 9/30，时刻粒度 → 15:30（绝对格式，不依赖相对词） */
function dueInputValue(t: Task): string {
  if (!t.dueAt) return ''
  const d = new Date(t.dueAt)
  if (d.getHours() === 0 && d.getMinutes() === 0) return `${d.getMonth() + 1}/${d.getDate()}`
  const pad2 = (n: number): string => String(n).padStart(2, '0')
  return `${d.getHours()}:${pad2(d.getMinutes())}`
}

function startDueEdit(id: string): void {
  const row = tasksEl.querySelector(`[data-id="${id}"]`) as HTMLElement | null
  const task = data.tasks.find((t) => t.id === id)
  if (!row || !task || completing.has(id) || row.querySelector('input')) return

  const input = document.createElement('input')
  input.className = 'due-input input-active'
  input.value = dueInputValue(task)
  input.placeholder = '15:00 / 9/30 / 明天'
  input.setAttribute('aria-label', '设定时间（清空提交 = 取消）')
  const hint = row.querySelector('.due-hint')
  if (hint) hint.replaceWith(input)
  else row.appendChild(input)
  input.focus()
  input.select()

  let finished = false
  /** 抖动 = 没听懂，不保存可重试 */
  const shake = (): void => {
    input.classList.remove('input-shake')
    input.classList.add('input-shake')
    input.addEventListener('animationend', () => input.classList.remove('input-shake'), { once: true })
    input.focus()
    input.select()
  }
  const restore = (): void => {
    if (hint) input.replaceWith(hint)
    else input.remove()
  }
  const apply = (dueAt: string | undefined): void => {
    if (dueAt === undefined) delete task.dueAt
    else task.dueAt = dueAt
    data.tasks = composeTaskOrder(data.tasks, new Date()) // 分区可能跳变（数组序 = 显示序不变量）
    persist()
    flipRender()
    updateBallCrack()
  }
  const commit = (): void => {
    if (finished) return
    const raw = input.value.trim()
    if (!raw) {
      finished = true
      apply(undefined) // 清空提交 = 取消时间
      return
    }
    const parsed = parseDueInput(raw, new Date())
    if (!parsed.ok) {
      shake() // 静默错误是信任杀手：不保存，让用户看见没听懂
      return
    }
    finished = true
    apply(parsed.dueAt)
  }
  input.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter') commit()
    else if (e.key === 'Escape') {
      finished = true
      restore()
    }
  })
  // 失焦 = 温和提交；解析失败则静默放弃（用户已点别处，抖动无人看）
  input.addEventListener('blur', () => {
    if (finished) return
    const raw = input.value.trim()
    if (!raw) {
      finished = true
      restore()
      return
    }
    const parsed = parseDueInput(raw, new Date())
    finished = true
    if (parsed.ok) apply(parsed.dueAt)
    else restore()
  })
}

/* ---------- 悬浮球裂缝：逾期任务的专属信号（常亮不闪，spec） ---------- */

function updateBallCrack(): void {
  const now = new Date()
  const cracked = data.tasks.some((t) => t.dueAt && dueStatus(t.dueAt, now) === 'overdue')
  fab.classList.toggle('cracked', cracked)
  fab.title = cracked ? '有逾期任务 · 双击展开贴纸 · 长按拖动' : '双击展开贴纸 · 长按拖动'
}

function deleteTask(id: string): void {
  if (completing.has(id)) return
  const row = tasksEl.querySelector(`[data-id="${id}"]`) as HTMLElement | null
  const remove = (): void => {
    data.tasks = data.tasks.filter((t) => t.id !== id)
    persist()
    renderTasks()
  }
  if (!row || prefersReduce() || row.querySelector('input')) {
    remove()
    return
  }
  // 高度柔性收拢：整行折到 0 高再落盘重建，列表不瞬间跳动
  row.style.maxHeight = `${row.offsetHeight}px`
  void row.offsetHeight
  row.classList.add('completing')
  window.setTimeout(remove, 380)
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
    updateBallCrack() // 完成的若是最后一条逾期任务，球裂缝随即消失
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

/* ---------- 自绘滑条：不常驻；溢出时从触点 scaleY 生长，静置后收回 ---------- */

let thumbTimer = 0

function syncThumb(): void {
  if (tasksEl.scrollHeight - tasksEl.clientHeight <= 1) {
    tasksThumb.classList.remove('on')
    return
  }
  const trackH = Math.max(0, tasksEl.clientHeight - 6)
  const th = Math.max(30, trackH * (tasksEl.clientHeight / tasksEl.scrollHeight))
  const maxScroll = tasksEl.scrollHeight - tasksEl.clientHeight
  const ty = (trackH - th) * (tasksEl.scrollTop / maxScroll)
  tasksThumb.style.setProperty('--ty', `${ty.toFixed(1)}px`)
  tasksThumb.style.height = `${th.toFixed(1)}px`
}

function wakeThumb(originY?: number): void {
  if (tasksEl.scrollHeight - tasksEl.clientHeight <= 1) return
  if (originY != null && Number.isFinite(originY)) {
    const oy = Math.max(0, Math.min(tasksEl.clientHeight, originY))
    tasksThumb.style.setProperty('--oy', `${oy.toFixed(0)}px`)
  }
  syncThumb()
  tasksThumb.classList.add('on')
  window.clearTimeout(thumbTimer)
  thumbTimer = window.setTimeout(() => tasksThumb.classList.remove('on'), 1000)
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
      { label: '已完成清单', action: () => { if (form === 'ball') setForm('note'); openArchive() } },
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
      // 修复：从档案消失，作为未完成任务回到今日（滚入琥珀橙由创建日如实推导；
      // dueAt 原样带回——修复回一条逾期任务会立即红，信息无损）
      const idx = data.archive.findIndex((a) => a.id === id)
      if (idx === -1) return
      const [a] = data.archive.splice(idx, 1)
      data.tasks.push({ id: a.id, text: a.text, createdAt: a.createdAt, dueAt: a.dueAt })
      persist()
      updateBallCrack()
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
    } else if (e.key === 'Escape') {
      // Escape 全局收起：菜单/归档/输入框各有自己的 Escape 处理，走到这里即贴纸空闲态
      if (form === 'note' && !archive?.isOpen()) setForm('ball')
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
    const next = !target.closest('#note, #dock, #menu')
    if (next !== ignored) { ignored = next; window.qink.ignoreMouse(next) }
  })
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault() // 原生菜单全禁：自绘菜单（M7 手势也依赖此设定）
    if (Date.now() - gestureFiredAt < 600) return // 手势刚触发过，不开菜单
    const target = e.target as HTMLElement
    if (!target.closest('#note, #dock') || target.closest('.task, input, .archive, .quick')) {
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

  // 跨午夜自动翻篇（30 秒对一次表，零定时器清空，渲染时按周期键推导）。
  // 时刻任务的紧急→逾期边界发生在当天内，贴纸红不变、唯一变化是球裂缝，
  // 故每次对表都幂等核对一次裂缝状态（toggle 同值零开销）。
  // 空闲收起检查同车：间隔 min(30s, 超时/2)——交付配置 10 分钟时仍为 30s。
  const tickMs = Math.min(30_000, IDLE_COLLAPSE_MS / 2)
  setInterval(() => {
    updateBallCrack()
    if (noteIdleExpired(Date.now())) setForm('ball')
    const k = dateKey(new Date())
    if (k !== lastDateKey) {
      lastDateKey = k
      render()
    }
  }, tickMs)

  // 窗口失焦即停滑行（隐藏窗口 rAF 暂停，锚点留在半途不如立刻落定）
  window.addEventListener('blur', cancelGlide)

  // 滑条：滚动/触碰时从触点生长，静置 1s 收回
  const thumbOrigin = (e: { clientY: number }): number => e.clientY - tasksWrap.getBoundingClientRect().top
  tasksEl.addEventListener(
    'scroll',
    () => {
      syncThumb()
      wakeThumb()
    },
    { passive: true }
  )
  tasksEl.addEventListener('wheel', (e) => wakeThumb(thumbOrigin(e)), { passive: true })
  tasksEl.addEventListener('pointerdown', (e) => wakeThumb(thumbOrigin(e)))
  new ResizeObserver(syncThumb).observe(tasksEl)
  syncThumb()

  wireDrag()
  wireResize()
  wireBall()
}

/* ---------- 松手惯性 + 贴边回弹（IPC 投掷） ----------
 * 窗口移动走 IPC（锚点 + 绝对位移），惯性在渲染层做物理模拟：
 * 摩擦指数衰减 + 工作区边界 0.34 恢复系数反弹，每帧把外推位移交 dragMove。
 * 边界与主进程 clampNotePosition 同源（qink:work-area），模拟落点即真实落点；
 * 锚点由「当前窗位 - 最近一次上报位移」推导（forwardPos 每帧跟随，误差 ≤1 帧）。 */

interface Glide {
  vx: number
  vy: number
  gx: number
  gy: number
  raf: number
  last: number
  bounces: number
}

let glide: Glide | null = null
let glideSeq = 0

function cancelGlide(): void {
  glideSeq++ // 让 in-flight 的 fling（await 工作区中）失效，无论当前是否真有滑行
  if (!glide) return
  cancelAnimationFrame(glide.raf)
  glide = null
  window.qink.dragEnd() // 锚点即时归还，后续按压重新 dragStart 取新锚
}

interface VelocitySample {
  x: number
  y: number
  t: number
}

function releaseVelocity(samples: VelocitySample[]): { x: number; y: number } {
  const now = performance.now()
  const recent = samples.filter((s) => now - s.t <= 90)
  if (recent.length < 2) return { x: 0, y: 0 }
  const a = recent[0]
  const b = recent[recent.length - 1]
  const dt = b.t - a.t
  if (dt < 8) return { x: 0, y: 0 }
  return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt }
}

async function fling(vx0: number, vy0: number, lastDx: number, lastDy: number): Promise<void> {
  const speed = Math.hypot(vx0, vy0)
  if (prefersReduce() || speed < 0.25 || morphLock) {
    window.qink.dragEnd() // 未达惯性阈值：维持原行为，立即落定
    return
  }
  const cap = 1.6 // 上限防甩飞：再快的轻扫也不超过 1.6px/ms
  const vx = Math.max(-cap, Math.min(cap, vx0))
  const vy = Math.max(-cap, Math.min(cap, vy0))
  const isBall = form === 'ball'
  const insetX = isBall ? BALL_INSET_X : NOTE_INSET_X
  const contentW = isBall ? BALL_SIZE : curW
  const contentH = isBall ? BALL_SIZE : Math.round(manualH ?? note.offsetHeight)
  const winW = contentW + insetX * 2
  const winH = contentH + NOTE_INSET_Y + NOTE_INSET_BOTTOM
  const seq = ++glideSeq
  const area = await window.qink.workArea()
  if (seq !== glideSeq) {
    window.qink.dragEnd() // await 期间被新按压/切形态接管（cancelGlide 已归还过锚点，幂等）
    return
  }
  const anchorX = winX - lastDx
  const anchorY = winY - lastDy
  // 边界换算成 dragMove 位移域：窗口可落在 [工作区 - 透明边距, 工作区 - 窗宽 - 透明边距]
  const minGx = area.x - insetX - anchorX
  const maxGx = area.x + area.width - winW - insetX - anchorX
  const minGy = area.y - NOTE_INSET_Y - anchorY
  const maxGy = area.y + area.height - winH - NOTE_INSET_Y - anchorY
  const g: Glide = { vx, vy, gx: lastDx, gy: lastDy, raf: 0, last: performance.now(), bounces: 0 }
  glide = g
  const step = (t: number): void => {
    if (glide !== g) return // 被新按压/形态切换接管
    const dt = Math.min(32, t - g.last)
    g.last = t
    g.gx += g.vx * dt
    g.gy += g.vy * dt
    if (g.gx <= minGx) {
      g.gx = minGx
      g.vx = Math.abs(g.vx) * 0.34
      g.bounces++
    } else if (g.gx >= maxGx) {
      g.gx = maxGx
      g.vx = -Math.abs(g.vx) * 0.34
      g.bounces++
    }
    if (g.gy <= minGy) {
      g.gy = minGy
      g.vy = Math.abs(g.vy) * 0.34
      g.bounces++
    } else if (g.gy >= maxGy) {
      g.gy = maxGy
      g.vy = -Math.abs(g.vy) * 0.34
      g.bounces++
    }
    const decay = Math.exp(-dt / 170)
    g.vx *= decay
    g.vy *= decay
    window.qink.dragMove(g.gx, g.gy)
    if ((Math.abs(g.vx) > 0.02 || Math.abs(g.vy) > 0.02) && g.bounces < 8) {
      g.raf = requestAnimationFrame(step)
    } else {
      glide = null
      window.qink.dragEnd() // 落定：归还锚点并保存位置
    }
  }
  g.raf = requestAnimationFrame(step)
}

/* ---------- 自绘拖动 ----------
 * 抓住贴纸任意非交互空白处拖动（任务行除外——专用于拖动排序，见 wireTaskDrag）。
 * 位移按 rAF 合帧上报，主进程按「按下时锚点 + 位移」
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
  let samples: VelocitySample[] = []
  const flush = (): void => {
    raf = 0
    if (dragging) window.qink.dragMove(pendingDx, pendingDy)
  }
  note.addEventListener('pointerdown', (e) => {
    if (
      e.button !== 0 ||
      morphLock ||
      (e.target as Element).closest('input, button, .task, .composer-hint, .archive')
    )
      return
    cancelGlide() // 空中接住滑行中的贴纸
    tracking = true
    dragging = false
    samples = [{ x: e.screenX, y: e.screenY, t: performance.now() }]
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
    samples.push({ x: e.screenX, y: e.screenY, t: performance.now() })
    if (samples.length > 8) samples.shift()
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
      dragging = false
      note.classList.remove('dragging')
      const v = releaseVelocity(samples)
      void fling(v.x, v.y, pendingDx, pendingDy) // 惯性滑行+贴边回弹；快慢两条路都在 fling 内归还锚点
    }
    if (e && note.hasPointerCapture(e.pointerId)) note.releasePointerCapture(e.pointerId)
  }
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
  window.addEventListener('blur', () => end())
}

/* ---------- 边缘调尺寸（M14） ----------
 * 边缘热区按下锚定起点，位移按 rAF 合帧换算新宽高并上报（窗口跟随）。
 * 拿到底边 = 高度转为手动固定；左边缘宽度变化时同步平移窗口锚点。
 * 双击热区 = 清除手动尺寸，回到 320 宽 + 高度自适应。 */

function wireResize(): void {
  let tracking = false
  let edge = ''
  let startX = 0
  let startY = 0
  let startW = 0
  let startH = 0
  let startWinX = 0
  let raf = 0
  let pending: { w: number; h: number; x?: number } | null = null

  const flush = (): void => {
    raf = 0
    if (!pending) return
    curW = pending.w
    applySize()
    window.qink.resizeNote(pending.w, pending.h, pending.x)
    pending = null
  }
  const compute = (e: PointerEvent): void => {
    const dx = e.screenX - startX
    const dy = e.screenY - startY
    let w = startW
    let x: number | undefined
    if (edge.includes('left')) w = startW - dx
    else if (edge.includes('right')) w = startW + dx
    w = clampNoteWidth(w)
    if (edge.includes('left')) x = startWinX + (startW - w)
    if (manualH != null) {
      if (edge.includes('bottom')) manualH = Math.max(NOTE_MIN_HEIGHT, Math.round(startH + dy))
      note.style.height = `${manualH}px`
    }
    pending = { w, h: manualH ?? Math.round(desiredNoteHeight()), x }
    if (!raf) raf = requestAnimationFrame(flush)
  }
  const end = (): void => {
    if (!tracking) return
    tracking = false
    if (raf) { cancelAnimationFrame(raf); raf = 0 }
    flush()
    data.settings.noteW = curW
    data.settings.noteH = manualH
    persist()
    scheduleReport()
  }

  for (const el of document.querySelectorAll<HTMLElement>('.edge')) {
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || morphLock || archive?.isOpen()) return
      e.stopPropagation() // 别触发便签拖动
      e.preventDefault()
      tracking = true
      edge = el.dataset.edge ?? ''
      startX = e.screenX
      startY = e.screenY
      const rect = note.getBoundingClientRect()
      startW = Math.round(rect.width)
      startH = Math.round(rect.height)
      startWinX = winX
      if (edge.includes('bottom')) manualH = startH // 拿到底边 = 接管高度
      try { el.setPointerCapture(e.pointerId) } catch { /* 合成事件无活动指针，window 监听兜底 */ }
    })
    el.addEventListener('dblclick', (e) => {
      e.stopPropagation()
      curW = NOTE_WIDTH
      manualH = null
      note.style.width = ''
      note.style.height = ''
      data.settings.noteW = null
      data.settings.noteH = null
      persist()
      scheduleReport()
    })
  }
  window.addEventListener('pointermove', (e) => {
    if (!tracking) return
    compute(e)
  })
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
  window.addEventListener('blur', () => end())
}

/* ---------- 悬浮球交互：长按拖动 · 悬停速记 · 双击展开 ---------- */

/* ---------- 速记提交动效：碎和聚（文字碎成琉璃屑，弧线飞入悬浮球收拢） ----------
 * 与完成碎裂/归档愈合同一套语言：碎片用不规则多边形，单条连续时间线无空白态；
 * 裂纹仍专属归档行，球的收拢只用碎片 + 脉动表达。 */

const SHARD_SHAPES = [
  [[0, 0], [10, 2], [4, 8]],
  [[0, 3], [12, 0], [9, 7], [2, 9]],
  [[0, 0], [8, 1], [6, 7]],
  [[1, 0], [9, 3], [3, 9], [0, 5]],
  [[0, 2], [11, 0], [8, 8]]
]

function gatherShards(): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    // 减弱动态：不做位移，用透明度脉冲传达「已接收」
    fab.animate([{ opacity: 1 }, { opacity: 0.55 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' })
    return
  }
  const from = quickInput.getBoundingClientRect()
  const to = fab.getBoundingClientRect()
  const fy = from.top + from.height / 2
  const tx = to.left + to.width / 2
  const ty = to.top + to.height / 2
  const overlay = document.createElement('div')
  overlay.className = 'shard-flight'
  document.body.appendChild(overlay)

  const COUNT = 5
  let landed = 0
  const firstHit = (): void => {
    // 首片命中：轻微下压，提示「开始接收」
    fab.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(0.97)' }, { transform: 'scale(1)' }],
      { duration: 150, easing: 'ease-out' }
    )
  }
  const settle = (): void => {
    if (++landed < COUNT) return
    // 末片落定：收拢脉动（微缩 → 回弹 → 落定），字标同步提亮
    fab.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(0.94)' },
        { transform: 'scale(1.05)' },
        { transform: 'scale(1)' }
      ],
      { duration: 300, easing: 'cubic-bezier(0.3, 0, 0.2, 1)' }
    )
    // 字标 = Q logo（.logo）。不能抓 'svg'：生产球面唯一的 svg 是逾期红裂缝，
    // 提亮它会让没逾期的球在每次速记提交时红裂缝闪现
    fabLogo.animate(
      [{ opacity: 0.9 }, { opacity: 1 }, { opacity: 0.9 }],
      { duration: 300, easing: 'ease-out' }
    )
    setTimeout(() => overlay.remove(), 60)
  }
  for (let i = 0; i < COUNT; i++) {
    const shape = SHARD_SHAPES[i % SHARD_SHAPES.length]
    const w = 7 + Math.random() * 6
    const shard = document.createElement('div')
    shard.className = 'fly-shard'
    shard.style.clipPath = `polygon(${shape.map(([px, py]) => `${((px / 12) * w).toFixed(1)}px ${((py / 9) * w).toFixed(1)}px`).join(', ')})`
    shard.style.width = `${w}px`
    shard.style.height = `${w}px`
    // 起碎点沿输入框散布（文字尾端更密），弧顶随机抬升，飞行带旋转的抛物感
    const sx = from.right - from.width * (0.2 + Math.random() * 0.6)
    const sy = fy + (Math.random() - 0.5) * 10
    const dx = tx - sx
    const dy = ty - sy
    const lift = 26 + Math.random() * 30
    const rot = (Math.random() - 0.5) * 220
    shard.animate(
      [
        { transform: `translate(${sx}px, ${sy}px) rotate(0deg) scale(1)`, opacity: 1 },
        { transform: `translate(${sx + dx * 0.5}px, ${sy + dy * 0.5 - lift}px) rotate(${(rot * 0.6).toFixed(0)}deg) scale(1)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${tx}px, ${ty}px) rotate(${rot.toFixed(0)}deg) scale(0.35)`, opacity: 0 }
      ],
      { duration: 360 + Math.random() * 120, delay: i * 36, easing: 'cubic-bezier(0.3, 0, 0.2, 1)' }
    ).onfinish = () => {
      shard.remove()
      if (landed === 0) firstHit()
      settle()
    }
    overlay.appendChild(shard)
  }
  setTimeout(() => overlay.remove(), 900) // 隐藏窗口兜底（WAAPI 可能不触发 onfinish）
}

function wireBall(): void {
  const HOLD_MS = 260
  let armTimer = 0
  let armed = false
  let tracking = false
  let anchorX = 0
  let anchorY = 0
  let pendingDx = 0
  let pendingDy = 0
  let raf = 0
  let samples: VelocitySample[] = []
  const flush = (): void => {
    raf = 0
    if (armed) window.qink.dragMove(pendingDx, pendingDy)
  }
  const end = (): void => {
    if (!tracking) return
    tracking = false
    clearTimeout(armTimer)
    if (raf) { cancelAnimationFrame(raf); raf = 0 }
    if (armed) {
      armed = false
      flush()
      suppressClick = true
      setTimeout(() => { suppressClick = false }, 0)
      dock.classList.remove('lifting')
      const v = releaseVelocity(samples)
      void fling(v.x, v.y, pendingDx, pendingDy) // 惯性滑行+贴边回弹；快慢两条路都在 fling 内归还锚点
    }
  }
  dock.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || morphLock) return
    if ((e.target as Element).closest('.quick')) return
    cancelGlide() // 空中接住滑行中的球
    armed = false
    tracking = true
    samples = [{ x: e.screenX, y: e.screenY, t: performance.now() }]
    anchorX = e.screenX
    anchorY = e.screenY
    clearTimeout(armTimer)
    armTimer = window.setTimeout(() => {
      if (!tracking) return
      armed = true
      dock.classList.add('lifting')
      window.qink.dragStart() // 锚点取 arm 时刻窗口位置，按住未动期间不产生漂移
      try { dock.setPointerCapture(e.pointerId) } catch { /* 合成事件无活动指针，window 监听兜底 */ }
    }, HOLD_MS)
  })
  window.addEventListener('pointermove', (e) => {
    if (!tracking) return
    if (!armed) {
      // 提前挪动 = 不算长按，取消武装（与双击互不干扰）
      if (Math.hypot(e.screenX - anchorX, e.screenY - anchorY) > 8) {
        tracking = false
        clearTimeout(armTimer)
      }
      return
    }
    pendingDx = e.screenX - anchorX
    pendingDy = e.screenY - anchorY
    samples.push({ x: e.screenX, y: e.screenY, t: performance.now() })
    if (samples.length > 8) samples.shift()
    if (!raf) raf = requestAnimationFrame(flush)
  })
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
  window.addEventListener('blur', end)

  dock.addEventListener('dblclick', (e) => {
    if ((e.target as Element).closest('.quick')) return
    setForm('note')
  })

  quickInput.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter') {
      const text = quickInput.value.trim()
      if (!text) return
      data.tasks.push({ id: crypto.randomUUID(), text, createdAt: new Date().toISOString() })
      persist() // 球形态下任务区隐藏，落盘即可；展开时由 applyForm 补渲染
      quickInput.value = ''
      gatherShards() // 碎和聚：文字碎成琉璃屑飞入球中收拢
    } else if (e.key === 'Escape') {
      quickInput.blur()
    }
  })
  quickInput.addEventListener('focus', () => dock.classList.add('quick-open'))
  quickInput.addEventListener('blur', () => dock.classList.remove('quick-open'))

  closeBtn.addEventListener('click', () => setForm('ball'))
}

async function boot(): Promise<void> {
  data = await window.qink.getData()
  curW = clampNoteWidth(typeof data.settings.noteW === 'number' ? data.settings.noteW : NOTE_WIDTH)
  manualH = typeof data.settings.noteH === 'number'
    ? Math.max(NOTE_MIN_HEIGHT, Math.round(data.settings.noteH))
    : null
  form = data.settings.noteMode === 'ball' ? 'ball' : 'note' // 旧数据无 noteMode 时按贴纸走
  applySize()
  lastDateKey = dateKey(new Date())
  render()
  wire()
  applyForm()
  updateBallCrack()
}

void boot()
