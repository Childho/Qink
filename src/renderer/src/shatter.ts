import { Delaunay } from 'd3-delaunay'

// 碎裂与修复：Voronoi 不规则碎片 + DOM 克隆裁切（像素级保真，无需抓图）。
// 完成任务 = 整行碎裂飞散；修复 = 裂纹淡出愈合。碎片几何同时供 M7 已完成清单复用。

export function voronoiCells(w: number, h: number, count: number): number[][][] {
  // 四角锚点保证细胞覆盖整个矩形
  const pts: [number, number][] = [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h]
  ]
  for (let i = 0; i < count; i++) {
    pts.push([Math.random() * w, Math.random() * h])
  }
  const delaunay = Delaunay.from(pts)
  const voronoi = delaunay.voronoi([0, 0, w, h])
  const cells: number[][][] = []
  for (let i = 0; i < pts.length; i++) {
    const poly = voronoi.cellPolygon(i)
    if (poly) cells.push(poly.map((p) => [p[0], p[1]]))
  }
  return cells
}

/** 任务行碎裂飞散，Promise 在碎片全部落地后完成（带 900ms 兜底，防隐藏窗口动画暂停） */
export function shatterRow(note: HTMLElement, row: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    const rect = row.getBoundingClientRect()
    const noteRect = note.getBoundingClientRect()
    const cells = voronoiCells(rect.width, rect.height, 16)

    const stage = document.createElement('div')
    stage.className = 'shatter-stage'
    stage.style.left = `${rect.left - noteRect.left}px`
    stage.style.top = `${rect.top - noteRect.top}px`
    stage.style.width = `${rect.width}px`
    stage.style.height = `${rect.height}px`

    const cx = rect.width / 2
    const cy = rect.height / 2
    let done = 0
    const total = cells.length
    const settle = (): void => {
      done++
      if (done >= total) {
        stage.remove()
        resolve()
      }
    }

    for (const poly of cells) {
      const shard = document.createElement('div')
      shard.className = 'shard'
      shard.style.clipPath = `polygon(${poly.map((p) => `${p[0]}px ${p[1]}px`).join(', ')})`

      const clone = row.cloneNode(true) as HTMLElement
      clone.classList.remove('completing')
      clone.style.position = 'absolute'
      clone.style.inset = '0'
      shard.appendChild(clone)

      // 飞散方向 = 从行中心向外 + 重力下坠偏置
      let mx = 0
      let my = 0
      for (const p of poly) {
        mx += p[0]
        my += p[1]
      }
      mx /= poly.length
      my /= poly.length
      const ang = Math.atan2(my - cy, mx - cx)
      const dist = 26 + Math.random() * 46
      const dx = Math.cos(ang) * dist
      const dy = Math.sin(ang) * dist + 22 + Math.random() * 30
      const rot = (Math.random() - 0.5) * 56

      shard.animate(
        [
          { transform: 'none', opacity: 1 },
          { transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg)`, opacity: 0 }
        ],
        { duration: 380 + Math.random() * 180, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' }
      ).onfinish = () => {
        shard.remove()
        settle()
      }
      stage.appendChild(shard)
    }

    row.style.visibility = 'hidden'
    note.appendChild(stage)

    // 兜底：窗口隐藏时 WAAPI 可能不触发 onfinish
    setTimeout(() => {
      if (done < total) {
        stage.remove()
        resolve()
      }
    }, 900)
  })
}

/** 裂纹 SVG：把 Voronoi 细胞边界画成裂纹线（已完成清单里"仍是裂的"视觉） */
export function crackSVG(cells: number[][][], w: number, h: number): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
  svg.classList.add('cracks')
  for (const poly of cells) {
    const pts = poly.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
    polyline.setAttribute('points', pts)
    polyline.setAttribute('fill', 'none')
    polyline.setAttribute('stroke', 'rgba(60, 60, 67, 0.45)')
    polyline.setAttribute('stroke-width', '1')
    svg.appendChild(polyline)
  }
  return svg
}

/** 修复愈合：裂纹覆盖淡出 */
export function healRow(row: HTMLElement): void {
  const w = row.offsetWidth
  const h = row.offsetHeight
  if (w === 0 || h === 0) return
  const svg = crackSVG(voronoiCells(w, h, 12), w, h)
  svg.style.position = 'absolute'
  svg.style.inset = '0'
  svg.style.pointerEvents = 'none'
  row.style.position = 'relative'
  row.appendChild(svg)
  svg
    .animate([{ opacity: 0.9 }, { opacity: 0 }], { duration: 620, easing: 'ease-out', fill: 'forwards' })
    .onfinish = () => svg.remove()
}
