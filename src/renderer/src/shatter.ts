// 碎裂与修复：撞击点放射蛛网几何（UI 重构：替代 Voronoi 的「瓷砖感」）。
// 撞击点 + 不规则放射线 + 同心环顶点构成蛛网，每格再裁剪到行矩形内；
// 共享顶点按（射线, 环）缓存，保证相邻碎片边缘严丝合缝。
// DOM 克隆裁切，像素级保真，无需抓图。碎片几何同时供已完成清单复用。

export type Pt = [number, number]

/** 一次碎裂的碎片集合 + 撞击点 */
export interface GlassCells {
  cells: Pt[][]
  impact: Pt
}

/** 永久裂纹图案：发丝裂纹线段 + 撞击点 */
export interface CrackPattern {
  strokes: { seg: [Pt, Pt]; width: number }[]
  impact: Pt
}

/* ---------- 多边形 / 线段对矩形的裁剪 ---------- */

interface Plane {
  axis: 0 | 1
  at: number
  inside(p: Pt): boolean
}

/** Sutherland–Hodgman 多边形裁剪：只保留落在矩形内的部分 */
export function clipPoly(poly: Pt[], w: number, h: number): Pt[] | null {
  const planes: Plane[] = [
    { axis: 0, at: 0, inside: (p) => p[0] >= 0 },
    { axis: 0, at: w, inside: (p) => p[0] <= w },
    { axis: 1, at: 0, inside: (p) => p[1] >= 0 },
    { axis: 1, at: h, inside: (p) => p[1] <= h }
  ]
  let out = poly
  for (const pl of planes) {
    const input = out
    out = []
    for (let i = 0; i < input.length; i++) {
      const cur = input[i]
      const prev = input[(i + input.length - 1) % input.length]
      const curIn = pl.inside(cur)
      const prevIn = pl.inside(prev)
      if (curIn) {
        if (!prevIn) out.push(planeHit(prev, cur, pl))
        out.push(cur)
      } else if (prevIn) {
        out.push(planeHit(prev, cur, pl))
      }
    }
    if (out.length === 0) break
  }
  return out.length >= 3 ? out : null
}

function planeHit(a: Pt, b: Pt, pl: Plane): Pt {
  const t = (pl.at - a[pl.axis]) / (b[pl.axis] - a[pl.axis])
  if (pl.axis === 0) return [pl.at, a[1] + (b[1] - a[1]) * t]
  return [a[0] + (b[0] - a[0]) * t, pl.at]
}

/** 线段裁剪（Liang–Barsky）：只保留落在矩形内的部分，裂纹线才不会画出格子外 */
export function clipSeg(a: Pt, b: Pt, w: number, h: number): [Pt, Pt] | null {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  let t0 = 0
  let t1 = 1
  const p = [-dx, dx, -dy, dy]
  const q = [a[0], w - a[0], a[1], h - a[1]]
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null
    } else {
      const t = q[i] / p[i]
      if (p[i] < 0) {
        if (t > t1) return null
        if (t > t0) t0 = t
      } else {
        if (t < t0) return null
        if (t < t1) t1 = t
      }
    }
  }
  return [
    [a[0] + dx * t0, a[1] + dy * t0],
    [a[0] + dx * t1, a[1] + dy * t1]
  ]
}

/* ---------- 蛛网几何 ---------- */

/** 撞击点 + 放射线 + 椭圆化同心环 → 裁剪到矩形的碎片集合 */
export function glassCells(w: number, h: number, rays = 9, rings = 2): GlassCells {
  const impact: Pt = [w * (0.3 + Math.random() * 0.4), h * (0.3 + Math.random() * 0.4)]
  const angs: number[] = []
  for (let i = 0; i < rays; i++) angs.push(((i + (Math.random() - 0.5) * 0.7) / rays) * Math.PI * 2)
  // 环半径椭圆化：横向按行宽比例扇开、纵向压在行高附近——整张「撞击星」
  // 落在扁行内部，放射线与环弧在行内交叉，玻璃裂纹才读得出来
  const RX: number[] = []
  const RY: number[] = []
  for (let k = 1; k <= rings; k++) {
    RX.push(w * (0.2 + 0.18 * k) * (0.85 + Math.random() * 0.3))
    RY.push(h * (0.5 + 0.4 * k) * (0.85 + Math.random() * 0.3))
  }
  const RXo = w * 1.5 // 最外环罩住整行，保证细胞并集覆盖矩形
  const RYo = h * 2.5
  const cache = new Map<string, Pt>()
  const V = (i: number, k: number): Pt => {
    if (k === 0) return impact
    const key = i + ':' + k
    const hit = cache.get(key)
    if (hit) return hit
    const a = angs[((i % rays) + rays) % rays]
    const rx = k <= RX.length ? RX[k - 1] : RXo
    const ry = k <= RY.length ? RY[k - 1] : RYo
    const j = 0.9 + Math.random() * 0.2
    const pt: Pt = [impact[0] + Math.cos(a) * rx * j, impact[1] + Math.sin(a) * ry * j]
    cache.set(key, pt)
    return pt
  }
  const cells: Pt[][] = []
  const push = (poly: Pt[]): void => {
    const c = clipPoly(poly, w, h)
    if (c) cells.push(c)
  }
  for (let i = 0; i < rays; i++) {
    push([V(i, 0), V(i + 1, 1), V(i, 1)]) // 撞击点三角：最贴近撞点的细碎屑
    for (let k = 1; k < rings; k++) push([V(i, k), V(i + 1, k), V(i + 1, k + 1), V(i, k + 1)])
    push([V(i, rings), V(i + 1, rings), V(i + 1, rings + 1), V(i, rings + 1)])
  }
  return { cells, impact }
}

