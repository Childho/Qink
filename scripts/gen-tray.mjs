// 生成运行时内联图标(data URL,避免 main/renderer 静态资源打包路径问题):
//   src/main/tray-icon.ts     ← build/logo/tray-32.png(圆角黑片 + 白 Q)
//   src/renderer/src/logo.ts  ← build/logo/glyph-256.png(墨色 Q 透明底,悬浮球 CSS mask 用)
// 资产由 scripts/export-logo.ps1 从 build/logo/qink.jpg 导出。
// 重新生成: node scripts/gen-tray.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readDataUrl = (rel) => `data:image/png;base64,${readFileSync(join(root, rel)).toString('base64')}`

const trayDataUrl = readDataUrl('build/logo/tray-32.png')
const logoDataUrl = readDataUrl('build/logo/glyph-256.png')

mkdirSync(join(root, 'src', 'main'), { recursive: true })
writeFileSync(
  join(root, 'src', 'main', 'tray-icon.ts'),
  `// 由 scripts/gen-tray.mjs 生成,勿手改(资产:build/logo/tray-32.png)\nexport const TRAY_ICON_DATA_URL =\n  '${trayDataUrl}'\n`
)
mkdirSync(join(root, 'src', 'renderer', 'src'), { recursive: true })
writeFileSync(
  join(root, 'src', 'renderer', 'src', 'logo.ts'),
  `// 由 scripts/gen-tray.mjs 生成,勿手改(资产:build/logo/glyph-256.png)\n// 墨色 Q glyph 透明底,悬浮球 #fab 用 CSS mask 引用,只取 alpha、颜色跟随 --fg\nexport const LOGO_MASK_DATA_URL =\n  '${logoDataUrl}'\n`
)
console.log(`tray-icon.ts (${trayDataUrl.length} chars) 与 logo.ts (${logoDataUrl.length} chars) 生成完毕`)
