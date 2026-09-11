import { NOTE_INSET_X, NOTE_INSET_Y } from '@shared/window'
import type { WallpaperImage } from '@shared/glass'

// 毛玻璃层（ADR-0003）：壁纸整图一次性预模糊成贴图，拖动只平移 background-position，
// 零实时计算。双层交叉淡入处理壁纸更换；采样失败降级纯半透明。

const note = document.getElementById('note') as HTMLElement

const BLUR_PX = 26 // 对齐设计 token --glass-filter 的模糊强度

let screenW = 0
let screenH = 0
let originX = 0
let originY = 0
let curWx = 0
let curWy = 0
let layerA: HTMLDivElement
let layerB: HTMLDivElement
let active: HTMLDivElement
let posRaf = 0
let sampleVersion = 0

export async function initGlass(): Promise<void> {
  let info
  try {
    info = await window.qink.glassInfo()
  } catch {
    note.classList.add('glass-fallback')
    return
  }
  if (info.win11) {
    document.body.classList.add('acrylic-mode')
    return
  }
  screenW = info.screenW
  screenH = info.screenH
  originX = info.originX
  originY = info.originY

  layerA = document.createElement('div')
  layerB = document.createElement('div')
  for (const l of [layerA, layerB]) {
    l.className = 'glass'
    note.prepend(l)
  }
  active = layerA

  window.qink.onWinPos((x, y) => {
    curWx = x
    curWy = y
    // 按帧合批：一次拖动风暴只触发一次样式写入
    if (posRaf) return
    posRaf = requestAnimationFrame(() => {
      posRaf = 0
      applyPos()
    })
  })
  window.qink.onWallpaperChanged((w) => void sample(w))

  curWx = info.winX
  curWy = info.winY
  await sample(info)
  applyPos()
}

function applyPos(): void {
  const x = originX - curWx - NOTE_INSET_X
  const y = originY - curWy - NOTE_INSET_Y
  const pos = `${x}px ${y}px`
  if (layerA) layerA.style.backgroundPosition = pos
  if (layerB) layerB.style.backgroundPosition = pos
}

async function sample(w: WallpaperImage): Promise<void> {
  const version = ++sampleVersion
  if (!w.b64) {
    note.classList.add('glass-fallback')
    window.qink.glassReport({ ok: false })
    return
  }
  const t0 = performance.now()
  try {
    const img = await loadImage(`data:${w.mime};base64,${w.b64}`)

    if (version !== sampleVersion) return
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(screenW))
    canvas.height = Math.max(1, Math.round(screenH))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    const scale = Math.max(canvas.width / img.width, canvas.height / img.height)
    const dw = img.width * scale
    const dh = img.height * scale
    // 先按原比例铺满屏幕，再把边缘像素延展后模糊，防止屏幕边缘出现黑带。
    const source = document.createElement('canvas')
    source.width = canvas.width
    source.height = canvas.height
    const sourceCtx = source.getContext('2d')!
    sourceCtx.drawImage(img, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh)
    const pad = BLUR_PX * 3
    const padded = document.createElement('canvas')
    padded.width = canvas.width + pad * 2
    padded.height = canvas.height + pad * 2
    const pctx = padded.getContext('2d')!
    const xs = [[0, 1, 0, pad], [0, canvas.width, pad, canvas.width], [canvas.width - 1, 1, pad + canvas.width, pad]]
    const ys = [[0, 1, 0, pad], [0, canvas.height, pad, canvas.height], [canvas.height - 1, 1, pad + canvas.height, pad]]
    for (const [sx, sw, dx, width] of xs) {
      for (const [sy, sh, dy, height] of ys) pctx.drawImage(source, sx, sy, sw, sh, dx, dy, width, height)
    }
    ctx.filter = `blur(${BLUR_PX}px)`
    ctx.drawImage(padded, -pad, -pad)
    const url = canvas.toDataURL('image/png')

    const next = active === layerA ? layerB : layerA
    next.style.backgroundImage = `url("${url}")`
    next.style.backgroundSize = `${canvas.width}px ${canvas.height}px`
    next.style.backgroundPosition = `${originX - curWx - NOTE_INSET_X}px ${originY - curWy - NOTE_INSET_Y}px`
    next.style.opacity = '1'
    active.style.opacity = '0'
    active = next
    note.classList.remove('glass-fallback')

    window.qink.glassReport({ ok: true, ms: Math.round(performance.now() - t0), bytes: url.length })
  } catch {
    if (version !== sampleVersion) return
    note.classList.add('glass-fallback')
    window.qink.glassReport({ ok: false })
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('wallpaper decode failed'))
    img.src = src
  })
}
