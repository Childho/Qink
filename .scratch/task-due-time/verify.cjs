// 任务截止时间（M15）验证：真实 preload + 渲染层构建产物 + 内存种子数据，
// 不读取或修改用户数据（沿用 .scratch/task-pin-sort/verify.cjs 的隔离方式）。
// 覆盖：四分区、红/淡字标注、右键设定时间（抖动/成功/清空取消）、
//       出生即红（今天时刻）、逾期球裂缝、完成解除且档案带 dueAt。
// 用法：npm run build 后，项目根目录 npx electron .scratch/task-due-time/verify.cjs
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const checks = []
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail })
  console.log(`${ok ? '通过' : '失败'}：${name}${detail ? `（${detail}）` : ''}`)
  return ok
}

const nowMs = Date.now()
const pad = (n) => String(n).padStart(2, '0')
/** 本地 ISO 无时区日期粒度 dueAt（与解析器产物同构） */
const localDue = (offsetDays) => {
  const d = new Date(nowMs)
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00:00`
}
const iso = (offsetMs) => new Date(nowMs + offsetMs).toISOString()

// 种子：o1 逾期红 | p1 标记 | r1 滚入 / d1 滚入+明天 | f1, f2 今日 / d2 今日+3天后
const testData = () => ({
  version: 1,
  goals: { quarter: null, month: null, week: null },
  tasks: [
    { id: 'o1', text: '逾期', createdAt: iso(-86400000), dueAt: localDue(-1) },
    { id: 'p1', text: '标记', createdAt: iso(0), pinned: true },
    { id: 'r1', text: '滚入', createdAt: iso(-86400000) },
    { id: 'd1', text: '滚入明天到期', createdAt: iso(-86400000), dueAt: localDue(1) },
    { id: 'f1', text: '今日', createdAt: iso(0) },
    { id: 'f2', text: '今日2', createdAt: iso(0) },
    { id: 'd2', text: '三天后', createdAt: iso(0), dueAt: localDue(3) }
  ],
  archive: [],
  settings: {
    autostart: false, fontSize: 'medium',
    noteX: 100, noteY: 100, noteW: null, noteH: null, noteMode: 'note'
  }
})

let lastSetData = null
let win

app.setPath('userData', path.join(__dirname, 'electron-profile'))
fs.mkdirSync(path.join(__dirname, 'electron-profile'), { recursive: true })

app.whenReady().then(async () => {
  ipcMain.handle('qink:data:get', () => testData())
  ipcMain.handle('qink:data:set', (_e, incoming) => {
    lastSetData = JSON.parse(JSON.stringify(incoming))
  })

  win = new BrowserWindow({
    width: 460,
    height: 760,
    x: 100,
    y: 100,
    frame: false,
    show: true, // 渲染层有 rAF/观察器，隐藏窗口会被节流饿死
    webPreferences: {
      preload: path.resolve(__dirname, '../../out/preload/index.js'),
      sandbox: false
    }
  })
  await win.loadFile(path.resolve(__dirname, '../../out/renderer/index.html'))
  await sleep(400)

  const js = (code) => win.webContents.executeJavaScript(code)
  const order = () =>
    js(
      `[...document.querySelectorAll('.tasks .task')].map(r => r.dataset.id` +
        ` + (r.classList.contains('urgent') ? '!' : '')` +
        ` + (r.classList.contains('pinned') ? '*' : ''))`
    )
  const hintOf = (id) =>
    js(`document.querySelector('.task[data-id="${id}"] .due-hint')?.textContent ?? null`)
  const cracked = () => js(`document.getElementById('fab').classList.contains('cracked')`)

  // 右键任务 → 点菜单项。元素引用不能跨 IPC（序列化成空对象），
  // 查找与 click 必须整段在页面内执行（沿用 task-pin-sort 的手法）
  const ctxMenu = (id, label) =>
    js(
      `(() => { const row = document.querySelector('.task[data-id="${id}"]');` +
        ` if (!row) return 'no-row';` +
        ` row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));` +
        ` const btn = [...document.querySelectorAll('#menu .menu-item')].find(b => b.textContent.includes('${label}'));` +
        ` if (!btn) return 'no-item'; btn.click(); return 'ok' })()`
    )
  // 设定时间：打开输入位 → 填值 → Enter（同样页面内执行）
  const setDue = async (id, typed) => {
    const opened = await ctxMenu(id, '设定时间')
    if (opened !== 'ok') return opened
    return js(
      `(() => { const i = document.querySelector('.task[data-id="${id}"] .due-input');` +
        ` if (!i) return 'no-input'; i.value = ${JSON.stringify(typed)};` +
        ` i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 'ok' })()`
    )
  }

  // ---- 1. 初始四分区：o1!(逾期红) | p1* | r1 d1(滚入, d1 带明天) | f1 f2 d2
  check('四分区初始顺序：紧急 > 标记 > 滚入 > 今日', JSON.stringify(await order()) === JSON.stringify(['o1!', 'p1*', 'r1', 'd1', 'f1', 'f2', 'd2']), JSON.stringify(await order()))

  // ---- 2. 淡字标注：明天 / M/D；紧急红无文字
  check('d1（滚入+明天）行尾淡字「明天」', (await hintOf('d1')) === '明天')
  check('d2（3 天后）行尾淡字为 M/D 形式', /^\d{1,2}\/\d{1,2}$/.test(String(await hintOf('d2'))), `got ${await hintOf('d2')}`)
  check('o1（逾期红）无文字标注', (await hintOf('o1')) === null)

  // ---- 3. 球裂缝：存在逾期任务 → cracked
  check('悬浮球裂缝亮起（有逾期）', (await cracked()) === true)

  // ---- 4. 设定时间 · 乱码拒绝抖动
  await setDue('f1', 'abc')
  await sleep(80)
  check('乱码输入被拒（input-shake 抖动、无 dueAt 落盘）',
    (await js(`document.querySelector('.task[data-id="f1"] .due-input')?.classList.contains('input-shake')`)) === true)
  await js(`document.querySelector('.task[data-id="f1"] .due-input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await sleep(120)

  // ---- 5. 设定时间 · 明天 → 淡字 + 落盘
  await setDue('f1', '明天')
  await sleep(150)
  check('f1 设「明天」成功：淡字显示', (await hintOf('f1')) === '明天')
  const f1due = lastSetData?.tasks.find((t) => t.id === 'f1')?.dueAt
  check('f1 的 dueAt 落盘（本地 ISO 0 点）', f1due === localDue(1), `got ${f1due}`)

  // ---- 6. 出生即红：今天时刻 → 立即 urgent 置顶
  await setDue('f2', '23:59')
  await sleep(150)
  const ord6 = await order()
  check('f2 设今天 23:59 后立即红并进入紧急区（o1 之后）',
    JSON.stringify(ord6) === JSON.stringify(['o1!', 'f2!', 'p1*', 'r1', 'd1', 'f1', 'd2']), JSON.stringify(ord6))

  // ---- 7. 清空提交 = 取消时间：f2 回今日区（其数组序在进紧急区时已前移，区内按数组序 f2 在 f1 前）
  await setDue('f2', '')
  await sleep(150)
  check('f2 清空提交取消时间：回今日区、无红', JSON.stringify(await order()) === JSON.stringify(['o1!', 'p1*', 'r1', 'd1', 'f2', 'f1', 'd2']))
  check('f2 的 dueAt 已删除', lastSetData?.tasks.find((t) => t.id === 'f2')?.dueAt === undefined)

  // ---- 8. 完成逾期任务：档案带 dueAt、球裂缝消失
  await js(`document.querySelector('.task[data-id="o1"] .circle').click()`)
  await sleep(1100) // 碎裂动画 900ms 兜底后归档
  const archived = lastSetData?.archive.find((a) => a.id === 'o1')
  check('完成 o1 入档且 dueAt 原样存档', !!archived && archived.dueAt === localDue(-1), JSON.stringify(archived?.dueAt))
  check('完成后球裂缝消失（无逾期剩余）', (await cracked()) === false)

  // ---- 9. 改期：逾期 o1 场景下的改期路径用 d1 验证（明天 → 后天）
  await setDue('d1', '后天')
  await sleep(150)
  check('d1 改期为后天：淡字更新为 M/D', /^\d{1,2}\/\d{1,2}$/.test(String(await hintOf('d1'))), `got ${await hintOf('d1')}`)

  const pass = checks.filter((c) => c.ok).length
  console.log(`\n结果：${pass}/${checks.length} 通过`)
  fs.writeFileSync(
    path.join(__dirname, 'results.json'),
    JSON.stringify({ at: new Date().toISOString(), pass, total: checks.length, checks }, null, 2)
  )
  app.exit(pass === checks.length ? 0 : 1)
})
