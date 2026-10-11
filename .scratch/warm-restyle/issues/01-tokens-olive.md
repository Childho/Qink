# 01 · 色值层：暖米/橄榄墨 token 换值 + accent 改名

Status: resolved
Blocked by: —
Blocks: 02, 03

spec 见 `../spec.md`（色板映射表为唯一色值依据）。

## 任务

1. `:root` 换值：`--note-surface: #f0edda`、`--menu-surface: #ebe7d1`、`--fg: #4f5134`。
2. 改名+换值：`--amber` → `--accent: #c96442`、`--amber-ink` → `--accent-ink: #8f3f24`；全文件 `var(--amber)` / `var(--amber-ink)` 引用（.task.rolled 三处、菜单选中、focus outline）一并改名。
3. 墨色同源替换：全部 `rgba(29, 29, 31, x)` → `rgba(63, 65, 38, x)`，**alpha 一比一保留**。已知位置：`:root` 的 hairline×2 / 阴影四档 / note-rim / note-thickness，组件散点 `.circle:hover`（0.7 边 / 0.05 底）、`.circle.done`（0.45 边 / 0.38 底）。
4. 碎裂动画常量（shatter 模块）：碎裂线 stroke `rgba(50, 50, 55, 0.65)` → `rgba(58, 60, 40, 0.65)`；撞击点 fill `rgba(45, 45, 50, 0.55)` → `rgba(53, 55, 38, 0.55)`（橄榄墨、比 token 墨浅半档，维持原有层级）。
5. 相关注释同步措辞（"琥珀"/"墨色"等描述跟随新值）。
6. **不动**：`--violet`/`--violet-ink`、`--danger`/`--danger-ink`、`--grain-opacity`、一切尺寸/几何/动画参数。

## 验收

- grep 证伪：样式表无 `29, 29, 31`、`#fafaf8`、`#f5f5f3`、`#d97706`、`amber` 残留；shatter 模块无 `50, 50, 55`、`45, 45, 50` 残留。
- `npm run typecheck` 零错误；`npm test` 62/62。

## Comments

- 实现（commit 427684a）：`:root` 全表换值 + 改名 6 处引用；墨色同源替换 25 行——ticket 清单之外主动捕获 10 处散点（滑条底、task:hover、placeholder×2、输入虚线、菜单 hover/active、archive-nav、速记 placeholder、note-close hover/active），全部 alpha 一比一；shatter 两常量按 ticket 值落地。
- 裁定记录：`.shard-tint` 白色玻璃淡染不在墨色系，保留（实现者上报，主线确认）。
- 验收：grep 证伪全过（含无空格变体）；typecheck 零错误；vitest 62/62。
- 偏离说明：本 ticket 为纯常量替换，未走 tdd（无逻辑缝可写失败测试），由 03 的四条验收线覆盖。
