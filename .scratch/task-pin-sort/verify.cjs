// 任务标记置顶（双击紫色）+ 拖动排序验证：
// 真实 preload 构建产物 + 渲染层构建产物 + 内存种子数据，不读取或修改用户数据
//（沿用 .scratch/adaptive-height/verify.cjs 的隔离方式）。
// 用法：npm run build 后，项目根目录 npx electron .scratch/task-pin-sort/verify.cjs
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

// 种子：3 条滚入（昨天创建）+ 4 条今日，id 即断言锚点
const nowMs = Date.now()
const testData = () => ({
  version: 1,
  goals: { quarter: null, month: null, week: null },
  tasks: [
    { id: 'r1', text: '滚入1', createdAt: new Date(nowMs - 86400000).toISOString() },
    { id: 'r2', text: '滚入2', createdAt: new Date(nowMs - 86400000).toISOString() },
    { id: 'r3', text: '滚入3', createdAt: new Date(nowMs - 86400000).toISOString() },
    { id: 'f1', text: '今日1', createdAt: new Date(nowMs).toISOString() },
    { id: 'f2', text: '今日2', createdAt: new Date(nowMs).toISOString() },
    { id: 'f3', text: '今日3', createdAt: new Date(nowMs).toISOString() },
    { id: 'f4', text: '今日4', createdAt: new Date(nowMs).toISOString() }
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
    height: 700,
    x: 100,
    y: 100,
    frame: false,
    show: true, // 可见：渲染层有 rAF/观察器，隐藏窗口会被节流饿死
    webPreferences: {
      preload: path.resolve(__dirname, '../../out/preload/index.js'),
      sandbox: false
    }
  })
  await win.loadFile(path.resolve(__dirname, '../../out/renderer/index.html'))

  // ---- 探针与合成手势 ----
  const order = () =>
    win.webContents.executeJavaScript(
      `[...document.querySelectorAll('.tasks .task')].map(r => r.dataset.id + (r.classList.contains('pinned') ? '*' : ''))`
    )
  const js = (code) => win.webContents.executeJavaScript(code)

  // 单击/双击走真实 click→click→dblclick 序列（单击改写是 260ms 延迟判定，统一等 450ms）
  const clickSeq = (id, types) =>
    js(`(() => {
      const el = document.querySelector('.task[data-id="${id}"] .text')
      for (const t of ${JSON.stringify(types)}) el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }))
    })()`)

  // 行拖动：pointerdown 在行上、move/up 在 window 上（与 wireTaskDrag 的监听一致），clientY 用真实 rect
  const dragRow = async (id, dy, pointerId = 11) => {
    await js(`(() => {
      const el = document.querySelector('.task[data-id="${id}"]')
      const r = el.getBoundingClientRect()
      const x = r.left + 30, y = r.top + r.height / 2
      const opt = { bubbles: true, cancelable: true, pointerId: ${pointerId}, button: 0 }
      el.dispatchEvent(new PointerEvent('pointerdown', { ...opt, clientX: x, clientY: y }))
      window.dispatchEvent(new PointerEvent('pointermove', { ...opt, buttons: 1, clientX: x, clientY: y + (${dy}) }))
      window.dispatchEvent(new PointerEvent('pointerup', { ...opt, buttons: 0, clientX: x, clientY: y + (${dy}) }))
    })()`)
    await sleep(450) // 等 FLIP 落位 + 260ms 编辑窗口过去
  }

  // 等初始渲染
  for (let i = 0; i < 40; i++) {
    const n = await js(`document.querySelectorAll('.tasks .task').length`)
    if (n === 7) break
    await sleep(250)
  }

  // ---- A1 初始分区 ----
  check('A1 初始顺序：滚入 3 条在上 + 今日 4 条在下',
    JSON.stringify(await order()) === JSON.stringify(['r1', 'r2', 'r3', 'f1', 'f2', 'f3', 'f4']),
    (await order()).join(','))

  // ---- A2 双击标记：紫色置顶 + 落盘 ----
  await clickSeq('f1', ['click', 'click', 'dblclick'])
  check('A2 双击 f1 → 置顶第一位且带 pinned 类',
    JSON.stringify(await order()) === JSON.stringify(['f1*', 'r1', 'r2', 'r3', 'f2', 'f3', 'f4']),
    (await order()).join(','))
  check('A2 落盘：tasks[0] = f1 且 pinned=true',
    lastSetData?.tasks?.[0]?.id === 'f1' && lastSetData.tasks[0].pinned === true,
    JSON.stringify(lastSetData?.tasks?.[0]))
  {
    const ring = await js(`getComputedStyle(document.querySelector('.task[data-id="f1"] .circle')).borderColor`)
    const ink = await js(`getComputedStyle(document.querySelector('.task[data-id="f1"] .text')).color`)
    check('A2 标记行样式生效：圆圈紫边 + 文字紫墨',
      ring === 'rgb(124, 58, 237)' && ink === 'rgb(91, 33, 182)', `circle=${ring} text=${ink}`)
  }

  // ---- A3 再双击取消：回原位 ----
  await clickSeq('f1', ['click', 'click', 'dblclick'])
  check('A3 再双击 f1 → 取消标记回到今日区首位',
    JSON.stringify(await order()) === JSON.stringify(['r1', 'r2', 'r3', 'f1', 'f2', 'f3', 'f4']),
    (await order()).join(','))

  // ---- A4 拖动排序：f2 下移越过 f3 ----
  await dragRow('f2', 40)
  check('A4 f2 下移 40px → 与 f3 交换',
    JSON.stringify(await order()) === JSON.stringify(['r1', 'r2', 'r3', 'f1', 'f3', 'f2', 'f4']),
    (await order()).join(','))
  check('A4 落盘数组顺序 = 显示顺序（不变量）',
    JSON.stringify(lastSetData?.tasks?.map((t) => t.id)) === JSON.stringify(['r1', 'r2', 'r3', 'f1', 'f3', 'f2', 'f4']),
    JSON.stringify(lastSetData?.tasks?.map((t) => t.id)))

  // ---- A5 拖动钳制：f4 拖到顶不越过滚入区 ----
  await dragRow('f4', -300)
  check('A5 f4 拖到最顶 → 钳制在今日区首位（滚入 3 条仍在上）',
    JSON.stringify(await order()) === JSON.stringify(['r1', 'r2', 'r3', 'f4', 'f1', 'f3', 'f2']),
    (await order()).join(','))

  // ---- A6 拖动中途视觉 + 松手复位 ----
  await js(`(() => {
    const el = document.querySelector('.task[data-id="f1"]')
    const r = el.getBoundingClientRect()
    const x = r.left + 30, y = r.top + r.height / 2
    const opt = { bubbles: true, cancelable: true, pointerId: 12, button: 0 }
    el.dispatchEvent(new PointerEvent('pointerdown', { ...opt, clientX: x, clientY: y }))
    window.dispatchEvent(new PointerEvent('pointermove', { ...opt, buttons: 1, clientX: x, clientY: y + 40 }))
  })()`)
  const mid = await js(`(() => {
    const drag = document.querySelector('.task.drag-sorting')
    return {
      dragging: !!drag,
      lifted: !!drag && getComputedStyle(drag).boxShadow !== 'none',
      shifted: [...document.querySelectorAll('.tasks .task')].filter(r => r.style.transform).length
    }
  })()`)
  await js(`window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 12, button: 0, buttons: 0 }))`)
  await sleep(80) // 落位动画进行中（300ms 后才重建）
  const landing = await js(`(() => {
    const el = document.querySelector('.task[data-id="f1"]')
    return { dragging: !!document.querySelector('.task.drag-sorting'), tf: el.style.transform || '' }
  })()`)
  await sleep(450) // 等落位动画演完 + 重建净化
  const after = await js(`(() => ({
    dragging: !!document.querySelector('.task.drag-sorting'),
    residual: [...document.querySelectorAll('.tasks .task')].filter(r => r.style.transform).length
  }))()`)
  check('A6 拖动中被拖行带 drag-sorting 类、浮起带影且 1 行让位',
    mid.dragging && mid.lifted && mid.shifted === 2 /* 被拖行 + 1 让位行 */,
    JSON.stringify(mid))
  check('A6 松手进入落位动画：浮起类立即撤下、被拖行带内联位移滑向槽位',
    !landing.dragging && landing.tf.includes('translateY'), JSON.stringify(landing))
  check('A6 落位演完后重建净化：无 drag-sorting 残留、transform 全清',
    !after.dragging && after.residual === 0, JSON.stringify(after))

  // ---- A7 单击改写（260ms 延迟后进入编辑） ----
  await clickSeq('f1', ['click'])
  await sleep(450)
  check('A7 单击 f1 → 延迟后出现改写输入框', await js(`!!document.querySelector('.task[data-id="f1"] input.task-input')`))
  await js(`document.querySelector('.task[data-id="f1"] input.task-input')
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await sleep(100)
  check('A7 Escape 退出编辑', !(await js(`!!document.querySelector('.task input.task-input')`)))

  // ---- A8 双击不误进编辑 ----
  await clickSeq('f1', ['click', 'click', 'dblclick'])
  await sleep(450)
  check('A8 双击 f1 → 不出现改写输入框且标记生效',
    !(await js(`!!document.querySelector('.task input.task-input')`)) &&
    JSON.stringify(await order()) === JSON.stringify(['f1*', 'r1', 'r2', 'r3', 'f4', 'f3', 'f2']),
    (await order()).join(','))
  await clickSeq('f1', ['click', 'click', 'dblclick']) // 复位种子状态
  await sleep(450)

  fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify({ checks }, null, 2))
  const failed = checks.filter((c) => !c.ok).length
  console.log(`\n${checks.length - failed}/${checks.length} 项通过`)
  app.exit(failed ? 1 : 0)
})
