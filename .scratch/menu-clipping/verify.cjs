// 在隔离的真实 Electron 渲染页里检查悬浮球右键菜单是否完整可见。
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const assert = require('node:assert/strict')
const fs = require('node:fs')

app.setPath('userData', path.join(__dirname, 'electron-profile'))
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('no-sandbox')
app.disableHardwareAcceleration()

let data = {
  version: 1,
  goals: { quarter: null, month: null, week: null },
  tasks: [],
  archive: [],
  settings: {
    autostart: false, fontSize: 'medium', noteX: null, noteY: null,
    noteW: null, noteH: null, noteMode: 'ball'
  }
}

app.whenReady().then(async () => {
  ipcMain.handle('qink:data:get', () => data)
  ipcMain.handle('qink:data:set', (_event, incoming) => { data = incoming })
  ipcMain.handle('qink:autostart', () => {})
  ipcMain.handle('qink:open-data-folder', () => {})
  ipcMain.handle('qink:work-area', () => ({ x: 0, y: 0, width: 960, height: 800 }))
  ipcMain.handle('qink:form-change', () => {})
  ipcMain.on('qink:quit', () => app.quit())
  ipcMain.on('qink:mouse-ignore', () => {})

  const win = new BrowserWindow({
    width: 600, height: 184, show: false, frame: false, transparent: true,
    webPreferences: {
      preload: path.resolve(__dirname, '../../out/preload/index.js'),
      backgroundThrottling: false, sandbox: false, offscreen: true
    }
  })
  let baseBounds = null
  ipcMain.handle('qink:menu-place', (_event, x, y, width, height) => {
    baseBounds = win.getBounds()
    const shift = Math.max(0, height + 8 - baseBounds.height)
    win.setBounds({ ...baseBounds, y: baseBounds.y - shift, height: baseBounds.height + shift })
    return {
      left: Math.min(x, baseBounds.width - width - 4), top: 4,
      dockShiftY: shift, maxHeight: 792, maxWidth: 952
    }
  })
  ipcMain.on('qink:menu-close', () => {
    if (baseBounds) win.setBounds(baseBounds)
    baseBounds = null
  })
  try {
    await win.loadFile(path.resolve(__dirname, '../../out/renderer/index.html'))
    await new Promise((resolve) => setTimeout(resolve, 250))
    const ballBefore = await win.webContents.executeJavaScript(`document.querySelector('#fab').getBoundingClientRect().top`)
    const windowBefore = win.getBounds()
    await win.webContents.executeJavaScript(`(() => {
      const ball = document.querySelector('#fab')
      const r = ball.getBoundingClientRect()
      ball.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2
      }))
    })()`)
    await new Promise((resolve) => setTimeout(resolve, 50))
    const result = await win.webContents.executeJavaScript(`(() => {
      const menu = document.querySelector('#menu')
      const box = menu.getBoundingClientRect()
      return {
        viewportHeight: window.innerHeight,
        menuTop: box.top,
        menuBottom: box.bottom,
        menuHeight: box.height,
        items: Array.from(menu.querySelectorAll('.menu-item')).map((item) => item.textContent)
      }
    })()`)
    console.log('悬浮球右键菜单：' + JSON.stringify(result))
    const ballAfter = await win.webContents.executeJavaScript(`document.querySelector('#fab').getBoundingClientRect().top`)
    assert.equal(win.getBounds().y + ballAfter, windowBefore.y + ballBefore, '扩窗期间悬浮球屏幕位置不变')
    assert.ok(result.items.includes('退出 Qink'), '菜单含最后一项')
    assert.ok(result.menuTop >= 0 && result.menuBottom <= result.viewportHeight,
      '菜单从第一项到最后一项都应在可见窗口内')
    fs.writeFileSync(path.join(__dirname, 'menu-visible.png'), (await win.webContents.capturePage()).toPNG())
    await win.webContents.executeJavaScript(`(() => {
      Array.from(document.querySelectorAll('#menu .menu-item'))
        .find((item) => item.textContent === '字号 · 小').click()
    })()`)
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(data.settings.fontSize, 'small', '菜单项可以执行原有动作')
    assert.equal(win.getBounds().height, 184, '关闭菜单后恢复悬浮球窗口高度')
    console.log('通过：菜单完整位于可见窗口内')
    win.destroy()
    app.quit()
  } catch (error) {
    console.error(error)
    win.destroy()
    app.exit(1)
  }
})
