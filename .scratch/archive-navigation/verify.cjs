// 已完成清单翻日回归：使用真实 renderer + preload 和隔离的内存数据。
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const assert = require('node:assert/strict')
const dir = __dirname
app.setPath('userData', path.join(dir, 'electron-profile'))
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('no-sandbox')
app.disableHardwareAcceleration()

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const today = new Date()
const atDay = (offset) => {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset, 12)
  return d.toISOString()
}
let data = {
  version: 1,
  goals: { quarter: null, month: null, week: null },
  tasks: [{ id: 'todo-1', text: '待办样例', createdAt: atDay(0) }],
  archive: [
    { id: 'today-1', text: '今天完成样例', createdAt: atDay(0), completedAt: atDay(0) },
    { id: 'yesterday-1', text: '前一天完成样例', createdAt: atDay(-1), completedAt: atDay(-1) }
  ],
  settings: {
    autostart: false,
    fontSize: 'medium',
    noteX: null,
    noteY: null,
    noteW: null,
    noteH: null,
    noteMode: 'note'
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
    width: 960,
    height: 800,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: {
      preload: path.resolve(dir, '../../out/preload/index.js'),
      backgroundThrottling: false,
      sandbox: false,
      offscreen: true
    }
  })

  try {
    await win.loadFile(path.resolve(dir, '../../out/renderer/index.html'))
    await sleep(500)
    const run = (script) => win.webContents.executeJavaScript(script)

    // 固定动画为减弱模式，让复现只受点击事件顺序影响。
    await run(`(() => {
      const original = window.matchMedia.bind(window)
      window.matchMedia = (query) => query === '(prefers-reduced-motion: reduce)'
        ? { matches: true }
        : original(query)
    })()`)

    await run(`(() => {
      document.querySelector('.tasks').dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, clientX: 160, clientY: 380
      }))
      Array.from(document.querySelectorAll('.menu-item'))
        .find((item) => item.textContent === '已完成清单').click()
    })()`)
    await sleep(50)

    const before = await run(`(() => ({
      open: !!document.querySelector('.archive'),
      date: document.querySelector('.archive-date')?.textContent,
      rows: Array.from(document.querySelectorAll('.archive-row .text')).map((el) => el.textContent)
    }))()`)
    assert.equal(before.open, true, '进入已完成清单')
    assert.ok(before.rows.includes('今天完成样例'), '默认显示今天的完成记录')

    const previous = await run(`(() => {
      const button = document.querySelector('.archive-nav[aria-label="前一天（←）"]')
      const rect = button.getBoundingClientRect()
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    })()`)
    const hitTarget = await run(`document.elementFromPoint(${previous.x}, ${previous.y})?.closest('.archive-nav')?.getAttribute('aria-label')`)
    assert.equal(hitTarget, '前一天（←）', '真实点击坐标命中前一天按钮')
    win.webContents.sendInputEvent({ type: 'mouseMove', x: previous.x, y: previous.y })
    win.webContents.sendInputEvent({ type: 'mouseDown', x: previous.x, y: previous.y, button: 'left', clickCount: 1 })
    win.webContents.sendInputEvent({ type: 'mouseUp', x: previous.x, y: previous.y, button: 'left', clickCount: 1 })
    await sleep(50)

    const after = await run(`(() => ({
      open: !!document.querySelector('.archive'),
      archiveMode: document.querySelector('.tasks')?.classList.contains('archive-mode'),
      date: document.querySelector('.archive-date')?.textContent,
      rows: Array.from(document.querySelectorAll('.archive-row .text')).map((el) => el.textContent),
      todoDisplay: getComputedStyle(document.querySelector('.composer-hint')).display
    }))()`)
    console.log('点击前一天后的界面：' + JSON.stringify(after))
    assert.equal(after.open, true, '点击前一天后仍留在已完成清单')
    assert.equal(after.archiveMode, true, '任务区仍处于已完成清单模式')
    assert.ok(after.date && after.date !== before.date, '日期已切换到前一天')
    assert.ok(after.rows.includes('前一天完成样例'), '显示前一天的完成记录')
    assert.equal(after.todoDisplay, 'none', '翻日时待办清单仍隐藏')

    console.log('通过：已完成清单翻到前一天后仍保持打开并显示对应日期')
    win.destroy()
    app.quit()
  } catch (error) {
    console.error(error)
    win.destroy()
    app.exit(1)
  }
})
