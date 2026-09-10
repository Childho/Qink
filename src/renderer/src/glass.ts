import type { WallpaperImage } from '@shared/glass'

// 毛玻璃层（ADR-0003）：壁纸整图一次性预模糊成贴图，拖动只平移 background-position，
// 零实时计算。双层交叉淡入处理壁纸更换；采样失败降级纯半透明。

const note = document.getElementById('note') as HTMLElement

const BLUR_PX = 28
const EDGE_SCALE = 1.04 // 略放大绘制，避免模糊把图像边缘吃出透明

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

export async function initGlass(): Promise<void> {
  const info = await window.qink.glassInfo()
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
  const x = originX - curWx
  const y = originY - curWy
  const pos = `${x}px ${y}px`
  if (layerA) layerA.style.backgroundPosition = pos
  if (layerB) layerB.style.backgroundPosition = pos
}

async function sample(w: WallpaperImage): Promise<void> {
  if (!w.b64) {
    note.classList.add('glass-fallback')
    window.qink.glassReport({ ok: false })
    return
  }
  const t0 = performance.now()
  try {
    const img = await loadImage(`data:${w.mime};base64,${w.b64}`)

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(screenW))
    canvas.height = Math.max(1, Math.round(screenH))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    ctx.filter = `blur(${BLUR_PX}px)`
    const dw = canvas.width * EDGE_SCALE
    const dh = canvas.height * EDGE_SCALE
    ctx.drawImage(img, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh)

    const url = canvas.toDataURL('image/jpeg', 0.82)

    const next = active === layerA ? layerB : layerA
    next.style.backgroundImage = `url("${url}")`
    next.style.backgroundSize = `${canvas.width}px ${canvas.height}px`
    next.style.backgroundPosition = `${originX - curWx}px ${originY - curWy}px`
    next.style.opacity = '1'
    active.style.opacity = '0'
    active = next
    note.classList.remove('glass-fallback')

    window.qink.glassReport({ ok: true, ms: Math.round(performance.now() - t0), bytes: url.length })
  } catch {
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
