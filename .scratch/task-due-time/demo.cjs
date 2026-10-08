// M15 截止时间 · 演示窗口：真实渲染层构建产物 + 内存种子（六种状态一次看全），
// 不读不写用户数据（IPC 拦截，与 verify.cjs 同隔离方式）。
// 打开后可自由交互：右键任务试「设定时间」，右键空白「退出 Qink」关闭演示。
// 用法：npx electron .scratch/task-due-time/demo.cjs
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const pad = (n) => String(n).padStart(2, '0')
const localDue = (offsetDays, hh = 0, mm = 0) => {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hh)}:${pad(mm)}:00`
}

// 六种状态：逾期红 | 紧急红（今天时刻）| 滚入+明天 | 今日+3天后 | 标记紫 | 今日普通
const now = new Date()
const qKey = `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`
const mKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
const demoData = () => ({
  version: 1,
  goals: {
    quarter: { periodKey: qKey, text: '发布 Qink 正式版' },
    month: { periodKey: mKey, text: '跑通日常使用闭环' },
    week: null
  },
  tasks: [
    { id: 'd1', text: '交付合同初稿（演示·逾期）', createdAt: localDue(-1), dueAt: localDue(-1) },
    { id: 'd2', text: '今天 17:30 交材料（演示·紧急）', createdAt: localDue(0), dueAt: localDue(0, 17, 30) },
    { id: 'd3', text: '等设计部回复视觉稿（演示·滚入+明天）', createdAt: localDue(-1), dueAt: localDue(1) },
    { id: 'd4', text: '整理季度复盘（演示·3 天后）', createdAt: localDue(0), dueAt: localDue(3) },
    { id: 'd5', text: '双周会准备（演示·标记）', createdAt: localDue(0), pinned: true },
    { id: 'd6', text: '回复客户邮件', createdAt: localDue(0) }
  ],
  archive: [],
  settings: {
    autostart: false, fontSize: 'medium',
    noteX: 1500, noteY: 120, noteW: null, noteH: null, noteMode: 'note'
  }
})

let live = demoData()
let win

app.setPath('userData', path.join(__dirname, 'electron-profile'))
fs.mkdirSync(path.join(__dirname, 'electron-profile'), { recursive: true })

app.whenReady().then(async () => {
  // 渲染层是状态源：用户在演示窗口里的改动实时写回内存（不落盘）
  ipcMain.handle('qink:data:get', () => live)
  ipcMain.handle('qink:data:set', (_e, incoming) => {
    live = incoming
  })
  ipcMain.handle('qink:autostart', () => {})
  ipcMain.handle('qink:open-data-folder', () => {})
  ipcMain.on('qink:quit', () => app.exit(0))

  win = new BrowserWindow({
    width: 460,
    height: 780,
    x: 1500,
    y: 110,
    frame: false,
    transparent: true,
    show: true,
    resizable: false,
    webPreferences: {
      preload: path.resolve(__dirname, '../../out/preload/index.js'),
      sandbox: false
    }
  })
  await win.loadFile(path.resolve(__dirname, '../../out/renderer/index.html'))

  // 截一张确认渲染（球裂缝在球形态才可见，贴纸形态先验证红/淡字/分区）
  setTimeout(async () => {
    try {
      const img = await win.webContents.capturePage()
      fs.writeFileSync(path.join(__dirname, 'demo.png'), img.toPNG())
      console.log('演示截图: .scratch/task-due-time/demo.png')
    } catch (e) {
      console.log('截图失败(不影响演示窗口):', e.message)
    }
  }, 1200)
  console.log('演示窗口已打开（隔离数据，随便玩）。右键空白 → 退出 Qink 关闭。')
})
