# 03 · 验证收尾（四条验收线 + 运行态截图）

Status: ready-for-agent
Blocked by: 01, 02
Blocks: —

spec 见 `../spec.md`（Testing Decisions 章）。

## 任务

1. `npm run typecheck` 零错误；`npm test` 62/62。
2. `npm run build` 后产物断言：`out/renderer` CSS 含 `#f0edda`/`#c96442`/`#4f5134`，不含 `#fafaf8`/`#d97706`（教训：源码存在 ≠ 产物存在）。
3. mac dev 运行态截图逐项核对：贴纸（奶油底/橄榄墨/衬线目标/砖橙滚入）、悬浮球+速记胶囊、右键菜单、任务行 hover 淡卡其、归档裂纹行。
4. 状态矩阵不回归：滚入=砖橙、置顶=紫、紧急=红、叠加 红>紫>橙、球裂缝红。
5. 证据（截图/结论）存本目录。
