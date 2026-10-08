// 宽度默认原型值、可手动拖拽调整（M14）；高度自适应（ADR-0005）或手动固定。
// 窗口在贴纸四周留透明边距容纳柔和阴影，透明边缘允许鼠标穿透。
export const NOTE_WIDTH = 320
export const NOTE_MIN_WIDTH = 260
export const NOTE_MAX_WIDTH = 720
export const NOTE_MIN_HEIGHT = 280
export const ADAPTIVE_MIN_HEIGHT = 420
export const NOTE_INSET_X = 56
export const NOTE_INSET_Y = 40
export const NOTE_INSET_BOTTOM = 88
/** 悬浮球（App logo）形态的边长 */
export const BALL_SIZE = 56
/** 悬停速记胶囊外宽（232 内容宽 + 14×2 内边距）与离球间隙 */
export const QUICK_PILL_OUTER_WIDTH = 260
export const QUICK_PILL_GAP = 12
/** 球形态窗口在球两侧各留的速记胶囊空间：胶囊悬停换边（ADR/悬浮球 spec），两侧都要容得下 */
export const BALL_INSET_X = QUICK_PILL_OUTER_WIDTH + QUICK_PILL_GAP

/** 形态对应的窗口左右边距：贴纸留阴影空间，球留速记胶囊空间 */
export function insetXForForm(form: 'ball' | 'note'): number {
  return form === 'ball' ? BALL_INSET_X : NOTE_INSET_X
}

/** 形态对应的窗口宽度：球形态 = 球 + 两侧胶囊空间 */
export function windowWidthForForm(form: 'ball' | 'note', noteWidth: number): number {
  return form === 'ball' ? BALL_SIZE + BALL_INSET_X * 2 : windowWidthFor(noteWidth)
}

/** 形态对应的便签尺寸：球形态走固定 56×56，贴纸形态走持久化/默认尺寸 */
export function noteSizeForForm(
  form: 'ball' | 'note',
  noteW: number | null,
  noteH: number | null,
  workAreaHeight: number
): { w: number; h: number } {
  if (form === 'ball') return { w: BALL_SIZE, h: BALL_SIZE }
  return {
    w: clampNoteWidth(typeof noteW === 'number' ? noteW : NOTE_WIDTH),
    h: clampNoteHeight(typeof noteH === 'number' ? noteH : ADAPTIVE_MIN_HEIGHT, workAreaHeight)
  }
}

/** 便签宽度 → 窗口宽度：左右各一份透明边距 */
export function windowWidthFor(noteWidth: number): number {
  return noteWidth + NOTE_INSET_X * 2
}

/** 便签高度 → 窗口高度：上方边距 + 底部更大的阴影空间 */
export function windowHeightFor(noteHeight: number): number {
  return noteHeight + NOTE_INSET_Y + NOTE_INSET_BOTTOM
}

/** 便签宽度夹在手动边界内 */
export function clampNoteWidth(noteWidth: number): number {
  return Math.round(Math.max(NOTE_MIN_WIDTH, Math.min(noteWidth, NOTE_MAX_WIDTH)))
}

/** 当前工作区内容得下的最大便签高（窗口完整落在工作区内） */
export function maxNoteHeightFor(workAreaHeight: number, minHeight: number = NOTE_MIN_HEIGHT): number {
  return Math.max(minHeight, workAreaHeight - NOTE_INSET_Y - NOTE_INSET_BOTTOM)
}

/** 便签高度夹在下限与工作区上限之间（自适应模式的下限更高，由调用方传 min） */
export function clampNoteHeight(
  noteHeight: number,
  workAreaHeight: number,
  minHeight: number = NOTE_MIN_HEIGHT
): number {
  return Math.round(Math.max(minHeight, Math.min(noteHeight, maxNoteHeightFor(workAreaHeight, minHeight))))
}

export function clampNotePosition(x: number, y: number, noteWidth: number, noteHeight: number, area: {
  x: number; y: number; width: number; height: number
}): { x: number; y: number } {
  return {
    x: Math.round(Math.max(area.x, Math.min(x, area.x + Math.max(0, area.width - noteWidth)))),
    y: Math.round(Math.max(area.y, Math.min(y, area.y + Math.max(0, area.height - noteHeight))))
  }
}
