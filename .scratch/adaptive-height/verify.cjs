// 尺寸系统验证（M13 自适应 + M14 边缘拖拽/双击重置）：
// 真实 preload 构建 + dev 服务器渲染层 + 内存种子数据，不读取或修改用户任务
//（沿用 .scratch/ui-restore/verify.cjs 的隔离方式）。
// 用法：项目根目录下 npx electron .scratch/adaptive-height/verify.cjs（需 dev 服务器在 5173 运行）
const { app, BrowserWindow, ipcMain, screen } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

// 与 src/shared/window.ts 一致（纯常量，单测已覆盖，此处仅为装配）
const INSET_X = 56
const INSET_Y = 40
const INSET_BOTTOM = 88
const MIN_HEIGHT = 280
const ADAPTIVE_MIN = 420
const windowWidthFor = (w) => w + INSET_X * 2
const windowHeightFor = (h) => h + INSET_Y + INSET_BOTTOM

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const checks = []
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail })
  console.log(`${ok ? '通过' : '失败'}：${name}${detail ? '（' + detail + '）' : ''}`)
  return ok
}

// 1×1 透明 PNG，玻璃层走降级也不影响尺寸验证
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const seedTasks = Array.from({ length: 18 }, (_, i) => ({
  id: `seed-${i}`,
  text: `尺寸验证任务 ${i + 1}`,
  createdAt: new Date().toISOString()
}))
const testData = () => ({
  version: 1,
  goals: { quarter: null, month: null, week: null },
  tasks: seedTasks.map((t) => ({ ...t })),
  archive: [],
  // 种子即验证点：启动应直接应用手动尺寸 500×600（M14 持久化）
  settings: { autostart: false, fontSize: 'medium', noteX: 100, noteY: 80, noteW: 500, noteH: 600 }
})

const reports = [] // 渲染层 resizeNote 上报记录 [w, h, x?]
let lastSetData = null
let win

// 隔离 userData：不与 dev/正式实例抢配置目录（否则会把对方挤掉）
app.setPath('userData', path.join(__dirname, 'electron-profile'))

