import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, shell, Tray } from 'electron'
import { join } from 'node:path'
import { clampNotePosition, NOTE_INSET_X, NOTE_INSET_Y, WINDOW_WIDTH, WINDOW_HEIGHT } from '../shared/window'
import { getData, loadData, queueSave, setData } from './store'
import { readWallpaper, watchWallpaper } from './wallpaper'
import { TRAY_ICON_DATA_URL } from './tray-icon'
import type { QinkData } from '../shared/dates'
import type { GlassInfo } from '../shared/glass'

// 常驻模型（spec.md）：贴纸可关（隐藏不销毁），托盘是找回入口与退出入口；
// 永不置顶；单实例；开机自启由右键抽屉开关；位置记忆在主显示器工作区内。

let win: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let dragAnchor: { x: number; y: number } | null = null

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
    watchWallpaper((w) => {
      win?.webContents.send('qink:wallpaper-changed', w)
    })
  })

  app.on('before-quit', () => {
    isQuitting = true
  })

  // 托盘驻留：窗口全关不退出，退出只走托盘菜单 / 右键抽屉
  app.on('window-all-closed', () => {})
}

function createWindow(): void {
  win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    hasShadow: false,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  restorePosition()

  // 统一用壁纸采样，避免系统材质填满透明阴影边缘、破坏原型圆角。

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
  d.settings.noteX = x + NOTE_INSET_X
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

/** 只在主显示器工作区内恢复，防止窗口丢在已拔掉的屏幕外 */
function restorePosition(): void {
  const { noteX, noteY } = getData().settings
  if (typeof noteX !== 'number' || typeof noteY !== 'number' || !win) return
  const pos = clampNotePosition(noteX, noteY, screen.getPrimaryDisplay().workArea)
  win.setPosition(pos.x - NOTE_INSET_X, pos.y - NOTE_INSET_Y)
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

  ipcMain.handle('qink:autostart', (_e, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enabled })
    const d = getData()
    d.settings.autostart = enabled
    queueSave()
  })

  ipcMain.handle('qink:open-data-folder', () => {
    void shell.openPath(join(app.getPath('documents'), 'Qink'))
  })

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
    const pos = clampNotePosition(
      dragAnchor.x + dx + NOTE_INSET_X,
      dragAnchor.y + dy + NOTE_INSET_Y,
      screen.getPrimaryDisplay().workArea
    )
    win.setPosition(pos.x - NOTE_INSET_X, pos.y - NOTE_INSET_Y)
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

  ipcMain.handle('qink:glass-info', async (): Promise<GlassInfo> => {
    const primary = screen.getPrimaryDisplay()
    const [winX, winY] = win ? win.getPosition() : [0, 0]
    const wp = await readWallpaper()
    return {
      ...wp,
      win11: false,
      screenW: primary.bounds.width,
      screenH: primary.bounds.height,
      originX: primary.bounds.x,
      originY: primary.bounds.y,
      winX,
      winY
    }
  })

  ipcMain.on('qink:glass-report', (_e, r: { ok: boolean; ms?: number; bytes?: number }) => {
    console.log(`[qink] 玻璃采样 ${r.ok ? `成功 ${r.ms}ms ${r.bytes}B` : '失败 → 降级纯半透明'}`)
  })
}
