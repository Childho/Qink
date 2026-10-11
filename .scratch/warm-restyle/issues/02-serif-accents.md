# 02 · 排印层：衬线纲领 + 卡其点缀

Status: ready-for-agent
Blocked by: 01
Blocks: 03

spec 见 `../spec.md`（结构点缀清单与字体决策为依据）。

## 任务

1. `:root` 新增三个 token：`--fg-strong: #3f4126`（墨橄榄深档）、`--font-serif: "Songti SC", "STSong", "SimSun", "Noto Serif SC", serif`、`--khaki: #ded6b6`。
2. 衬线应用：`.gtext` 加 `font-family: var(--font-serif)` 并设 `color: var(--fg-strong)`；`.plabel` 加 `font-family: var(--font-serif)`。字号/字重/透明度一律不动（衬线观感装机后如需调走回退路线，见 spec Further Notes）。
3. hover 家族换暖卡其（这是设计变更，不是 1:1 映射）：
   - `.task:hover` 墨色淡底 → `color-mix(in srgb, var(--khaki) 55%, transparent)`
   - `.menu-item:hover` → `color-mix(in srgb, var(--khaki) 50%, transparent)`；`:active` → 75%
   - `.archive-nav:hover` → `color-mix(in srgb, var(--khaki) 50%, transparent)`
   - `.note-close:hover` 底色 → `color-mix(in srgb, var(--khaki) 50%, transparent)`，且图标色 → `var(--accent)`（砖橙悬停提示）
   - `.task.drag-sorting` 浮起底 `color-mix(in srgb, white 42%, transparent)` → `color-mix(in srgb, var(--khaki) 45%, transparent)`
4. 速记输入区（composer）、速记胶囊、各输入框：grep 硬编码近白底，一律并入奶油/卡其体系（当前已知仅 drag-sorting 一处 white color-mix，已列上；若实现中发现别处按同原则处理并在报告中列出）。
5. **不动**：空态引导语（ghost）、任务行、输入框的字体（保持无衬线）；`--violet`/`--danger`；emoji/透明度/尺寸。

## 验收

- grep：无 `29, 29, 31` 的 hover 残留（circle 系已归橄榄墨，属 01 范围）；白色系仅剩有意保留项并逐条说明。
- `npm run typecheck` 零错误；`npm test` 62/62。
