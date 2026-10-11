# 失焦自动收起（blur-collapse）

2026-10-11 · 用户需求：展开期间点击页面外区域（桌面/其他应用）→ 自动收起成悬浮球图标圆。

## 行为定义

- 贴纸（note 形态）展开时，窗口失去焦点且 250ms 内焦点未回流 → 收起为悬浮球。
- 收起走 `setForm('ball', 'blur')`，与手动 × / Escape / M16 空闲收起完全同路（含 noteMode 落盘、诊断留痕 `form {to: ball, by: blur}`）。
- 菜单开着时一并 `closeMenu()`：窗口外的点击到不了页面 click 监听。

## 关键决策

| 决策 | 理由 |
| --- | --- |
| 主进程 `win.on('blur')` 为事件源，IPC 推送渲染层执行 | 渲染层收起路径是唯一入口（状态源原则）；主进程能处理托盘竞争与 devtools 例外 |
| **250ms 挂起、可撤销**，而非 blur 即发 | 托盘点击/第二实例抬前都发生在 blur 之后（Windows 托盘 click 松开才发，距 blur 常有上百 ms）。不挂起会「点托盘聚焦贴纸」→ 贴纸反被收掉。挂起由 `showNote()` 撤销，到期时二次核对 `win.isFocused()` |
| devtools 打开时不收 | 调试常态：devtools 窗口抢走主窗焦点 |
| **不做**输入框聚焦/归档打开排除（与 M16 空闲收起不同） | M16 排除是防「打断进行中的事」；blur 本身就是「人已离开」的明确信号。速记输入一半的内容是 DOM 状态，形变不销毁 DOM，展开即恢复，零损失。排除集越复杂行为越难预测 |
| 球形态 / 形变中（morphLock）不动作 | 无事可做；展开动画中被点外部由 morphLock 挡住，不会刚展开就被收走 |

## 实现位置

- `src/main/index.ts`：`blurCollapseTimer` + `win.on('blur')` + `showNote()` 撤销
- `src/preload/index.ts` + `src/renderer/src/env.d.ts`：`onBlurCollapse` 通道
- `src/renderer/src/main.ts`：接收 → `closeMenu()` + `setForm('ball', 'blur')`

## 验证

- `npm run typecheck` + `npm test` 全绿（既有 62 例无回归）
- 运行态实测（mac dev）：osascript 激活 Finder 触发 blur → 窗口 bounds 收成球形态尺寸、qink.log 留痕 `form {to: ball, by: blur}`；点回贴纸/点托盘不误收
