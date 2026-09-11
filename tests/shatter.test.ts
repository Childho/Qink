import { describe, expect, it } from 'vitest'
import { clipSeg, crackLines, glassCells } from '../src/renderer/src/shatter'

// glassCells / crackLines / clipSeg 是纯几何函数，可直接测；DOM 动画部分靠实机走查。

/** 鞋带公式：多边形有向面积 */
function polyArea(poly: [number, number][]): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i]
    const [x2, y2] = poly[(i + 1) % poly.length]
    s += x1 * y2 - x2 * y1
  }
  return Math.abs(s) / 2
}

describe('蛛网碎裂几何（glassCells）', () => {
  it('所有碎片都落在矩形内且撞击点在矩形内', () => {
    const w = 280
    const h = 24
    const { cells, impact } = glassCells(w, h, 16, 2)
    expect(cells.length).toBeGreaterThan(10)
    expect(impact[0]).toBeGreaterThanOrEqual(0)
    expect(impact[0]).toBeLessThanOrEqual(w)
    expect(impact[1]).toBeGreaterThanOrEqual(0)
    expect(impact[1]).toBeLessThanOrEqual(h)
    for (const poly of cells) {
      expect(poly.length).toBeGreaterThan(2)
      for (const [x, y] of poly) {
        expect(x).toBeGreaterThanOrEqual(-0.01)
        expect(x).toBeLessThanOrEqual(w + 0.01)
        expect(y).toBeGreaterThanOrEqual(-0.01)
        expect(y).toBeLessThanOrEqual(h + 0.01)
      }
    }
  })

  it('碎片近似铺满矩形且互不重叠', () => {
    for (const [w, h] of [
      [280, 24],
      [100, 20],
      [60, 60]
    ]) {
      const { cells } = glassCells(w, h, 9, 2)
      const sum = cells.reduce((acc, poly) => acc + polyArea(poly), 0)
      // 两种固有退化（原型即如此，动画均不可见）：外环弦线掠角留 <0.5% 发丝缝；
      // 环半径逐点抖动偶尔内翻成蝶形四边形，产生 ~0.003% 面积自交。两边都卡死。
      expect(sum).toBeGreaterThanOrEqual(w * h * 0.99)
      expect(sum).toBeLessThanOrEqual(w * h * 1.002)
    }
  })

  it('随机性：两次切割碎片形状不同', () => {
    const a = glassCells(100, 20, 8)
    const b = glassCells(100, 20, 8)
    expect(a.cells).not.toEqual(b.cells)
  })
})

describe('发丝裂纹（crackLines）', () => {
  it('所有线段端点都裁剪在矩形内', () => {
    const w = 260
    const h = 22
    const { strokes, impact } = crackLines(w, h)
    expect(strokes.length).toBeGreaterThan(0)
    expect(impact[0]).toBeGreaterThanOrEqual(0)
    expect(impact[0]).toBeLessThanOrEqual(w)
    for (const { seg } of strokes) {
      for (const [x, y] of seg) {
        expect(x).toBeGreaterThanOrEqual(-0.01)
        expect(x).toBeLessThanOrEqual(w + 0.01)
        expect(y).toBeGreaterThanOrEqual(-0.01)
        expect(y).toBeLessThanOrEqual(h + 0.01)
      }
    }
  })
})

describe('线段裁剪（clipSeg）', () => {
  it('相交线段被裁到矩形内，在外侧的返回 null', () => {
    const clipped = clipSeg([-10, 5], [50, 5], 40, 20)
    expect(clipped).not.toBeNull()
    expect(clipped![0][0]).toBeCloseTo(0)
    expect(clipped![1][0]).toBeCloseTo(40)
    expect(clipSeg([-10, 5], [-5, 5], 40, 20)).toBeNull()
  })
})
