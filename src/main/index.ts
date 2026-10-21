import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, powerMonitor, screen, shell, Tray } from 'electron'
import { join } from 'node:path'
import {
  ADAPTIVE_MIN_HEIGHT,
  clampNoteHeight,
  clampNotePosition,
  fitNoteWidth,
  insetXForForm,
  NOTE_INSET_Y,
  NOTE_WIDTH,
  noteSizeForForm,
  placeContextMenu,
  windowWidthFor,
  windowWidthForForm,
  windowHeightFor
} from '../shared/window'
import { flushPendingSync, getData, loadData, queueSave, setData, watchExternalData } from './store'
import { diag, logDir } from './diag'
import { TRAY_ICON_DATA_URL } from './tray-icon'
import type { QinkData } from '../shared/dates'

// 常驻模型（spec.md）：关闭 = 收成悬浮球（窗口不隐藏不销毁），托盘左键 = 抬前聚焦；
// 默认不置顶，托盘右键可切换置顶（置顶时抗 Win+D）；单实例；开机自启由右键抽屉开关；位置记忆在主显示器工作区内。

let win: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let dragAnchor: { x: number; y: number } | null = null
let menuBaseBounds: Electron.Rectangle | null = null
// 失焦收起的挂起计时器：见 win.on('blur')，showNote() 可撤销
let blurCollapseTimer: ReturnType<typeof setTimeout> | null = null
// 便签的权威尺寸。绝不从 win.getBounds() 推导：Windows 会给透明窗口的 HWND
// 自动外扩（本机上外扩到 ~1300×1400，且每移动一次 ±1px 跳动），
// 读矩形会把假尺寸当真，位置越界检查就会把便签钳到屏幕顶（M14 修复的 bug）。
let noteSize = { w: NOTE_WIDTH, h: ADAPTIVE_MIN_HEIGHT }
// 当前形态（球/贴纸）：决定窗口左右边距取阴影空间还是速记胶囊空间
let noteForm: 'ball' | 'note' = 'note'

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // 主进程异常留痕：默认行为是进程直接死、桌面全消失而现场无从得知原因。
  // 记录后继续运行——桌面小组件可用性优先，落盘已有原子写保护（ADR-0009）
  process.on('uncaughtException', (err) => {
    diag('uncaughtException', { message: err.message, at: err.stack?.split('\n')[1]?.trim() })
  })
  process.on('unhandledRejection', (reason) => {
    diag('unhandledRejection', { reason: String(reason) })
  })

  app.on('second-instance', () => showNote())

  app.whenReady().then(async () => {
    diag('boot', { ver: app.getVersion(), electron: process.versions.electron, platform: process.platform })
    const outcome = await loadData()
    // 双坏（主文件与备份都救不回来）必须让用户知道：数据从空白开始，坏档已留证可手动抢救
    if (outcome.source === 'fresh' && outcome.quarantined.length > 0) {
      dialog.showErrorBox(
        'Qink：数据文件损坏',
        '数据文件与备份都无法读取，已从空白重新开始。\n\n' +
          '损坏的原件已保留在以下位置，如需抢救可手动打开查看：\n' +
          outcome.quarantined.join('\n')
      )
    }
    const data = getData()
    // 启动即落盘一次：文件缺失（被清理/误删）时立刻自愈重建；坏档已被留证，覆盖现场不销毁证据
    queueSave()
    app.setLoginItemSettings({ openAtLogin: data.settings.autostart })
    createWindow()
    createTray()
    wireIpc()

    // 外部写入热重载（ADR-0010）：qink-tasks skill 等外部工具原子改 data.json 后
    // 贴纸实时刷新，无需重启。撞车规则与回环抑制在 store-io；渲染层只换数据重渲染、
    // 绝不回写（回写会触发监听形成「写→看→写」回环）
    watchExternalData((next) => {
      diag('external-reload', { tasks: next.tasks.length })
      win?.webContents.send('qink:data:external', next)
    })

    // 睡眠唤醒/锁屏解锁与显示器变化：透明窗在系统显示状态剧变后可能掉渲染或被移出屏外，
    // 轻推重合成 + 拉回工作区（现场「图标消失」的防御路径，事件本身也留痕供对时间线）
    powerMonitor.on('suspend', () => diag('power-suspend'))
    powerMonitor.on('lock-screen', () => diag('power-lock'))
    powerMonitor.on('resume', () => {
      diag('power-resume')
      nudgeRepaint()
      reclampToWorkArea()
    })
    powerMonitor.on('unlock-screen', () => {
      diag('power-unlock')
      nudgeRepaint()
      reclampToWorkArea()
    })
    screen.on('display-metrics-changed', () => {
      diag('display-metrics-changed')
      reclampToWorkArea()
    })
    screen.on('display-removed', () => {
      diag('display-removed')
      reclampToWorkArea()
    })
  })

  app.on('before-quit', () => {
    isQuitting = true
    diag('quit')
    // 防抖窗口（300ms）内挂起的最后一次修改必须落盘：退出路径等不了异步回调
    flushPendingSync()
  })

  // 托盘驻留：窗口全关不退出，退出只走托盘菜单 / 右键抽屉
  app.on('window-all-closed', () => {})

  // GPU 等子进程异常留痕：GPU 崩溃虽常可自恢复，但透明窗表面可能因此掉渲染（「图标消失」候选路径）
  app.on('child-process-gone', (_e, details) => {
    diag('child-process-gone', { type: details.type, reason: details.reason })
  })
}