/** 静态裂纹：层级化「发丝裂纹」——一条贯穿主裂纹 + 斜出分支 + 撞击点。
 *  22px 高的扁行装不下完整蛛网（细线一多就读成乱线），少而有力才对。 */
export function crackLines(w: number, h: number): CrackPattern {
  const cy = h * (0.35 + Math.random() * 0.3)
  const strokes: { pts: Pt[]; width: number }[] = []
  // 主裂纹：贯穿行宽，笔触沿长度变细（应力衰减）
  const segs = 3 + Math.floor(Math.random() * 2)
  const main: Pt[] = [[-2, cy + (Math.random() - 0.5) * 2]]
  for (let i = 1; i <= segs; i++) {
    main.push([((w + 4) / segs) * i - 2, cy + (Math.random() - 0.5) * h * 0.45])
  }
  for (let i = 0; i < main.length - 1; i++) {
    strokes.push({ pts: [main[i], main[i + 1]], width: 1.2 - (0.3 * i) / (main.length - 1) })
  }
  // 分支裂纹：上下交替、长短不一；约 1/3 的分支在中点再斜出二级小分叉
  const n = 5 + Math.floor(Math.random() * 3)
  for (let i = 0; i < n; i++) {
    const bx = w * (0.12 + Math.random() * 0.76)
    const by = cy + (Math.random() - 0.5) * 2
    const len = h * (0.4 + Math.random() * 1.0) * (i % 2 === 0 ? -1 : 1)
    const tip: Pt = [bx + (Math.random() - 0.5) * h * 1.2, cy + len]
    strokes.push({ pts: [[bx, by], tip], width: 0.9 })
    if (Math.random() < 0.34) {
      const mid: Pt = [(bx + tip[0]) / 2, (by + tip[1]) / 2]
      strokes.push({
        pts: [
          mid,
          [
            mid[0] + (Math.random() - 0.5) * h * 0.9,
            mid[1] + (len > 0 ? 1 : -1) * h * (0.3 + Math.random() * 0.35)
          ]
        ],
        width: 0.7
      })
    }
  }
  // 逐段裁剪到行内
  const out: CrackPattern['strokes'] = []
  for (const st of strokes) {
    for (let i = 0; i < st.pts.length - 1; i++) {
      const seg = clipSeg(st.pts[i], st.pts[i + 1], w, h)
      if (seg) out.push({ seg, width: st.width })
    }
  }
  return { strokes: out, impact: [w * (0.3 + Math.random() * 0.4), cy] }
}

/** 裂纹 SVG：把 CrackPattern 画成裂纹线 + 撞击点（已完成清单里「仍是裂的」视觉） */
export function crackSVG(glass: CrackPattern, w: number, h: number): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
  svg.classList.add('cracks')
  for (const st of glass.strokes) {
    const pts = st.seg.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
    polyline.setAttribute('points', pts)
    polyline.setAttribute('fill', 'none')
    polyline.setAttribute('stroke', 'rgba(50, 50, 55, 0.65)')
    polyline.setAttribute('stroke-width', String(st.width))
    svg.appendChild(polyline)
  }
  // 撞击点：碎裂 epicenter
  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
  dot.setAttribute('cx', glass.impact[0].toFixed(1))
  dot.setAttribute('cy', glass.impact[1].toFixed(1))
  dot.setAttribute('r', '2')
  dot.setAttribute('fill', 'rgba(45, 45, 50, 0.55)')
  svg.appendChild(dot)
  return svg
}

/** 任务行碎裂飞散，Promise 在碎片全部落地后完成（带 900ms 兜底，防隐藏窗口动画暂停） */
export function shatterRow(note: HTMLElement, row: HTMLElement): Promise<void> {
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

    let done = 0
    const settle = (): void => {
      done++
      if (done >= cells.length) {
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

      // 沿「离开撞击点」的方向飞出：越贴近撞点受力越大飞得越急，旋转也越狠
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
      const dx = Math.cos(ang) * dist
      const dy = Math.sin(ang) * dist + 20 + Math.random() * 28
      const rot = (Math.random() - 0.5) * Math.min(90, 22 + 700 / (24 + d))

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
      if (done < cells.length) {
        stage.remove()
        resolve()
      }
    }, 900)
  })
}
