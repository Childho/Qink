# 原型还原验收说明

## 运行

先执行 `npm run build`。在 PowerShell 中运行：

```powershell
$env:ELECTRON_RUN_AS_NODE = $null
node_modules/.bin/electron.cmd .scratch/ui-restore/verify.cjs 'prototype.html'
```

脚本使用内存里的原型演示数据和实际 `out/renderer`，不连接正式版的数据保存通道。Electron 测试配置保存在本目录的 `electron-profile`（已忽略）。

## 图像证据

- prototype.png：原型，同样位置、背景、内容。
- restored.png：构建后的贴纸。
- archive.png：构建后的已完成清单。
- geometry.json：实际渲染的元素坐标/尺寸/字号逐项对比。
- visual-metrics.json：贴纸矩形内 RGB 平均绝对差约 0.403/255；这是同场景像素误差，不是跨壁纸的相似度保证。
- results.json：24项界面回归全部通过，包含日期边界、切字号、入场中退出和减少动态效果模式。

## 实机验证与限制

2026-09-11 已静默安装并启动，正式版 app.asar 与构建产物 SHA256 相同。安装前后目标、任务、已完成数据相同。桌面工具能读取正式版目标区、任务区和输入控件。

本机 Windows 10 的桌面截图 API 报 `SetIsBorderRequired failed / 0x80004002`，重试相同；因此没有宣称完成正式版桌面截图、物理鼠标拖动或透明边缘穿透实测。以上截图来自实际 Electron 渲染器的隔离场景。