function createWindow(): void {
  // 启动即用持久化尺寸建窗（手动尺寸不跳变；自适应模式以空态下限起步，
  // 渲染层量出内容后经 qink:note-resize 校正）
  const s = getData().settings
  // 双形态启动：球形态固定 56×56，贴纸形态走持久化/默认尺寸（启动即定，避免跳变）
  const bootArea = screen.getPrimaryDisplay().workArea
  const boot = noteSizeForForm(s.noteMode === 'ball' ? 'ball' : 'note', s.noteW, s.noteH, bootArea.height, bootArea.width)
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

  // 置顶按持久化状态应用（默认关）。Win+D「显示桌面」会最小化包括 topmost 在内的
  // 所有窗口（任务管理器置顶也会被压下），置顶开启时立即还原并重申层级，让 Win+D 失效；
  // 本应用无边框无任务栏项，不存在用户主动最小化，不会误伤
  applyAlwaysOnTop()
  win.on('minimize', () => {
    if (getData().settings.alwaysOnTop !== true) return
    win?.restore()
    win?.setAlwaysOnTop(true, 'screen-saver')
  })

  win.on('ready-to-show', () => {
    win?.show()
    forwardPos() // 初始位置喂给玻璃层
  })

  // 关闭 = 隐藏进托盘；真正退出由 isQuitting 放行
  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      win?.hide()
      diag('win-hidden', 'close→tray')
    }
  })

  // 渲染层死亡必须留痕并自愈：透明窗口渲染层没了 = 桌面上物理级隐形（「图标消失」路径）。
  // reload 重建渲染层与合成表面（UI 无状态，数据都在主进程内存+磁盘，无损）；
  // 60 秒内连崩 3 次以上视为环境性顽疾（显卡驱动等），停止无限重启只留痕，防崩溃风暴
  const renderCrashes: number[] = []
  win.webContents.on('render-process-gone', (_e, details) => {
    diag('render-process-gone', { reason: details.reason, exitCode: details.exitCode })
    if (isQuitting || details.reason === 'clean-exit') return
    const now = Date.now()
    while (renderCrashes.length && now - renderCrashes[0] > 60_000) renderCrashes.shift()
    renderCrashes.push(now)
    if (renderCrashes.length > 3) {
      diag('render-reload-skipped', 'crash-loop')
      return
    }
    diag('render-reload', 'auto')
    win?.webContents.reload()
  })

  // 'move'（含程序化 setPosition）与 'moved' 都挂：保存幂等，queueSave 防抖合并
  win.on('move', () => {
    savePosition()
    forwardPos()
  })
  win.on('moved', savePosition)

  // 失焦自动收起（blur-collapse spec）：贴纸展开时点击窗口外（桌面/其他应用）
  // → 250ms 后通知渲染层收成球。挂起而非即发：托盘点击/第二实例抬前都发生在
  // blur 之后（Windows 托盘 click 松开才发，距 blur 常有上百 ms），留撤销窗口，
  // 否则「点托盘聚焦贴纸」会被误判成「点外部」先把贴纸收掉。计时器到期时二次
  // 核对焦点，250ms 内点回来的同样不收。devtools 抢走焦点不收（调试常态）。
  win.on('blur', () => {
    if (noteForm !== 'note') return
    if (win?.webContents.isDevToolsOpened()) return
    cancelBlurCollapse()
    blurCollapseTimer = setTimeout(() => {
      blurCollapseTimer = null
      if (!win || noteForm !== 'note' || win.isFocused()) return
      win.webContents.send('qink:blur-collapse')
    }, 250)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function savePosition(): void {
  if (!win || menuBaseBounds) return // 菜单扩窗只是临时绘图区，不写成便签位置
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

function restoreMenuBounds(): void {
  if (!win || !menuBaseBounds) return
  const bounds = menuBaseBounds
  win.setBounds(bounds)
  menuBaseBounds = null
  forwardPos(true)
}

/** 只在主显示器工作区内恢复，防止窗口丢在已拔掉的屏幕外 */
function restorePosition(): void {
  const { noteX, noteY } = getData().settings
  if (typeof noteX !== 'number' || typeof noteY !== 'number' || !win) return
  const { w, h } = currentNoteSize()
  const pos = clampNotePosition(noteX, noteY, w, h, screen.getPrimaryDisplay().workArea)
  win.setPosition(pos.x - insetXForForm(noteForm), pos.y - NOTE_INSET_Y)
}

/** 显示器被拔/分辨率变化后：把窗口拉回主显示器工作区（存储位置就是最新位置，等价于钳制当前位） */
function reclampToWorkArea(): void {
  if (!win) return
  if (menuBaseBounds) win.webContents.send('qink:menu-dismiss')
  restoreMenuBounds()
  const [x, y] = win.getPosition()
  const area = screen.getPrimaryDisplay().workArea
  if (noteForm === 'note') {
    const preferred = getData().settings.noteW ?? NOTE_WIDTH
    const w = fitNoteWidth(preferred, area.width)
    const h = clampNoteHeight(noteSize.h, area.height)
    noteSize = { w, h }
    win.setSize(windowWidthFor(w), windowHeightFor(h))
    win.webContents.send('qink:effective-width', w, area.width)
  }
  restorePosition()
  const [nx, ny] = win.getPosition()
  if (nx !== x || ny !== y) diag('reclamp', { from: [x, y], to: [nx, ny] })
}

/** 睡眠唤醒/解锁后轻推窗口：宽度 +1 再复原，强迫系统重新合成透明表面（透明窗掉渲染的标准自救） */
function nudgeRepaint(): void {
  if (!win) return
  if (menuBaseBounds) win.webContents.send('qink:menu-dismiss')
  restoreMenuBounds()
  const [x, y] = win.getPosition()
  const b = {
    x, y,
    width: windowWidthForForm(noteForm, noteSize.w), height: windowHeightFor(noteSize.h)
  }
  win.setBounds({ ...b, width: b.width + 1 })
  win.setBounds(b)
}

function createTray(): void {
  tray = new Tray(nativeImage.createFromDataURL(TRAY_ICON_DATA_URL))
  tray.setToolTip('Qink')
  tray.setContextMenu(buildTrayMenu())
  tray.on('click', () => showNote())
  // 右键托盘弹菜单同样先让窗口失焦：不撤销的话托盘菜单弹出的同时贴纸被收走
  tray.on('right-click', () => cancelBlurCollapse())
}

/** 托盘菜单按当前置顶状态构建，切换后整体重建刷新勾选态 */
function buildTrayMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: '置顶',
      type: 'checkbox',
      checked: getData().settings.alwaysOnTop === true,
      click: (item) => setAlwaysOnTopState(item.checked)
    },
    // 现场排障入口：用户回传 qink.log 即可对「消失」时间线（ADR-0009 同期诊断能力）
    { label: '打开日志文件夹', click: () => void shell.openPath(logDir()) },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])
}

