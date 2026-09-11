# Qink 原型还原实施计划

**目标：** 忠实还原 E:/下载/index.html 的贴纸视觉，并修复日常输入、拖动与已完成清单。
**架构：** 保留 Electron + 原生 DOM 和数据模型；玻璃底图、雾面、内容三层分离；保存与刷新分离。
**技术栈：** Electron、TypeScript、CSS、Vitest。

1. src/renderer/src/style.css、glass.ts：正确叠层与原型尺寸；透明留白容纳阴影，背景偏移计入留白。
2. src/shared/window.ts、src/main/index.ts、src/preload/index.ts：统一尺寸、位置钳制、留白鼠标穿透。
3. src/renderer/src/main.ts：局部编辑、中文输入法守卫、草稿保留、屏幕坐标拖动、完成防重入。
4. src/renderer/src/archive.ts：保留容器、日期导航、恢复防重入、动画结束与退出清理。
5. tests 与 .scratch/ui-restore：验证边界逻辑及隔离 Electron 交互，生成原型/实现截图对照。
6. npm run typecheck、npm test、npm run build、npm run package；检查 CSS 产物；安装并实机截图。