app.whenReady().then(async () => {
  win = new BrowserWindow({
    width: windowWidthFor(500),
    height: windowHeightFor(600),
    x: 100,
    y: 80,
    hasShadow: false,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    show: true, // 必须可见：渲染层用 rAF 合帧上报，隐藏窗口会被节流饿死
    webPreferences: {
      preload: path.join(__dirname, '../../out/preload/index.js'),
      sandbox: false
    }
  })

  // 与 src/main/index.ts 的 qink:note-resize 处理逻辑逐行一致
  ipcMain.on('qink:note-resize', (_e, noteW, noteH, winX) => {
    if (typeof noteW !== 'number' || !Number.isFinite(noteW)) return
    if (typeof noteH !== 'number' || !Number.isFinite(noteH)) return
    reports.push([noteW, noteH, winX ?? null])
    const workArea = screen.getPrimaryDisplay().workArea
    const w = Math.round(Math.max(260, Math.min(noteW, 720)))
    const maxH = Math.max(MIN_HEIGHT, workArea.height - INSET_Y - INSET_BOTTOM)
    const h = Math.round(Math.max(MIN_HEIGHT, Math.min(noteH, maxH)))
    const [curX, y] = win.getPosition()
    const wantX = typeof winX === 'number' && Number.isFinite(winX) ? winX : curX
    const px = Math.max(workArea.x, Math.min(wantX, workArea.x + Math.max(0, workArea.width - w)))
    const py = Math.max(workArea.y, Math.min(y, workArea.y + Math.max(0, workArea.height - h)))
    win.setBounds({ x: px, y: py, width: windowWidthFor(w), height: windowHeightFor(h) })
    if (h < Math.round(noteH)) win.webContents.send('qink:note-capped', h)
  })

  ipcMain.handle('qink:data:get', () => testData())
  ipcMain.handle('qink:data:set', (_e, incoming) => { lastSetData = JSON.parse(JSON.stringify(incoming)) })
  ipcMain.handle('qink:glass-info', () => ({
    b64: PIXEL, mime: 'image/png', win11: false,
    screenW: screen.getPrimaryDisplay().bounds.width,
    screenH: screen.getPrimaryDisplay().bounds.height,
    originX: 0, originY: 0, winX: 100, winY: 80
  }))
  ipcMain.on('qink:glass-report', () => {})

  // 生产主进程会把窗口位置推给渲染层（玻璃层与左边缘锚点都靠它），这里保持一致
  const sendPos = () => {
    const [x, y] = win.getPosition()
    win.webContents.send('qink:win-pos', x, y)
  }
  win.on('move', sendPos)
  win.webContents.on('did-finish-load', sendPos)

  await win.loadURL('http://localhost:5173')

  const settle = async () => {
    let stable = 0
    let last = ''
    for (let i = 0; i < 40 && stable < 8; i++) {
      await sleep(250)
      const b = win.getBounds()
      const key = `${b.x},${b.y},${b.width},${b.height}`
      if (key === last) stable++
      else { stable = 0; last = key }
    }
  }
  const probeDom = () => win.webContents.executeJavaScript(
    `(() => { const n = document.getElementById('note'); const t = document.querySelector('.tasks')
      return { w: n.offsetWidth, h: n.offsetHeight, tasks: t.querySelectorAll('.task').length,
               scrollable: t.scrollHeight > t.clientHeight } })()`
  )
  // 合成指针手势：screen 坐标走 (1000,1000) 起，只依赖位移差
  const dragEdge = async (selector, dx, dy) => {
    await win.webContents.executeJavaScript(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      const opt = { bubbles: true, cancelable: true, pointerId: 7, button: 0, screenX: 1000, screenY: 1000 }
      el.dispatchEvent(new PointerEvent('pointerdown', opt))
      window.dispatchEvent(new PointerEvent('pointermove', { ...opt, screenX: 1000 + (${dx}), screenY: 1000 + (${dy}) }))
      window.dispatchEvent(new PointerEvent('pointerup', { ...opt, screenX: 1000 + (${dx}), screenY: 1000 + (${dy}) }))
    })()`)
    await settle()
  }
  const results = { checks: [] }
  const push = (name, ok, detail) => { check(name, ok, detail); results.checks.push({ name, ok, detail }) }
  const approx = (a, b, tol) => Math.abs(a - b) <= tol

  // ---- P1：持久化手动尺寸随启动应用 ----
  await settle()
  let b = win.getBounds()
  let dom = await probeDom()
  results.p1 = { bounds: b, dom }
  push('渲染层收到 18 条种子任务', dom.tasks === 18, `实际 ${dom.tasks}`)
  push('启动应用持久化手动尺寸 500×600', approx(dom.w, 500, 1) && approx(dom.h, 600, 1), `便签 ${dom.w}×${dom.h}`)
  push('窗口尺寸 = 便签 + 边距（612×728）', approx(b.width, 612, 2) && approx(b.height, 728, 2), `窗口 ${b.width}×${b.height}`)
  push('手动高度小于内容：任务区内部滚动', dom.scrollable, 'tasks scrollHeight > clientHeight')

  // ---- P2：底边拖拽 +80 → 高度手动固定并落盘 ----
  await dragEdge('.edge[data-edge="bottom"]', 0, 80)
  b = win.getBounds(); dom = await probeDom()
  results.p2 = { bounds: b, dom, lastSetData }
  push('底边下拖 80px：便签 600→680', approx(dom.h, 680, 2), `便签高 ${dom.h}`)
  push('窗口高度跟随（808）', approx(b.height, 808, 2), `窗口高 ${b.height}`)
  push('手势结束落盘 settings.noteH=680', lastSetData?.settings?.noteH === 680, `noteH=${JSON.stringify(lastSetData?.settings?.noteH)}`)

  // ---- P3：右边缘拖拽 +80 → 宽度调整 ----
  await dragEdge('.edge[data-edge="right"]', 80, 0)
  b = win.getBounds(); dom = await probeDom()
  results.p3 = { bounds: b, dom }
  push('右边缘右拖 80px：便签 500→580', approx(dom.w, 580, 2), `便签宽 ${dom.w}`)
  push('窗口宽度跟随（692）', approx(b.width, 692, 2), `窗口宽 ${b.width}`)
  push('左上角 x 不动（右/底边锚点）', b.x === 100, `x=${b.x}`)

  // ---- P4：左边缘拖拽 -40 → 宽度增且窗口左移 ----
  await dragEdge('.edge[data-edge="left"]', -40, 0)
  b = win.getBounds(); dom = await probeDom()
  results.p4 = { bounds: b, dom }
  push('左边缘左拖 40px：便签 580→620', approx(dom.w, 620, 2), `便签宽 ${dom.w}`)
  push('窗口随之左移 40（100→60），便签左缘跟手', approx(b.x, 60, 2), `x=${b.x}`)

  // ---- P5：双击边缘 → 恢复默认（320 宽 + 自适应高） ----
  await win.webContents.executeJavaScript(`document.querySelector('.edge[data-edge="right"]')
    .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
  await settle()
  b = win.getBounds(); dom = await probeDom()
  results.p5 = { bounds: b, dom, lastSetData }
  push('双击后恢复默认宽 320', approx(dom.w, 320, 1), `便签宽 ${dom.w}`)
  push('高度回到自适应：18 条任务撑到 ~746', dom.h > 600, `便签高 ${dom.h}`)
  push('窗口回到 432 宽', approx(b.width, 432, 2), `窗口宽 ${b.width}`)
  push('双击清除持久化尺寸（noteW/noteH = null）',
    lastSetData?.settings?.noteW === null && lastSetData?.settings?.noteH === null,
    `noteW=${JSON.stringify(lastSetData?.settings?.noteW)}, noteH=${JSON.stringify(lastSetData?.settings?.noteH)}`)

  // ---- P6：清空任务 → 缩回空态最小值 ----
  await win.webContents.executeJavaScript(`document.querySelectorAll('.tasks .task').forEach(el => el.remove())`)
  await settle()
  b = win.getBounds(); dom = await probeDom()
  results.p6 = { bounds: b, dom, reports }
  push('任务清空后便签缩回空态最小值 420', approx(dom.h, ADAPTIVE_MIN, 1), `便签高 ${dom.h}`)
  push('窗口跟着缩回（420 + 上40 + 下88）', approx(b.height, windowHeightFor(ADAPTIVE_MIN), 2), `窗口高 ${b.height}`)

  fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(results, null, 2))
  const failed = checks.filter((c) => !c.ok).length
  console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`)
  app.exit(failed === 0 ? 0 : 1)
})