/** 置顶开关唯一入口：落盘 + 应用窗口 + 反向同步渲染层 + 刷新托盘勾选。
 *  必须推送给渲染层：它是状态源，后续 qink:data:set 全量推送会整体替换 settings，
 *  不同步的话用户下一次任何编辑就把置顶状态悄悄冲掉 */
function setAlwaysOnTopState(on: boolean): void {
  const d = getData()
  if (d.settings.alwaysOnTop !== on) {
    d.settings.alwaysOnTop = on
    queueSave()
  }
  diag('pin', { on })
  applyAlwaysOnTop()
  win?.webContents.send('qink:always-on-top', on)
  tray?.setContextMenu(buildTrayMenu())
}

/** 把持久化置顶状态应用到窗口：screen-saver 是 Electron 最高 z 序层级，压过其他置顶窗口 */
function applyAlwaysOnTop(): void {
  if (!win) return
  const on = getData().settings.alwaysOnTop === true
  win.setAlwaysOnTop(on, 'screen-saver')
  if (on) win.moveTop()
}

/** 撤销挂起的失焦收起：托盘/第二实例抬前、右键托盘时调用（点托盘必先让窗口 blur） */
function cancelBlurCollapse(): void {
  if (blurCollapseTimer) {
    clearTimeout(blurCollapseTimer)
    blurCollapseTimer = null
  }
}

