import type { ArchivedTask } from '@shared/dates'
import { dateKey } from '@shared/dates'
import { crackLines, crackSVG, glassCells } from './shatter'

// 已完成清单（spec.md 招牌交互）：碎片合并成仍带裂纹的任务条，任务区暂时隐藏。
// 滚轮逐日往前翻；双击修复（裂纹淡出，任务回到今日）；点别处/Esc 反向碎开退出。

const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六']
const ANIMATE_ROW_CAP = 10 // 碎片合并动画只做前 N 行，更老的直接淡入（控制开销）

function shiftDay(key: string, delta: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const dt = new Date(y, m - 1, d + delta)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
}

function dayLabel(key: string, todayKey: string): string {
  const [, m, d] = key.split('-').map(Number)
  const wd = WEEK_CN[new Date(key.replace(/-/g, '/')).getDay()]
  return key === todayKey ? `今天 · ${m}月${d}日 周${wd}` : `${m}月${d}日 周${wd}`
}

export interface ArchiveOptions {
  note: HTMLElement
  scrollEl: HTMLElement
  entriesFor: (dayKey: string) => ArchivedTask[]
  onRestore: (id: string) => void
  onClose?: () => void
}

export interface ArchiveHandle {
  isOpen(): boolean
  open(): void
  close(): void
}

