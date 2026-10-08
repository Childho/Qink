# AGENTS.md

## 本项目：Qink

一张常驻 Windows 桌面的毛玻璃便利贴：季/月/周核心目标 + 今日任务（碎裂完成、滚入琥珀橙、已完成清单手势）。规格见 `.scratch/qink-phase1/spec.md`，术语见 `CONTEXT.md`，重大决策见 `docs/adr/`。

- 常用命令：`npm run dev`（开发）· `npm test`（vitest）· `npm run typecheck` · `npm run package`（打包；本机网络需带两个镜像变量 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`——前者管 Electron 本体、后者管 NSIS 等构建器二进制，缺任一都会卡 GitHub 超时；`dist/win-unpacked` 被占 EPERM 时先清目录）
- 技术栈：Electron 38 + electron-vite 5 + TypeScript，原生 DOM 无前端框架
- 目录：`src/main`（窗口/托盘/数据）· `src/preload`（IPC 桥）· `src/renderer`（UI/手势/动画）· `src/shared`（纯逻辑，单测覆盖）· `tests/`
- 图标资产：品牌源图 `build/logo/qink.jpg` → `scripts/export-logo.ps1`（GDI+ 导出圆角片/墨色 Q）→ `scripts/gen-icons.mjs` / `gen-tray.mjs`（打包 exe ico、托盘与悬浮球 data URL）；`src/main/tray-icon.ts` 与 `src/renderer/src/logo.ts` 是生成物，勿手改
- 数据：`文档\Qink\data.json`（AppData 留备份双写）
- 注意：改主进程/preload 必须完全重启 dev——electron-vite 只对渲染层热更新
- 当前状态：第一阶段（M1–M9）、UI 迭代（M10–M14、置顶排序、全面审查）、品牌 logo、任务截止时间（M15，2026-09-27：可选 dueAt、<24h 自动置顶红、逾期球裂缝，spec 在 `.scratch/task-due-time/`）、空闲自动收起（M16，2026-09-27：展开 10 分钟无交互收成悬浮球）已交付装机；阴影四档收敛（2026-09-27，ADR-0008：`:root` 四档墨色阴影 token，禁止元素自定参数）已交付装机；UI 丝滑动效修复与还原（2026-09-27：形态切换 216px 瞬移/展开吸附/min-height 托底/速记红裂缝闪现修复，任务行 hover 与按压反馈等细节还原，验收 `.scratch/ui-silk-restore/`）；安装包副本另存分发；第二阶段（MCP）未开始

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
