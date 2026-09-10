import type { ArchivedTask } from '@shared/dates'
import { dateKey } from '@shared/dates'
import { crackSVG, voronoiCells } from './shatter'

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
  let viewing = dateKey(new Date())
  const todayKey = (): string => dateKey(new Date())

  const onDocClick = (e: Event): void => {
    if (!open_ || animating) return
    if ((e.target as HTMLElement).closest('.archive')) return
    close()
  }
  const onKey = (e: KeyboardEvent): void => {
    if (!open_ || animating) return
    if (e.key === 'Escape') close()
  }
  const onWheel = (e: WheelEvent): void => {
    if (!open_ || animating) return
    e.preventDefault()
    const delta = e.deltaY < 0 ? -1 : 1 // 上滚 = 更早的日子；下滚 = 回向今天
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
    if (!open_ || animating) return
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
    })
  }

  /** 行碎开消失（退出动画用） */
  function shatterOut(row: HTMLElement): Promise<void> {
    return new Promise((resolve) => {
      const rect = row.getBoundingClientRect()
      const noteRect = note.getBoundingClientRect()
      const cells = voronoiCells(rect.width, rect.height, 10)
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

  /** 碎片从四散飞回合并成行（入场动画，行保持裂纹） */
  function assembleRow(row: HTMLElement, index: number): Promise<void> {
    return new Promise((resolve) => {
      const rect = row.getBoundingClientRect()
      const noteRect = note.getBoundingClientRect()
      const cells = voronoiCells(rect.width, rect.height, 12)
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
        const dx = (Math.random() - 0.5) * 120
        const dy = -(10 + Math.random() * 70)
        const rot = (Math.random() - 0.5) * 70
        shard.animate(
          [
            { transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg)`, opacity: 0 },
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
          if (++done >= cells.length) {
            stage.remove()
            resolve()
          }
        }
        stage.appendChild(shard)
      }
      row.style.opacity = '0' // 动画期间由碎片代言，结束后亮出真身
      note.appendChild(stage)
      setTimeout(() => {
        row.style.opacity = ''
        stage.remove()
        resolve()
      }, 1100 + index * 26)
    })
  }

  function renderDay(flip: boolean): void {
    const box = container
    if (!box) return
    box.innerHTML = ''
    animating = true

    const label = document.createElement('div')
    label.className = 'archive-date'
    label.textContent = dayLabel(viewing, todayKey())
    box.appendChild(label)

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

      // 永久裂纹：这行是碎过又拼回来的
      const cracks = crackSVG(voronoiCells(row.offsetWidth || 260, row.offsetHeight || 22, 10), row.offsetWidth || 260, row.offsetHeight || 22)
      cracks.classList.add('keep')
      row.appendChild(cracks)

      row.addEventListener('dblclick', () => {
        if (animating) return
        // 修复：裂纹淡出 → 愈合 → 回到今日任务区
        cracks.animate([{ opacity: 0.55 }, { opacity: 0 }], { duration: 420, fill: 'forwards' })
        row.animate([{ opacity: 1 }, { opacity: 0.25 }, { opacity: 1 }], { duration: 460 })
        setTimeout(() => opts.onRestore(entry.id), 430)
        setTimeout(() => {
          row.style.transition = 'opacity .3s'
          row.style.opacity = '0'
          setTimeout(() => row.remove(), 320)
        }, 440)
      })

      if (!flip && i < ANIMATE_ROW_CAP) {
        void assembleRow(row, i).then(() => {
          if (i === Math.min(entries.length, ANIMATE_ROW_CAP) - 1) animating = false
        })
      } else {
        row.classList.add('flip-in')
      }
    })

    if (entries.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'archive-empty'
      empty.textContent = '这一天没有完成的任务'
      box.appendChild(empty)
    }
    if (flip || entries.length === 0) animating = false
  }

  return { isOpen: () => open_, open, close }
}
