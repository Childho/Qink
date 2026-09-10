# 毛玻璃采用「壁纸预采样 + 平移」的假模糊路线

用户要求苹果级丝滑的纯白毛玻璃，但目标机器是 Windows 10：Electron 官方 `backgroundMaterial` 明确仅支持 Win11 22H2+；Win10 上唯一的真模糊路线（`SetWindowCompositionAttribute` 私有 API 的社区封装，如 electron-acrylic-window / pykeio-vibe）已全部停更/归档，且有无法修复的窗口拖动卡顿（Windows 底层缺陷）。**决定：预采样壁纸并整体预模糊成一张贴图，贴纸的「毛玻璃」实为该贴图按窗口位置平移显示（background-position 同步），拖动零实时计算、丝滑由构造保证**；贴纸永不置顶、95% 时间静置于壁纸之上，穿帮仅出现在「贴纸聚焦悬浮于其他窗口上方」的罕见瞬间。检测到动态视频壁纸时自动退回纯半透明保底。

## Consequences

- 玻璃渲染做成可替换的抽象层：启动时检测系统版本，Windows 11 22H2+ 自动切换官方 `backgroundMaterial`，Win10 用预采样方案。
- 壁纸更换后需重新采样（亚秒级过渡），需监听壁纸变更。
- 窗口与其他窗口重叠时，玻璃背后显示的是壁纸模糊而非真实窗口内容（接受的代价）。
