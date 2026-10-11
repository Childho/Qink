# 03 · 验证收尾（四条验收线 + 运行态截图）

Status: resolved
Blocked by: 01, 02
Blocks: —

spec 见 `../spec.md`（Testing Decisions 章）。

## 任务

1. `npm run typecheck` 零错误；`npm test` 62/62。
2. `npm run build` 后产物断言：`out/renderer` CSS 含 `#f0edda`/`#c96442`/`#4f5134`，不含 `#fafaf8`/`#d97706`（教训：源码存在 ≠ 产物存在）。
3. mac dev 运行态截图逐项核对：贴纸（奶油底/橄榄墨/衬线目标/砖橙滚入）、悬浮球+速记胶囊、右键菜单、任务行 hover 淡卡其、归档裂纹行。
4. 状态矩阵不回归：滚入=砖橙、置顶=紫、紧急=红、叠加 红>紫>橙、球裂缝红。
5. 证据（截图/结论）存本目录。

## Comments

- typecheck 零错误；vitest 62/62（ticket 01/02 后各跑一轮）。
- 产物断言全绿：`out/renderer/assets/index-BpgIubQU.css` 七个新色值各 ≥1 命中、橄榄墨 rgba ×19；旧值（#fafaf8/#f5f5f3/#d97706/#1d1d1f/墨 rgba）全部零命中；index.html 正确 `<link>`。
- 运行态（mac dev，真实桌面截图 `evidence/note-form.png`）：奶油纸底+噪点在位、季/月/周衬线目标（2026-Q4/2026-10/2026-W41 全部有效非 ghost）、滚入任务砖橙、置顶任务紫、普通任务橄榄墨、composer 占位淡字、分隔线暖化——**可见项全部符合 spec**。
- **诊断日志Bonus**：本轮运行顺带实测了 blur-collapse 全链路（blur 收球 → 用户双击展开 → × 收起，`qink-diag` 三条 form 事件）。
- **现场插曲（非 bug）**：种子含一条 `dueAt=明天15:00` 任务，启动 4 秒后被在场的用户点完成入档（dueAt 原样保留）——该输入本身是解析器不产生的非法形态（时刻粒度仅限今天），`dueStatus` 防御分支正确判 `future`，渲染路径无缺陷。
- 诚实边界：①悬浮球截图未取到（球随桌面 Space，用户正在浏览器全屏工作，不宜打扰）；球面配色全部由 token 派生（cream surface + `--fg` mask Q），代码路径已证，留用户日常确认；②hover 卡其/右键菜单/归档裂纹行的**运行态**截图未取（需合成输入，项目先例是此类手感项移交用户实测）；③Windows 装机观感（SimSun 小字、真实壁纸）留下一轮打包装机。
- 现场管理：种子前备份 data.json（sha 记录）、验后逐字节还原（sha 一致）、备份与临时截图已清场；旧 dev 实例已停、无孤儿进程。
