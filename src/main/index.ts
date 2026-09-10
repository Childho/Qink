import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { getData, loadData, setData } from './store'
import type { QinkData } from '../shared/dates'

// 贴纸窗口：无边框 + 透明（Win10 透明必须无边框，调研已确认）。
// 永不置顶、不占任务栏——安静地待在桌面上（spec.md 常驻行为）。

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 320,
    height: 540,
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

  win.on('ready-to-show', () => win.show())

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  void loadData()
  ipcMain.handle('qink:data:get', () => getData())
  ipcMain.handle('qink:data:set', (_e, incoming: QinkData) => {
    setData(incoming)
  })
  createWindow()
})

// M1 阶段：窗口全关即退出（M4 引入托盘后改为驻留，由托盘菜单退出）
app.on('window-all-closed', () => {
  app.quit()
})
