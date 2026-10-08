import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, shell, Tray } from 'electron'
import { join } from 'node:path'
import {
  ADAPTIVE_MIN_HEIGHT,
  clampNoteHeight,
  clampNotePosition,
  clampNoteWidth,
  insetXForForm,
  NOTE_INSET_Y,
  NOTE_WIDTH,
  noteSizeForForm,
  windowWidthFor,
  windowWidthForForm,
  windowHeightFor
} from '../shared/window'
import { getData, loadData, queueSave, setData } from './store'
import { TRAY_ICON_DATA_URL } from './tray-icon'
import type { QinkData } from '../shared/dates'

// 常驻模型（spec.md）：贴纸可关（隐藏不销毁），托盘是找回入口与退出入口；
// 永不置顶；单实例；开机自启由右键抽屉开关；位置记忆在主显示器工作区内。

let win: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let dragAnchor: { x: number; y: number } | null = null
// 便签的权威尺寸。绝不从 win.getBounds() 推导：Windows 会给透明窗口的 HWND
// 自动外扩（本机上外扩到 ~1300×1400，且每移动一次 ±1px 跳动），
// 读矩形会把假尺寸当真，位置越界检查就会把便签钳到屏幕顶（M14 修复的 bug）。
let noteSize = { w: NOTE_WIDTH, h: ADAPTIVE_MIN_HEIGHT }
// 当前形态（球/贴纸）：决定窗口左右边距取阴影空间还是速记胶囊空间
let noteForm: 'ball' | 'note' = 'note'

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showNote())

  app.whenReady().then(async () => {
    await loadData()
    const data = getData()
    // 启动即落盘一次：文件缺失（被清理/误删）时立刻自愈重建
    queueSave()
    app.setLoginItemSettings({ openAtLogin: data.settings.autostart })
    createWindow()
    createTray()
    wireIpc()
  })

  app.on('before-quit', () => {
    isQuitting = true
  })

  // 托盘驻留：窗口全关不退出，退出只走托盘菜单 / 右键抽屉
  app.on('window-all-closed', () => {})
}

function createWindow(): void {
  // 启动即用持久化尺寸建窗（手动尺寸不跳变；自适应模式以空态下限起步，
  // 渲染层量出内容后经 qink:note-resize 校正）
  const s = getData().settings
  // 双形态启动：球形态固定 56×56，贴纸形态走持久化/默认尺寸（启动即定，避免跳变）
  const boot = noteSizeForForm(s.noteMode === 'ball' ? 'ball' : 'note', s.noteW, s.noteH, screen.getPrimaryDisplay().workArea.height)
  noteSize = boot
  noteForm = s.noteMode === 'ball' ? 'ball' : 'note'
  win = new BrowserWindow({
    width: windowWidthForForm(noteForm, boot.w),
    height: windowHeightFor(boot.h),
    hasShadow: false,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: false,
    skipTaskbar: true,
    // 常规场景看不见(skipTaskbar + 无边框),但 Alt+Tab、系统对话框用得上;
    // electron-builder 的 files 已把 build/icon.ico 带进包内,nativeImage 可直读 asar
    icon: nativeImage.createFromPath(join(app.getAppPath(), 'build', 'icon.ico')),
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  restorePosition()

  win.on('ready-to-show', () => {
    win?.show()
    forwardPos() // 初始位置喂给玻璃层
  })

  // 关闭 = 隐藏进托盘；真正退出由 isQuitting 放行
  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      win?.hide()
    }
  })

  // 'move'（含程序化 setPosition）与 'moved' 都挂：保存幂等，queueSave 防抖合并
  win.on('move', () => {
    savePosition()
    forwardPos()
  })
  win.on('moved', savePosition)

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function savePosition(): void {
  if (!win) return
  const [x, y] = win.getPosition()
  const d = getData()
  d.settings.noteX = x + insetXForForm(noteForm)
  d.settings.noteY = y + NOTE_INSET_Y
  queueSave()
}

let lastPosSend = 0

/** 窗口位置转发给渲染层的玻璃平移（16ms 节流，拖动时帧级跟随） */
function forwardPos(force = false): void {
  if (!win) return
  const now = Date.now()
  if (!force && now - lastPosSend < 16) return
  lastPosSend = now
  const [x, y] = win.getPosition()
  win.webContents.send('qink:win-pos', x, y)
}

/** 便签的当前尺寸（主进程记账，见 noteSize 注释） */
function currentNoteSize(): { w: number; h: number } {
  return { ...noteSize }
}

/** 只在主显示器工作区内恢复，防止窗口丢在已拔掉的屏幕外 */
function restorePosition(): void {
  const { noteX, noteY } = getData().settings
  if (typeof noteX !== 'number' || typeof noteY !== 'number' || !win) return
  const { w, h } = currentNoteSize()
  const pos = clampNotePosition(noteX, noteY, w, h, screen.getPrimaryDisplay().workArea)
  win.setPosition(pos.x - insetXForForm(noteForm), pos.y - NOTE_INSET_Y)
}

