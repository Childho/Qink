import { describe, expect, it } from 'vitest'
import { clampNotePosition, NOTE_HEIGHT, NOTE_WIDTH, WINDOW_HEIGHT, WINDOW_WIDTH } from '../src/shared/window'

describe('贴纸边界与阴影空间', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 }
  it('保持原型尺寸并给外投影留空间', () => {
    expect([NOTE_WIDTH, NOTE_HEIGHT]).toEqual([320, 540])
    expect(WINDOW_WIDTH).toBeGreaterThan(NOTE_WIDTH)
    expect(WINDOW_HEIGHT).toBeGreaterThan(NOTE_HEIGHT)
  })
  it('贴纸内容完整留在桌面工作区，底部不再只露出200像素', () => {
    expect(clampNotePosition(1900, 1000, area)).toEqual({ x: 1600, y: 500 })
    expect(clampNotePosition(-60, -40, area)).toEqual({ x: 0, y: 0 })
  })
  it('支持非零屏幕原点及小于贴纸的工作区', () => {
    expect(clampNotePosition(-2000, 900, { x: -1920, y: 20, width: 1920, height: 1040 }))
      .toEqual({ x: -1920, y: 520 })
    expect(clampNotePosition(50, 50, { x: 0, y: 0, width: 300, height: 400 }))
      .toEqual({ x: 0, y: 0 })
  })
})