export function createArchiveView(opts: ArchiveOptions): ArchiveHandle {
  const { note, scrollEl } = opts
  let open_ = false
  let container: HTMLElement | null = null
  let animating = false
  let closing = false
  let closeRequested = false
  let lastWheel = 0
  const restoring = new Set<string>()
  const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let viewing = dateKey(new Date())
  const todayKey = (): string => dateKey(new Date())

  const onDocClick = (e: Event): void => {
    if (!open_ || animating) return
    if ((e.target as HTMLElement).closest('.archive')) return
    close()
  }
  const onKey = (e: KeyboardEvent): void => {
    if (!open_) return
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      changeDay(e.key === 'ArrowLeft' ? -1 : 1)
    }
  }
  const onWheel = (e: WheelEvent): void => {
    if (!open_ || e.deltaY === 0) return
    if (!e.altKey && scrollEl.scrollHeight > scrollEl.clientHeight + 1) return
    e.preventDefault()
    const now = performance.now()
    const previous = lastWheel
    lastWheel = now
    if (animating || restoring.size > 0 || now - previous < 280) return
    const delta = e.deltaY < 0 ? -1 : 1 // 上滚 = 更早的日子；下滚 = 回向今天
    changeDay(delta)
  }

  function changeDay(delta: number): void {
    if (!open_ || animating || closing || restoring.size > 0) return
    const next = shiftDay(viewing, delta)
    if (next > todayKey()) return // 不越过今天
    if (next !== viewing) {
      viewing = next
      renderDay(true)
    }
  }

  function open(): void {
    if (open_) return
    open_ = true
    closeRequested = false
    closing = false
    lastWheel = -Infinity
    viewing = todayKey()
    scrollEl.classList.add('archive-mode')
    container = document.createElement('div')
    container.className = 'archive'
    scrollEl.appendChild(container)
    document.addEventListener('click', onDocClick)
    document.addEventListener('keydown', onKey)
    scrollEl.addEventListener('wheel', onWheel, { passive: false })
    renderDay(false)
  }

  function close(): void {
    if (!open_ || closing) return
    if (animating || restoring.size > 0) {
      closeRequested = true
      return
    }
    closing = true
    document.removeEventListener('click', onDocClick)
    document.removeEventListener('keydown', onKey)
    scrollEl.removeEventListener('wheel', onWheel)
    const rows = Array.from(container?.querySelectorAll('.archive-row') ?? []) as HTMLElement[]
    const shown = rows.slice(0, ANIMATE_ROW_CAP)
    animating = true
    // 反向碎开退出：可见行并行碎裂
    void Promise.all(shown.map((r) => shatterOut(r))).then(() => {
      container?.remove()
      container = null
      scrollEl.classList.remove('archive-mode')
      open_ = false
      animating = false
      closing = false
      closeRequested = false
      opts.onClose?.()
    })
  }

  /** 行碎开消失（退出动画用） */
  function shatterOut(row: HTMLElement): Promise<void> {
    if (reducedMotion()) return Promise.resolve()
    return new Promise((resolve) => {
      const rect = row.getBoundingClientRect()
      const noteRect = note.getBoundingClientRect()
      const { cells } = glassCells(rect.width, rect.height, 8, 2)
      const stage = document.createElement('div')
      stage.className = 'shatter-stage'
      stage.style.left = `${rect.left - noteRect.left}px`
      stage.style.top = `${rect.top - noteRect.top}px`
      stage.style.width = `${rect.width}px`
      stage.style.height = `${rect.height}px`
      let done = 0
      for (const poly of cells) {
        const shard = document.createElement('div')
        shard.className = 'shard'
        shard.style.clipPath = `polygon(${poly.map((p) => `${p[0]}px ${p[1]}px`).join(', ')})`
        const clone = row.cloneNode(true) as HTMLElement
        clone.style.position = 'absolute'
        clone.style.inset = '0'
        clone.style.opacity = '1'
        shard.appendChild(clone)
        const dx = (Math.random() - 0.5) * 60
        const dy = 18 + Math.random() * 40
        shard.animate(
          [
            { transform: 'none', opacity: 1 },
            { transform: `translate(${dx}px, ${dy}px) rotate(${(Math.random() - 0.5) * 40}deg)`, opacity: 0 }
          ],
          { duration: 300 + Math.random() * 140, easing: 'cubic-bezier(0.4, 0, 0.9, 0.6)' }
        ).onfinish = () => {
          shard.remove()
          if (++done >= cells.length) {
            stage.remove()
            resolve()
          }
        }
        stage.appendChild(shard)
      }
      row.style.visibility = 'hidden'
      note.appendChild(stage)
      setTimeout(() => {
        stage.remove()
        resolve()
      }, 700)
    })
  }

  /** 碎片沿放射方向飞回撞击点合拢（入场 = 完成碎裂的逆放；行保持裂纹） */
  function assembleRow(row: HTMLElement, index: number): Promise<void> {
    if (reducedMotion()) return Promise.resolve()
    return new Promise((resolve) => {
      const rect = row.getBoundingClientRect()
      const noteRect = note.getBoundingClientRect()
      const { cells, impact } = glassCells(rect.width, rect.height, 9, 2)
      const stage = document.createElement('div')
      stage.className = 'shatter-stage'
      stage.style.left = `${rect.left - noteRect.left}px`
      stage.style.top = `${rect.top - noteRect.top}px`
      stage.style.width = `${rect.width}px`
      stage.style.height = `${rect.height}px`
      row.style.opacity = '0' // 碎片代言；全部落定瞬间无缝交接给真身
      let done = 0
      let settled = false
      const settle = (): void => {
        if (settled) return
        settled = true
        stage.remove()
        row.style.opacity = ''
        resolve()
      }
      for (const poly of cells) {
        const shard = document.createElement('div')
        shard.className = 'shard'
        shard.style.clipPath = `polygon(${poly.map((p) => `${p[0]}px ${p[1]}px`).join(', ')})`
        const clone = row.cloneNode(true) as HTMLElement
        clone.style.position = 'absolute'
        clone.style.inset = '0'
        clone.style.opacity = '1'
        shard.appendChild(clone)
        // 入场 = 完成碎裂的逆放：碎片沿放射方向飞回撞击点合拢
        let mx = 0
        let my = 0
        for (const p of poly) {
          mx += p[0]
          my += p[1]
        }
        mx /= poly.length
        my /= poly.length
        const rdx = mx - impact[0]
        const rdy = my - impact[1]
        const d = Math.hypot(rdx, rdy)
        const ang = d > 0.5 ? Math.atan2(rdy, rdx) : Math.random() * Math.PI * 2
        const dist = 18 + 72 / (1 + d / 26) + Math.random() * 20
        const rot = (Math.random() - 0.5) * Math.min(90, 22 + 700 / (24 + d))
        shard.animate(
          [
            {
              transform: `translate(${Math.cos(ang) * dist}px, ${Math.sin(ang) * dist - 26 - Math.random() * 30}px) rotate(${rot}deg)`,
              opacity: 0
            },
            { transform: 'none', opacity: 1 }
          ],
          {
            duration: 380 + Math.random() * 140,
            delay: index * 26,
            easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.12)',
            fill: 'backwards'
          }
        ).onfinish = () => {
          shard.remove()
          if (++done >= cells.length) settle()
        }
        stage.appendChild(shard)
      }
      note.appendChild(stage)
      setTimeout(settle, 1100 + index * 26) // 隐藏窗口兜底（WAAPI 可能不触发 onfinish）
    })
  }

  function renderDay(flip: boolean): void {
    const box = container
    if (!box) return
    box.innerHTML = ''
    animating = true

    scrollEl.scrollTop = 0
    const toolbar = document.createElement('div')
    toolbar.className = 'archive-toolbar'
    const button = (text: string, title: string, action: () => void): HTMLButtonElement => {
      const el = document.createElement('button')
      el.type = 'button'
      el.className = 'archive-nav'
      el.textContent = text
      el.title = title
      el.setAttribute('aria-label', title)
      el.addEventListener('click', action)
      return el
    }
    const previous = button('‹', '前一天（←）', () => changeDay(-1))
    const label = document.createElement('div')
    label.className = 'archive-date'
    label.setAttribute('aria-live', 'polite')
    label.textContent = dayLabel(viewing, todayKey())
    const next = button('›', '后一天（→）', () => changeDay(1))
    next.disabled = viewing >= todayKey()
    const back = button('返回', '返回今日任务（Esc）', close)
    toolbar.append(previous, label, next, back)
    box.appendChild(toolbar)
    const animations: Promise<void>[] = []

    const entries = opts.entriesFor(viewing)
    entries.forEach((entry, i) => {
      const row = document.createElement('div')
      row.className = 'task archive-row'
      const circle = document.createElement('span')
      circle.className = 'circle done'
      const text = document.createElement('span')
      text.className = 'text'
      text.textContent = entry.text
      row.append(circle, text)
      box.appendChild(row)

      // 永久裂纹：发丝裂纹 SVG，这行是碎过又拼回来的
      const w0 = row.offsetWidth || 260
      const h0 = row.offsetHeight || 22
      const cracks = crackSVG(crackLines(w0, h0), w0, h0)
      cracks.classList.add('keep')
      row.appendChild(cracks)

      row.tabIndex = 0
      row.setAttribute('role', 'button')
      row.setAttribute('aria-label', `${entry.text}，双击或按回车恢复到今日`)
      row.title = '双击恢复到今日 · 回车也可恢复'
      const restore = async (): Promise<void> => {
        if (animating || closing || restoring.has(entry.id)) return
        restoring.add(entry.id)
        row.setAttribute('aria-disabled', 'true')
        if (!reducedMotion()) {
          cracks.animate([{ opacity: 0.55 }, { opacity: 0 }], { duration: 420, fill: 'forwards' })
          row.animate([{ opacity: 1 }, { opacity: 0.25 }, { opacity: 0 }], { duration: 460, fill: 'forwards' })
          await new Promise<void>((resolve) => setTimeout(resolve, 470))
        }
        try {
          opts.onRestore(entry.id)
          row.remove()
        } finally {
          restoring.delete(entry.id)
          if (restoring.size === 0) {
            if (closeRequested) close()
            else if (!box.querySelector('.archive-row')) renderDay(true)
          }
        }
      }
      row.addEventListener('dblclick', () => { void restore() })
      row.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        void restore()
      })

      if (!flip && i < ANIMATE_ROW_CAP) {
        animations.push(assembleRow(row, i))
      } else if (!reducedMotion()) {
        const animation = row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180 })
        animations.push(Promise.race([
          animation.finished.then(() => undefined, () => undefined),
          new Promise<void>((resolve) => setTimeout(resolve, 350))
        ]))
      }
    })

    if (entries.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'archive-empty'
      empty.textContent = '这一天没有完成的任务'
      box.appendChild(empty)
    }
    void Promise.all(animations).then(() => {
      animating = false
      if (closeRequested) close()
    })
  }

  return { isOpen: () => open_, open, close }
}