function showNote(): void {
  cancelBlurCollapse()
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

  ipcMain.handle('qink:menu-place', (_e, x: number, y: number, width: number, height: number) => {
    if (!win || ![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null
    restoreMenuBounds()
    // Windows 透明窗的 getBounds 读数会虚胖；尺寸用主进程账本，位置只读 getPosition。
    const [winX, winY] = win.getPosition()
    const bounds = {
      x: winX, y: winY,
      width: windowWidthForForm(noteForm, noteSize.w), height: windowHeightFor(noteSize.h)
    }
    const area = screen.getDisplayNearestPoint({ x: bounds.x + x, y: bounds.y + y }).workArea
    const placement = placeContextMenu(bounds, area, { x, y }, { width, height })
    menuBaseBounds = bounds
    if (placement.y !== bounds.y || placement.height !== bounds.height) {
      win.setBounds({ ...bounds, y: placement.y, height: placement.height })
    }
    return placement
  })
  ipcMain.on('qink:menu-close', restoreMenuBounds)

  // 渲染层诊断事件透传（boot 完成/形态切换及原因）：现场「消失」报告能对上时间线
  ipcMain.on('qink:diag', (_e, event: unknown, detail?: unknown) => {
    diag(String(event), detail)
  })

  // ---- 尺寸同步：渲染层上报便签目标尺寸（宽度恒久、高度=手动值或自适应期望值），
  // ---- 保持左上角不动调窗（左边缘拖拽时 winX 为期望的窗口 x）；高度被工作区
  // ---- 截住时回传实际值，渲染层同步 CSS，避免便签伸出窗外
  ipcMain.on('qink:note-resize', (_e, noteW: number, noteH: number, winX?: number) => {
    if (!win) return
    if (typeof noteW !== 'number' || !Number.isFinite(noteW)) return
    if (typeof noteH !== 'number' || !Number.isFinite(noteH)) return
    const workArea = screen.getPrimaryDisplay().workArea
    const w = fitNoteWidth(noteW, workArea.width)
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
    if (w !== Math.round(noteW)) win.webContents.send('qink:effective-width', w, workArea.width)
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
    restoreMenuBounds()
    const d = getData()
    if (d.settings.noteMode !== mode) {
      d.settings.noteMode = mode
      queueSave()
    }
    const workArea = screen.getPrimaryDisplay().workArea
    const s = d.settings
    const size = noteSizeForForm(mode, s.noteW, s.noteH, workArea.height, workArea.width)
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
    return size
  })
}
