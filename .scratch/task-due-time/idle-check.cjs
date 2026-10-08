// 空闲自动收起（M16）实测断言：真实渲染层 + 隔离数据 + 真实等待（常量临时 3s、tick 1.5s）。
// 断言链：① 3s 无操作 → 自动收成球 ② 双击球展开后 2s（未超时）→ 仍贴纸
//        ③ 再无操作 4s → 再次收成球 ④ 展开后合成 pointerdown 续命 → 超时窗口重算
// 用法：先改 main.ts 常量为 3_000 并 npm run build，然后 npx electron 本脚本
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const checks = []
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' (' + detail + ')' : ''}`)
}

const seed = () => ({
  version: 1,
  goals: { quarter: null, month: null, week: null },
  tasks: [{ id: 'f1', text: '空闲收起实测', createdAt: new Date().toISOString() }],
  archive: [],
  settings: {
    autostart: false, fontSize: 'medium',
    noteX: 200, noteY: 100, noteW: null, noteH: null, noteMode: 'note'
  }
})
let live = seed()
let win

app.setPath('userData', path.join(__dirname, 'electron-profile'))
fs.mkdirSync(path.join(__dirname, 'electron-profile'), { recursive: true })

app.whenReady().then(async () => {
  ipcMain.handle('qink:data:get', () => live)
  ipcMain.handle('qink:data:set', (_e, v) => { live = v })
  ipcMain.handle('qink:autostart', () => {})
  ipcMain.handle('qink:open-data-folder', () => {})
  ipcMain.on('qink:quit', () => app.exit(0))

  win = new BrowserWindow({
    width: 460, height: 700, x: 300, y: 100,
    frame: false, show: true,
    webPreferences: { preload: path.resolve(__dirname, '../../out/preload/index.js'), sandbox: false }
  })
  await win.loadFile(path.resolve(__dirname, '../../out/renderer/index.html'))
  await sleep(500)

  const js = (code) => win.webContents.executeJavaScript(code)
  const form = () => js('document.body.dataset.form')
  const interact = () =>
    js(`document.querySelector('.tasks').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`)
  const dblFab = () =>
    js(`document.getElementById('fab').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)

  check('启动为贴纸形态', (await form()) === 'note')

  // ① 3s 超时 + 1.5s tick：等 4.5s 应已收成球
  await sleep(4500)
  check('无操作超时后自动收成球', (await form()) === 'ball', `form=${await form()}`)

  // ② 双击球展开（setForm 重置计时）；2s 未超 3s → 仍贴纸
  await dblFab()
  await sleep(300)
  check('双击球展开成功', (await form()) === 'note')
  await interact() // 交互续命
  await sleep(2000)
  check('交互后未超时仍是贴纸', (await form()) === 'note', `form=${await form()}`)

  // ③ 再无操作 4.5s → 再次收起（证明续命窗口从交互时刻重算）
  await sleep(4500)
  check('续命后无操作再次收起', (await form()) === 'ball', `form=${await form()}`)

  // ④ 展开 → 立即交互 → 2s 仍开（交互事件真实生效）
  await dblFab()
  await sleep(300)
  await interact()
  await sleep(2000)
  check('交互重置计时生效', (await form()) === 'note', `form=${await form()}`)

  const pass = checks.filter((c) => c.ok).length
  console.log(`result: ${pass}/${checks.length}`)
  fs.writeFileSync(
    path.join(__dirname, 'idle-results.json'),
    JSON.stringify({ at: new Date().toISOString(), pass, total: checks.length, checks }, null, 2)
  )
  app.exit(pass === checks.length ? 0 : 1)
})
