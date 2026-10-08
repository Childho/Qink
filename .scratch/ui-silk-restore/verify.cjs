// UI 丝滑动效还原验证：真实 out/renderer + 真实 preload（out/preload），
// 本脚本扮演主进程（窗口几何按 src/main 规则模拟），逐帧采样形变过程证明无瞬移。
// 只用内存数据，不读写用户任务。
const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const dir = __dirname
app.setPath('userData', path.join(dir, 'electron-profile'))
app.commandLine.appendSwitch('disable-renderer-backgrounding')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const checks = []
const check = (name, cond) => {
  assert.ok(cond, name)
  checks.push(name)
  console.log('通过：' + name)
}

// 种子数据（与原型演示数据同构：2 条昨日滚入 + 3 条今日 + 6 条已完成）
const NOW0 = new Date()
const atDay = (offset, h, mi) => {
  const t = new Date(NOW0.getFullYear(), NOW0.getMonth(), NOW0.getDate())
  t.setDate(t.getDate() + offset)
  t.setHours(h, mi || 0, 0, 0)
  return t.toISOString()
}
let data = {
  version: 1,
  goals: {
    quarter: { periodKey: '2026-Q3', text: '发布 Qink 第一版' },
    month: { periodKey: '2026-09', text: '邀请 10 位同事内测' },
    week: null
  },
  tasks: [
    { id: 's1', text: '给妈妈打电话', createdAt: atDay(-1, 9, 5) },
    { id: 's2', text: '整理周三会议纪要', createdAt: atDay(-1, 11, 40) },
    { id: 's3', text: '写周报', createdAt: atDay(0, 8, 30) },
    { id: 's4', text: 'review PR', createdAt: atDay(0, 9, 10) },
    { id: 's5', text: '预约周末羽毛球场地', createdAt: atDay(0, 10, 2) }
  ],
  archive: [
    { id: 'a1', text: '早跑 5 公里', createdAt: atDay(-1, 20, 0), completedAt: atDay(0, 7, 40) },
    { id: 'a2', text: '回复客户邮件', createdAt: atDay(-2, 8, 50), completedAt: atDay(-1, 10, 20) },
    { id: 'a3', text: '提交报销单', createdAt: atDay(-2, 9, 30), completedAt: atDay(-1, 15, 5) },
    { id: 'a4', text: '读 30 页《卡片笔记》', createdAt: atDay(-2, 10, 0), completedAt: atDay(-1, 21, 30) },
    { id: 'a5', text: '修好阳台纱窗', createdAt: atDay(-3, 9, 0), completedAt: atDay(-2, 11, 0) },
    { id: 'a6', text: '给绿萝换水', createdAt: atDay(-3, 9, 10), completedAt: atDay(-2, 19, 40) }
  ],
  settings: { autostart: false, fontSize: 'medium', noteX: null, noteY: null, noteW: null, noteH: null, noteMode: 'note' }
}

const NOTE_INSET_X = 56
const NOTE_INSET_Y = 40
const NOTE_INSET_BOTTOM = 88
const BALL_INSET_X = 272
const BALL_SIZE = 56
const winWFor = (form, noteW) => (form === 'ball' ? BALL_SIZE + BALL_INSET_X * 2 : noteW + NOTE_INSET_X * 2)
const winHFor = (h) => h + NOTE_INSET_Y + NOTE_INSET_BOTTOM
const AREA = { x: 0, y: 0, width: 960, height: 800 }

