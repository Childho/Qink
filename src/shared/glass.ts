// 玻璃层的共享类型（main 组装、renderer 消费）

export interface WallpaperImage {
  b64: string | null
  mime: string
}

export interface GlassInfo extends WallpaperImage {
  /** Windows 11 22H2+：官方 backgroundMaterial 可用，渲染层不建采样贴图 */
  win11: boolean
  /** 主显示器 DIP 尺寸与原点（贴图铺满主屏，偏移按窗口位置算） */
  screenW: number
  screenH: number
  originX: number
  originY: number
  winX: number
  winY: number
}
