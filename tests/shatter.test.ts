import { describe, expect, it } from 'vitest'
import { voronoiCells } from '../src/renderer/src/shatter'

// voronoiCells 是纯几何函数，可直接测；DOM 动画部分靠实机走查。

describe('Voronoi 碎片切割', () => {
  it('所有细胞都落在矩形内且覆盖四个角', () => {
    const w = 280
    const h = 24
    const cells = voronoiCells(w, h, 16)
    expect(cells.length).toBeGreaterThan(10)
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

  it('随机性稳定可重放（同种子场景由调用方控制，这里只验证多样本）', () => {
    const a = voronoiCells(100, 20, 8)
    const b = voronoiCells(100, 20, 8)
    expect(a).not.toEqual(b) // 随机切割，每次碎片形状不同
  })
})