app.whenReady().then(async () => {
  ipcMain.handle('qink:data:get', () => data)
  ipcMain.handle('qink:data:set', (_e, incoming) => { data = incoming })
  ipcMain.handle('qink:autostart', () => {})
  ipcMain.handle('qink:open-data-folder', () => {})
  ipcMain.handle('qink:work-area', () => AREA)
  ipcMain.on('qink:quit', () => app.quit())
  ipcMain.on('qink:mouse-ignore', () => {})

  const win = new BrowserWindow({
    width: 960,
    height: 800,
    x: 0,
    y: 0,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: {
      preload: path.resolve(__dirname, '../../out/preload/index.js'),
      backgroundThrottling: false,
      offscreen: true
    }
  })
  const winMoves = []
  win.on('move', () => winMoves.push({ t: Date.now(), ...win.getBounds() }))
  let dragAnchor = null
  ipcMain.on('qink:drag-start', () => { dragAnchor = { ...win.getBounds() } })
  ipcMain.on('qink:drag-move', (_e, dx, dy) => {
    if (!dragAnchor) return
    win.setBounds({ x: dragAnchor.x + dx, y: dragAnchor.y + dy, width: dragAnchor.width, height: dragAnchor.height })
  })
  ipcMain.on('qink:drag-end', () => { dragAnchor = null })
  ipcMain.on('qink:note-resize', (_e, w, h, wantX) => {
    const hh = Math.max(280, Math.min(h, AREA.height - NOTE_INSET_Y - NOTE_INSET_BOTTOM))
    const b = win.getBounds()
    win.setBounds({ x: typeof wantX === 'number' ? wantX : b.x, y: b.y, width: w + NOTE_INSET_X * 2, height: hh + NOTE_INSET_Y + NOTE_INSET_BOTTOM })
    if (hh < h) win.webContents.send('qink:note-capped', hh)
  })
  ipcMain.handle('qink:form-change', (_e, mode) => {
    const b = win.getBounds()
    const w = mode === 'ball' ? BALL_SIZE : 320
    // 与主进程同规则：x 不动（形变连续性的承重墙），只换宽高
    win.setBounds({ x: b.x, y: b.y, width: winWFor(mode, w), height: winHFor(mode === 'ball' ? BALL_SIZE : Math.max(420, b.height - NOTE_INSET_Y - NOTE_INSET_BOTTOM)) })
    win.webContents.send('qink:win-pos', b.x, b.y)
  })

  const errors = []
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error') { errors.push(e.message); console.error('渲染错误：', e.message) }
  })
  await win.loadFile(path.resolve(__dirname, '../../out/renderer/index.html'))
  await sleep(900)
  const run = async (script) => {
    try { return await win.webContents.executeJavaScript(script) } catch (error) { console.error('失败脚本：', script.slice(0, 120)); throw error }
  }

  const paint = async (name) => {
    fs.writeFileSync(path.join(dir, name), await win.webContents.capturePage().then((img) => img.toPNG()))
  }

  // ---- 静态结构：还原进构建产物里的关键规则 ----
  const cssText = await run(`Array.from(document.styleSheets).flatMap(s => { try { return Array.from(s.cssRules).map(r => r.cssText) } catch { return [] } }).join('\\n')`)
  check('任务行 hover 底色已还原', /\.task:hover\{[^}]*background:\s*rgba\(29,\s*29,\s*31,\s*0\.04\)/.test(cssText.replace(/\s/g, '')))
  check('完成圈按压反馈已还原', /\.circle:active\{[^}]*transform:scale\(0\.85\)/.test(cssText.replace(/\s/g, '')))
  check('形变过渡包含 left（滑向球锚）', /#note\.morphing\{[^}]*transition:[^}]*left/.test(cssText.replace(/\s/g, '')))
  check('goals 原生滚动条已隐藏', /scrollbar-width:none/.test(cssText.replace(/\s/g, '')))
  check('拖起阴影抬升已接 token', /#note\.dragging\{[^}]*--shadow-raised/.test(cssText.replace(/\s/g, '')))

  await paint('01-note-default.png')

  // ---- 逐帧采样器：记录 note/dock 矩形 + 显示状态 ----
  const installSampler = () => run(`(() => {
    window.__samples = []
    const t0 = performance.now()
    const note = document.getElementById('note')
    const dock = document.getElementById('dock')
    const step = () => {
      const n = note.getBoundingClientRect()
      const d = dock.getBoundingClientRect()
      window.__samples.push({
        t: Math.round(performance.now() - t0),
        nx: +n.x.toFixed(1), ny: +n.y.toFixed(1), nw: +n.width.toFixed(1),
        noteOn: getComputedStyle(note).display !== 'none',
        dx: +d.x.toFixed(1), dy: +d.y.toFixed(1), dw: +d.width.toFixed(1),
        dockOn: getComputedStyle(dock).display !== 'none'
      })
      if (performance.now() - t0 < 1600) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
    return true
  })()`)

  const analyze = async (label, kind) => {
    // kind 'collapse'：贴纸可见帧从 (56,320) 滑到球锚 (272,56)，球接棒时贴纸未消失
    // kind 'expand'：贴纸首帧盖住球 (272,56)，滑回锚位 (56,320)；dock 末帧与贴纸首帧同位
    const s = await run('window.__samples')
    fs.writeFileSync(path.join(dir, `samples-${label}.json`), JSON.stringify(s, null, 1))
    const active = s.filter((p) => p.noteOn)
    assert.ok(active.length > 20, `${label}：采样到足够的贴纸活动帧`)
    let maxJump = 0
    for (let i = 1; i < active.length; i++) {
      if (active[i].nw === 0) continue
      maxJump = Math.max(maxJump, Math.abs(active[i].nx - active[i - 1].nx))
    }
    check(`${label}：相邻帧无瞬移（最大帧差 ${maxJump}px ≤ 45px）`, maxJump <= 45)
    const first = active[0]
    const last = active[active.length - 1]
    if (kind === 'collapse') {
      check(`${label}：起点在贴纸锚 x≈56 宽 320（实际 ${first.nx}/${first.nw}）`, Math.abs(first.nx - 56) <= 2 && Math.abs(first.nw - 320) <= 4)
      check(`${label}：落点在球锚 x≈272 宽 56（实际 ${last.nx}/${last.nw}）`, Math.abs(last.nx - 272) <= 8 && Math.abs(last.nw - 56) <= 4)
      const handover = s.find((p) => p.dockOn)
      check(`${label}：球接棒时贴纸仍在滑行（交接无空窗）`, handover && s[s.indexOf(handover) - 1] && s[s.indexOf(handover)].noteOn)
    } else {
      check(`${label}：起始帧盖住球 x≈272 宽 56（实际 ${first.nx}/${first.nw}）`, Math.abs(first.nx - 272) <= 8 && Math.abs(first.nw - 56) <= 4)
      check(`${label}：落回贴纸锚 x≈56 宽 320（实际 ${last.nx}/${last.nw}）`, Math.abs(last.nx - 56) <= 2 && Math.abs(last.nw - 320) <= 4)
      const dockFrames = s.filter((p) => p.dockOn)
      // 球→贴纸换影常在单帧内完成（IPC 微任务快于 rAF），采样不到 dock 属预期；
      // 只要采到，就必须在 x≈272 与贴纸起点同位
      check(`${label}：球隐没位置与贴纸起点同位（采样 ${dockFrames.length} 帧${dockFrames.length ? '，x=' + dockFrames[dockFrames.length - 1].dx : '，单帧换影'}）`, dockFrames.length === 0 || Math.abs(dockFrames[dockFrames.length - 1].dx - 272) <= 2)
    }
    return s
  }

  // ---- 收起形变：贴纸 → 球 ----
  await run(`(() => {
    window.__samples = []
    const t0 = performance.now()
    const note = document.getElementById('note')
    const dock = document.getElementById('dock')
    const step = () => {
      const n = note.getBoundingClientRect()
      const d = dock.getBoundingClientRect()
      window.__samples.push({
        t: Math.round(performance.now() - t0),
        nx: +n.x.toFixed(1), ny: +n.y.toFixed(1), nw: +n.width.toFixed(1),
        noteOn: getComputedStyle(note).display !== 'none',
        dx: +d.x.toFixed(1), dy: +d.y.toFixed(1), dw: +d.width.toFixed(1),
        dockOn: getComputedStyle(dock).display !== 'none'
      })
      if (performance.now() - t0 < 1600) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
    document.querySelector('.note-close').click()
    return true
  })()`)
  await sleep(1500)
  const collapse = await analyze('collapse', 'collapse')
  const handover = collapse.findIndex((p) => p.dockOn)
  check('收起：球接棒时贴纸仍在滑行（交接无空窗）', handover > 0 && collapse[handover].noteOn)
  const winAfterCollapse = win.getBounds()
  check('收起：窗口 x 全程未动（无 move 事件或 x 恒定）', (winMoves.length === 0 || winMoves.every((m) => Math.abs(m.x - winMoves[0].x) <= 1)) && Math.abs(winAfterCollapse.x - (winMoves[0] ? winMoves[0].x : winAfterCollapse.x)) <= 1)
  await paint('02-ball.png')

  // ---- 球形态：速记胶囊展开 + 速记提交（红裂缝不得闪现）----
  await run(`document.getElementById('dock').classList.add('quick-open')`)
  await sleep(400)
  await paint('03-ball-quick.png')
  await run(`(() => {
    const input = document.getElementById('quick-input')
    input.focus()
    input.value = '玻璃碎片收拢测试'
    window.__crackSamples = []
    const crack = document.querySelector('#fab .crack')
    const t0 = performance.now()
    const step = () => {
      window.__crackSamples.push(+getComputedStyle(crack).opacity)
      if (performance.now() - t0 < 800) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    return true
  })()`)
  await sleep(900)
  const crackMax = Math.max(...(await run('window.__crackSamples')))
  check(`速记提交：红裂缝全程不亮（峰值 opacity ${crackMax} < 0.05）`, crackMax < 0.05)
  check('速记提交：任务已落盘（球形态）', data.tasks.some((t) => t.text === '玻璃碎片收拢测试'))

  // ---- 展开形变：球 → 贴纸 ----
  await run(`document.getElementById('dock').classList.remove('quick-open'); document.getElementById('quick-input').blur()`)
  await sleep(300)
  const winBeforeExpand = win.getBounds()
  await run(`(() => {
    window.__samples = []
    const t0 = performance.now()
    const note = document.getElementById('note')
    const dock = document.getElementById('dock')
    const step = () => {
      const n = note.getBoundingClientRect()
      const d = dock.getBoundingClientRect()
      window.__samples.push({
        t: Math.round(performance.now() - t0),
        nx: +n.x.toFixed(1), ny: +n.y.toFixed(1), nw: +n.width.toFixed(1),
        noteOn: getComputedStyle(note).display !== 'none',
        dx: +d.x.toFixed(1), dy: +d.y.toFixed(1), dw: +d.width.toFixed(1),
        dockOn: getComputedStyle(dock).display !== 'none'
      })
      if (performance.now() - t0 < 1600) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
    document.getElementById('dock').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    return true
  })()`)
  await sleep(1600)
  await analyze('expand', 'expand')
  const s2 = await run('window.__samples')
  const firstNote = s2.find((p) => p.noteOn)
  check(`展开：贴纸起始帧在球位 x≈272（实际 ${firstNote && firstNote.nx}）`, firstNote && Math.abs(firstNote.nx - 272) <= 8)
  check('展开：窗口 x 全程未动', win.getBounds().x === winBeforeExpand.x)
  await sleep(400)
  await paint('04-note-expanded.png')

  // ---- 已完成清单（碎裂语言）----
  await run(`document.querySelector('.tasks').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 160, clientY: 380 })); Array.from(document.querySelectorAll('.menu-item')).find((e) => e.textContent === '已完成清单').click()`)
  await sleep(1400)
  check('已完成清单可打开', await run(`!!document.querySelector('.archive-row')`))
  await paint('05-archive.png')
  await run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await sleep(900)
  check('清单 Esc 退出后任务区恢复', await run(`!document.querySelector('.archive') && !!document.querySelector('.composer-hint')`))

  // ---- 收起后再展开一轮（回归：状态清理干净）----
  await installSampler()
  await run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await sleep(1500)
  await analyze('collapse-2nd', 'collapse')
  await run(`(() => {
    window.__samples = []
    const t0 = performance.now()
    const note = document.getElementById('note')
    const dock = document.getElementById('dock')
    const step = () => {
      const n = note.getBoundingClientRect()
      const d = dock.getBoundingClientRect()
      window.__samples.push({
        t: Math.round(performance.now() - t0),
        nx: +n.x.toFixed(1), ny: +n.y.toFixed(1), nw: +n.width.toFixed(1),
        noteOn: getComputedStyle(note).display !== 'none',
        dx: +d.x.toFixed(1), dy: +d.y.toFixed(1), dw: +d.width.toFixed(1),
        dockOn: getComputedStyle(dock).display !== 'none'
      })
      if (performance.now() - t0 < 1600) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
    document.getElementById('dock').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    return true
  })()`)
  await sleep(1600)
  await analyze('expand-2nd', 'expand')
  check('第二轮形变后贴纸锚回 x=56', await run(`Math.abs(document.getElementById('note').getBoundingClientRect().x - 56) < 2`))
  check('渲染全程无报错', errors.length === 0)

  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ checks, errors }, null, 2))
  console.log('\\n全部通过：' + checks.length + ' 项')
  win.destroy()
  app.quit()
}).catch((error) => {
  console.error(error)
  fs.writeFileSync(path.join(dir, 'failure.txt'), String(error.stack))
  app.exit(1)
})
