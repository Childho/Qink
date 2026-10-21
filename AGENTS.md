# AGENTS.md

## 本项目：Qink

一张常驻 Windows 桌面的哑光纸感便利贴：季/月/周核心目标 + 今日任务（碎裂完成、滚入砖橙、已完成清单手势）。规格见 `.scratch/qink-phase1/spec.md`，术语见 `CONTEXT.md`，重大决策见 `docs/adr/`。

- 常用命令：`npm run dev`（开发）· `npm test`（vitest）· `npm run typecheck` · `npm run package`（打包；本机网络需带两个镜像变量 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`——前者管 Electron 本体、后者管 NSIS 等构建器二进制，缺任一都会卡 GitHub 超时；`dist/win-unpacked` 被占 EPERM 时先清目录）
- 技术栈：Electron 38 + electron-vite 5 + TypeScript，原生 DOM 无前端框架
- 目录：`src/main`（窗口/托盘/数据）· `src/preload`（IPC 桥）· `src/renderer`（UI/手势/动画）· `src/shared`（纯逻辑，单测覆盖）· `tests/`
- 图标资产：品牌源图 `build/logo/qink.jpg` → `scripts/export-logo.ps1`（GDI+ 导出圆角片/墨色 Q）→ `scripts/gen-icons.mjs` / `gen-tray.mjs`（打包 exe ico、托盘与悬浮球 data URL）；`src/main/tray-icon.ts` 与 `src/renderer/src/logo.ts` 是生成物，勿手改
- 数据：`文档\Qink\data.json`（AppData 留备份双写；读写策略在 `src/main/store-io.ts`：原子写/坏档留证 `.corrupt`/退出冲刷，ADR-0009）；诊断日志 `userData/qink.log`（`src/main/diag.ts`：boot/quit/崩溃自愈/电源/显示器/形态切换留痕，现场「消失」类反馈先看它对时间线）
- 注意：改主进程/preload 必须完全重启 dev——electron-vite 只对渲染层热更新；dev 与装机版共用 `%APPDATA%\qink`（单实例锁互斥）：跑 dev 前先 `Stop-Process -Name Qink`，TaskStop 停 dev 会留孤儿 electron.exe 占锁（下次 dev 静默 exit 0 的元凶），一并清掉
- 当前状态：第一阶段（M1–M9）、UI 迭代（M10–M14、置顶排序、全面审查）、品牌 logo、任务截止时间（M15，2026-09-27：可选 dueAt、<24h 自动置顶红、逾期球裂缝，spec 在 `.scratch/task-due-time/`）、空闲自动收起（M16，2026-09-27：展开 10 分钟无交互收成悬浮球）已交付装机；阴影四档收敛（2026-09-27，ADR-0008：`:root` 四档墨色阴影 token，禁止元素自定参数）已交付装机；UI 丝滑动效修复与还原（2026-09-27：形态切换 216px 瞬移/展开吸附/min-height 托底/速记红裂缝闪现修复，任务行 hover 与按压反馈等细节还原，验收 `.scratch/ui-silk-restore/`）；安装包副本另存分发；已开源至 https://github.com/Childho/Qink（公开，MIT，2026-10-08 上传）；产品×工程第二轮全面审查（2026-10-09，`docs/review/06-product-audit-2026-10.md`：P0×2=核心目标空窗/双坏清零，9/11 旧 P1 零修复，6 项迭代排序，最终裁决数据耐久优先）；迭代①数据耐久三件套已交付（2026-10-09，ADR-0009：原子写/坏档留证/退出冲刷，`store-io.ts` + store.test.ts 10 例、62/62 绿）；迭代②「图标消失」防御加固已交付（2026-10-09，装机用户反馈触发：渲染层死亡自愈 123ms/电源与显示器事件回钳+轻推重绘/异常留痕/qink.log 现场诊断，红→绿实跑验证）；迭代③托盘置顶/取消置顶已交付（2026-10-09：删幽灵菜单项「显示贴纸」，checkbox 置顶、`screen-saver` 最高层级、minimize 拦截抗 Win+D、持久化+渲染层反向同步，运行态实测通过）；**三迭代已随 0.2.0 打包装机（2026-10-09，分发副本 `E:\下载\Qink-Setup-0.2.0.exe`，用户已实测托盘置顶勾选）**；失焦自动收起已交付（2026-10-11，blur-collapse：贴纸展开时点击窗口外 250ms 收成球，`qink:blur-collapse` 通道；挂起可被托盘抬前/右键托盘撤销防误收；与 M16 不同——不做输入框/归档排除，收起不销毁 DOM 零损失；spec `.scratch/blur-collapse/`；mac 运行态实测两收一展全链路，Windows 托盘两路径与打包装机待做；本次开发在 mac 环境，依赖已装齐）；暖纸换肤已交付并合入 main（2026-10-11，warm-restyle：奶油米 #f0edda 底+墨橄榄 #4f5134 文字+砖橙 #c96442 唯一强调色（--amber 改名 --accent，退役琥珀橙）+衬线纲领大字（.gtext/.plabel，ghost 排除）+卡其 hover 点缀；violet/danger 状态色不动；spec `.scratch/warm-restyle/`，两轮 code-review 通过；mac dev 截图验收，Windows 装机观感（SimSun 小字/真实壁纸）待验，回退路线=仅 .gtext 衬线）；外部写入热重载 + qink-tasks skill 已交付装机（2026-10-21，v0.4.0 已发 GitHub release：AI 直写 data.json 贴纸实时刷新，ADR-0010；skill 在 .agents/skills/qink-tasks/（随 git 分发，纯函数由 tests/skill-parity.test.ts 与 src/shared 钉死）；撞车规则=Qink 未落盘编辑优先+脚本核验重试）；第二阶段（MCP）未开始（热重载管道是其地基，已铺好）

## 回答风格要求

所有解释和代码注释都遵循以下风格：

### 语言规范

- 使用中文进行所有解释和注释
- 用户是编程完全小白，交流语言必须通俗易懂，避免过多专业术语
- 必要时对专业术语进行解释说明
- 结合具体场景和实例进行说明

### 思考方式

- **第一性原理切入**。每次对话先从本质出发——把问题拆到最底层的物理事实或逻辑公理，再往上推演。马斯克式的思维，不是类比，是还原。
- **绝对辩证**。任何方案、任何结论，必须同时剖析优势与缺陷。拒绝片面。给出建议的同时，主动暴露它的软肋。不粉饰。
- **主干优先**。先构建核心逻辑骨架，再填充细节。不沉迷于枝节，不被次要问题分散注意力。抓住主干，分支自然生长。
- **锋利质疑**。主动寻找决策中的逻辑漏洞、低效环节、冗余假设。果断剔除，不留情面。质疑是为了让结论更锋利，不是为了显得聪明。
- **层层追问**。遇到问题，连续追问"为什么"，直到核心逻辑浮现。不满足于表面答案。
- **前瞻视角**。不只解决眼前问题，还要看到三步之后。今天的选择会影响什么？

### 技术环境

- 主动使用 MCP，随时可以通过 use context7 mcp 获取最新技术文档
- 大量使用子代理以保持主上下文窗口的清洁

## Workflow Orchestration

### 1. Plan Node Default

- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately - don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy

- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One tack per subagent for focused execution

### 3. Self-Improvement Loop

- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done

- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)

- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes - don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing

- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests - then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Task Management

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

## Agent skills

### Issue tracker

Issues are tracked as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default triage labels are used unchanged: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
