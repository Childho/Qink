import { describe, expect, it } from 'vitest'
import {
  ADAPTIVE_MIN_HEIGHT,
  BALL_INSET_X,
  BALL_SIZE,
  clampNoteHeight,
  clampNotePosition,
  clampNoteWidth,
  dragDeltaRange,
  fitNoteWidth,
  insetXForForm,
  maxNoteHeightFor,
  NOTE_INSET_BOTTOM,
  NOTE_INSET_X,
  NOTE_INSET_Y,
  NOTE_MAX_WIDTH,
  NOTE_MIN_HEIGHT,
  NOTE_MIN_WIDTH,
  NOTE_WIDTH,
  noteSizeForForm,
  placeContextMenu,
  QUICK_PILL_GAP,
  QUICK_PILL_OUTER_WIDTH,
  windowHeightFor,
  windowWidthFor,
  windowWidthForForm
} from '../src/shared/window'

describe('贴纸尺寸与阴影空间', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 }
  it('默认尺寸保持原型，边界齐全', () => {
    expect(NOTE_WIDTH).toBe(320)
    expect(ADAPTIVE_MIN_HEIGHT).toBe(420)
    expect(NOTE_MIN_WIDTH).toBeLessThan(NOTE_WIDTH)
    expect(NOTE_MAX_WIDTH).toBeGreaterThan(NOTE_WIDTH)
    expect(NOTE_MIN_HEIGHT).toBeLessThan(ADAPTIVE_MIN_HEIGHT)
    expect(windowWidthFor(NOTE_WIDTH)).toBeGreaterThan(NOTE_WIDTH)
    expect(windowHeightFor(ADAPTIVE_MIN_HEIGHT)).toBeGreaterThan(ADAPTIVE_MIN_HEIGHT)
  })
  it('窗口尺寸与便签尺寸一比一换算，四周留阴影空间', () => {
    expect(windowWidthFor(500) - windowWidthFor(320)).toBe(180)
    expect(windowHeightFor(600) - windowHeightFor(420)).toBe(180)
    expect(windowHeightFor(420)).toBe(420 + NOTE_INSET_Y + NOTE_INSET_BOTTOM)
  })
  it('宽度夹在手动边界内', () => {
    expect(clampNoteWidth(100)).toBe(NOTE_MIN_WIDTH)
    expect(clampNoteWidth(500)).toBe(500)
    expect(clampNoteWidth(9999)).toBe(NOTE_MAX_WIDTH)
  })
  it('高度夹在下限与工作区上限之间，下限可按模式收紧', () => {
    expect(clampNoteHeight(100, 1040)).toBe(NOTE_MIN_HEIGHT)
    expect(clampNoteHeight(500, 1040)).toBe(500)
    expect(clampNoteHeight(200, 1040, ADAPTIVE_MIN_HEIGHT)).toBe(ADAPTIVE_MIN_HEIGHT)
    expect(clampNoteHeight(5000, 1040)).toBe(1040 - NOTE_INSET_Y - NOTE_INSET_BOTTOM)
  })
  it('工作区放不下时上限退回下限，位置越界交给 clampNotePosition 兜底', () => {
    expect(maxNoteHeightFor(300)).toBe(NOTE_MIN_HEIGHT)
    expect(clampNoteHeight(420, 300)).toBe(NOTE_MIN_HEIGHT)
  })
  it('贴纸内容完整留在桌面工作区，底部不再只露出200像素', () => {
    expect(clampNotePosition(1900, 1000, 500, 400, area)).toEqual({ x: 1420, y: 640 })
    expect(clampNotePosition(-60, -40, 320, 500, area)).toEqual({ x: 0, y: 0 })
  })
  it('支持非零屏幕原点及小于贴纸的工作区', () => {
    expect(clampNotePosition(-2000, 900, 320, 420, { x: -1920, y: 20, width: 1920, height: 1040 }))
      .toEqual({ x: -1920, y: 640 })
    expect(clampNotePosition(50, 50, 320, 420, { x: 0, y: 0, width: 300, height: 400 }))
      .toEqual({ x: 0, y: 0 })
  })
})