function createTray(): void {
  tray = new Tray(nativeImage.createFromDataURL(TRAY_ICON_DATA_URL))
  tray.setToolTip('Qink')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示贴纸', click: () => showNote() },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('click', () => showNote())
}

function showNote(): void {
  if (!win) return
  win.show()
  win.focus()
}

function wireIpc(): void {
  ipcMain.handle('qink:data:get', () => getData())
  ipcMain.handle('qink:data:set', (_e, incoming: QinkData) => {
    setData(incoming)
    savePosition()
  })

  // ---- 尺寸同步：渲染层上报便签目标尺寸（宽度恒久、高度=手动值或自适应期望值），
  // ---- 保持左上角不动调窗（左边缘拖拽时 winX 为期望的窗口 x）；高度被工作区
  // ---- 截住时回传实际值，渲染层同步 CSS，避免便签伸出窗外
  ipcMain.on('qink:note-resize', (_e, noteW: number, noteH: number, winX?: number) => {
    if (!win) return
    if (typeof noteW !== 'number' || !Number.isFinite(noteW)) return
    if (typeof noteH !== 'number' || !Number.isFinite(noteH)) return
    const workArea = screen.getPrimaryDisplay().workArea
    const w = clampNoteWidth(noteW)
    const h = clampNoteHeight(noteH, workArea.height)
    noteSize = { w, h }
    const [curX, y] = win.getPosition()
    const wantX = typeof winX === 'number' && Number.isFinite(winX) ? winX : curX
    // 边距随形态取值（贴纸=阴影空间，球=胶囊空间）：输入输出同源，杜绝半新半旧的换算跳变
    const pos = clampNotePosition(wantX + insetXForForm(noteForm), y + NOTE_INSET_Y, w, h, workArea)
    win.setBounds({
      x: pos.x - insetXForForm(noteForm),
      y: pos.y - NOTE_INSET_Y,
      width: windowWidthFor(w),
      height: windowHeightFor(h)
    })
    if (h < Math.round(noteH)) win.webContents.send('qink:note-capped', h)
  })

  ipcMain.handle('qink:autostart', (_e, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enabled })
    const d = getData()
    d.settings.autostart = enabled
    queueSave()
  })

  ipcMain.handle('qink:open-data-folder', () => {
    void shell.openPath(join(app.getPath('documents'), 'Qink'))
  })

  // 惯性投掷用：渲染层物理模拟需要工作区边界做贴边反弹（与拖动夹取同源）
  ipcMain.handle('qink:work-area', () => screen.getPrimaryDisplay().workArea)

  ipcMain.on('qink:quit', () => {
    isQuitting = true
    app.quit()
  })

  // ---- 自绘拖动：锚点取按下时窗口位置，移动按帧上报位移，不用系统拖动区 ----
  ipcMain.on('qink:drag-start', () => {
    if (!win) return
    const [x, y] = win.getPosition()
    dragAnchor = { x, y }
  })

  ipcMain.on('qink:drag-move', (_e, dx: number, dy: number) => {
    if (!win || !dragAnchor) return
    const { w, h } = currentNoteSize()
    const pos = clampNotePosition(
      dragAnchor.x + dx + insetXForForm(noteForm),
      dragAnchor.y + dy + NOTE_INSET_Y,
      w,
      h,
      screen.getPrimaryDisplay().workArea
    )
    win.setPosition(pos.x - insetXForForm(noteForm), pos.y - NOTE_INSET_Y)
    forwardPos()
  })

  ipcMain.on('qink:drag-end', () => {
    dragAnchor = null
    savePosition()
    forwardPos(true)
  })

  ipcMain.on('qink:mouse-ignore', (_e, ignore: boolean) => {
    win?.setIgnoreMouseEvents(ignore === true, { forward: true })
  })

  // ---- 双形态切换：球形态固定 56×56，贴纸形态回持久化尺寸；窗口 x 全程不动 ----
  // x 不动是形变连续性的承重墙：贴纸（inset 56）与球（inset 272）在窗口内的元素位不同，
  // 渲染层靠 CSS 过渡让贴纸滑向球的元素位接棒；x 一动，屏幕上全部内容瞬间平移
  ipcMain.handle('qink:form-change', (_e, mode: string) => {
    if (mode !== 'ball' && mode !== 'note') return
    if (!win) return
    const d = getData()
    if (d.settings.noteMode !== mode) {
      d.settings.noteMode = mode
      queueSave()
    }
    const workArea = screen.getPrimaryDisplay().workArea
    const s = d.settings
    const size = noteSizeForForm(mode, s.noteW, s.noteH, workArea.height)
    noteSize = size
    noteForm = mode
    const [curX, curY] = win.getPosition()
    const pos = clampNotePosition(curX + insetXForForm(mode), curY + NOTE_INSET_Y, size.w, size.h, workArea)
    win.setBounds({
      x: pos.x - insetXForForm(mode),
      y: pos.y - NOTE_INSET_Y,
      width: windowWidthForForm(mode, size.w),
      height: windowHeightFor(size.h)
    })
  })
}
