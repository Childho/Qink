# Qink 第一阶段 · 实现计划

依据：`.scratch/qink-phase1/spec.md`（设计共识）、`CONTEXT.md`（术语）、ADR-0001/0002/0003。

## 技术底座

- 脚手架：`npm create @quick-start/electron`（electron-vite 5 + TypeScript **原生模板**，不用 React/Vue——界面就一张贴纸，原生 DOM 最轻）
- Electron 38+，Vite 7（electron-vite 5 尚不支持 Vite 8）；本机 Node 24 满足要求
- 依赖只有三件：`d3-delaunay`（Voronoi 碎片）、`vitest`（逻辑单测）、`electron-builder`（打包）
- 其余全用 Electron 内置能力：托盘、开机自启（`setLoginItemSettings`）、无边框透明窗口；壁纸路径用 `reg.exe` 查注册表，零额外依赖

## 数据设计（`文档\Qink\data.json`）——派生式状态

存储只记事实，「滚入/过期」全部由日期推导，不存状态标志：

- `goals`：季/月/周各一条，带**周期键**（如 `2026-Q3`、`2026-09`、`2026-W37`）；打开时周期键 ≠ 当前周期 → 目标自动失效、显示引导文字。**零定时器，永不漏翻篇**
- `tasks`：`{id, text, createdAt}`；是否滚入 = createdAt 日期早于今天
- `archive`：`{id, text, createdAt, completedAt}`，完成即移入，修复即移回
- `settings`：自启开关、字号、窗口位置
- 运行中跨午夜：每分钟静默对一次日期，变了就重算视图（同时覆盖「半夜关机、开机补算」场景）

## 三层结构

main（窗口/托盘/自启/数据 IO/壁纸采样/自绘拖动）→ preload（安全 IPC 桥）→ renderer（UI/右键抽屉/手势识别/碎裂合并动画/玻璃平移）。

## 关键技术决策

1. **自绘拖动**（不用系统拖动区）：系统拖动区会吞掉鼠标事件，右键长按晃动手势就做不成；自绘后每个渲染帧同步玻璃平移，丝滑不受损
2. **目标带周期键**：翻篇是「打开即推导」，不是「定时清空」
3. **玻璃 = 预模糊壁纸 + background-position 平移**：拖动零实时计算（ADR-0003）
4. **Win11 自动升级**：`os.release()` ≥ 22000 时切官方 `backgroundMaterial`
5. **降级保底**：动态壁纸或采样失败 → 退回纯半透明

## 里程碑（将写入 `tasks/todo.md`，每个都有验收标准）

- **M1 脚手架与空壳**：项目搭建、git init、无边框透明窗口跑起来
- **M2 数据与日期引擎**：data.json 读写 + 周期键/滚入/修复年龄推导 + **vitest 单测**（周期边界、午夜翻篇、跨周期清空、修复年龄）——最高风险的纯逻辑全部自动化测试
- **M3 贴纸骨架**：目标区（引导文字/点击改写）、任务区（回车添加/圆圈完成/右键改删）、字号三选、字体配色。完成动作暂用简单淡出占位
- **M4 常驻能力**：托盘找回、自启开关、位置记忆、单实例锁、永不置顶、自绘拖动
- **M5 毛玻璃层**：壁纸采样预模糊、拖动平移同步、壁纸更换重采样、Win11 分支、降级保底
- **M6 碎裂与修复**：Voronoi 碎裂动画（完成）、愈合动画（修复）
- **M7 已完成清单**：右键长按晃动手势、碎片合并动画（仍是裂的）、滚轮翻日、双击修复、退出反向碎开
- **M8 打磨与验收**：动画手感参数、`spec.md` 逐条核对、边界场景（午夜实时翻篇、开机补算、周期更替清空、动态壁纸降级）
- **M9 打包安装**：electron-builder 出 NSIS 安装包 + 便携版、本机实际安装、重启验证自启

## 验证方式

日期/周期逻辑走 vitest 自动测试；界面与动画每个里程碑启动应用实际走查；最终在本机真实安装、重启验证自启、连续用一天验证翻篇与滚入。

## 风险与对策

- 自绘拖动 + 玻璃平移的帧率 → rAF 合批，一帧一动
- 壁纸缩放/多显示器 → 第一阶段只按主显示器 + DPI 采样
- 右键双行为判定（点按=菜单 vs 长按晃动=手势）→ 300ms + 位移阈值，做成可调常量
- Win10 透明窗口需无边框 → 本来就是无边框，调研已确认无碍

参考来源：[electron-vite 官网](https://electron-vite.org/)、[Getting Started](https://electron-vite.org/guide/)、[npm: electron-vite](https://www.npmjs.com/package/electron-vite)、[Electron 38 发布说明](https://electronjs.org/blog/electron-38-0)