describe('悬浮球窗口与速记胶囊空间', () => {
  it('球形态窗口两侧各留一份胶囊空间，速记胶囊完整落在窗内', () => {
    expect(QUICK_PILL_OUTER_WIDTH).toBe(260)
    expect(BALL_INSET_X).toBe(QUICK_PILL_OUTER_WIDTH + QUICK_PILL_GAP)
    expect(windowWidthForForm('ball', 0)).toBe(BALL_SIZE + BALL_INSET_X * 2)
    expect(insetXForForm('ball')).toBe(BALL_INSET_X)
  })
  it('贴纸形态沿用阴影边距，与球形态互不影响', () => {
    expect(windowWidthForForm('note', 320)).toBe(windowWidthFor(320))
    expect(insetXForForm('note')).toBe(NOTE_INSET_X)
  })
})

describe('右键菜单的屏幕与窗口边界', () => {
  const area = { x: 0, y: 0, width: 960, height: 800 }
  const menu = { width: 142, height: 224 }

  it('悬浮球靠近屏幕顶部时向下扩窗，球仍留在原位', () => {
    const bounds = { x: 180, y: -40, width: 600, height: 184 }
    const placed = placeContextMenu(bounds, area, { x: 300, y: 68 }, menu)
    expect(placed.y).toBe(-40)
    expect(placed.dockShiftY).toBe(0)
    expect(placed.top + menu.height).toBeLessThanOrEqual(placed.height)
    expect(placed.y + placed.top + menu.height).toBeLessThanOrEqual(area.height)
  })

  it('悬浮球靠近屏幕底部时向上扩窗，菜单和球都不跳位', () => {
    const bounds = { x: 180, y: 704, width: 600, height: 184 }
    const placed = placeContextMenu(bounds, area, { x: 300, y: 68 }, menu)
    expect(placed.y).toBeLessThan(bounds.y)
    expect(placed.y + placed.dockShiftY + NOTE_INSET_Y).toBe(bounds.y + NOTE_INSET_Y)
    expect(placed.top).toBeGreaterThanOrEqual(0)
    expect(placed.y + placed.top + menu.height).toBeLessThanOrEqual(area.height)
  })

  it('贴纸右键菜单贴近屏幕边缘时仍落在桌面内', () => {
    const bounds = { x: -56, y: -40, width: 432, height: 408 }
    const placed = placeContextMenu(bounds, area, { x: 70, y: 50 }, menu)
    expect(placed.left).toBeGreaterThanOrEqual(0)
    expect(bounds.x + placed.left).toBeGreaterThanOrEqual(area.x)
    expect(placed.dockShiftY).toBe(0)
  })
})

describe('惯性投掷边界', () => {
  it('球能抵达工作区右边与底边，透明边距不重复扣除', () => {
    const area = { x: 0, y: 0, width: 960, height: 800 }
    const anchor = { x: 100, y: 100 }
    const range = dragDeltaRange(anchor, { width: BALL_SIZE, height: BALL_SIZE }, BALL_INSET_X, area)
    expect(anchor.x + range.maxX + BALL_INSET_X + BALL_SIZE).toBe(area.width)
    expect(anchor.y + range.maxY + NOTE_INSET_Y + BALL_SIZE).toBe(area.height)
  })
})

describe('屏幕变窄时的贴纸宽度', () => {
  it('只收窄当前显示宽度，回到宽屏后恢复原偏好', () => {
    expect(fitNoteWidth(720, 640)).toBe(640)
    expect(fitNoteWidth(720, 1920)).toBe(720)
    expect(noteSizeForForm('note', 720, null, 800, 640).w).toBe(640)
    expect(noteSizeForForm('ball', 720, null, 800, 640).w).toBe(BALL_SIZE)
  })
})
