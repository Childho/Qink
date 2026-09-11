// 贴纸保持原型尺寸；窗口额外容纳柔和阴影，透明边缘允许鼠标穿透。
export const NOTE_WIDTH = 320
export const NOTE_HEIGHT = 540
export const NOTE_INSET_X = 56
export const NOTE_INSET_Y = 40
export const WINDOW_WIDTH = NOTE_WIDTH + NOTE_INSET_X * 2
export const WINDOW_HEIGHT = NOTE_HEIGHT + NOTE_INSET_Y + 88

export function clampNotePosition(x: number, y: number, area: {
  x: number; y: number; width: number; height: number
}): { x: number; y: number } {
  return {
    x: Math.round(Math.max(area.x, Math.min(x, area.x + Math.max(0, area.width - NOTE_WIDTH)))),
    y: Math.round(Math.max(area.y, Math.min(y, area.y + Math.max(0, area.height - NOTE_HEIGHT))))
  }
}
