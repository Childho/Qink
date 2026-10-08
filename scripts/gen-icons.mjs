// 生成应用图标 build/icon.ico:多尺寸 PNG-in-ICO(16/24/32/48/64/128/256)。
// 资产来源:scripts/export-logo.ps1 从品牌源图 build/logo/qink.jpg 导出的圆角黑片 tile-*.png,
// 本脚本只负责把 PNG 打包进 ICO 容器。重新生成:node scripts/gen-icons.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZES = [16, 24, 32, 48, 64, 128, 256]

// ---- ICO 容器:目录 + 各尺寸 PNG ----
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pngs = SIZES.map((s) => readFileSync(join(root, 'build', 'logo', `tile-${s}.png`)))

const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2) // 类型: icon
header.writeUInt16LE(SIZES.length, 4)

const dir = Buffer.alloc(16 * SIZES.length)
let offset = header.length + dir.length
pngs.forEach((png, i) => {
  const S = SIZES[i]
  dir.writeUInt8(S >= 256 ? 0 : S, i * 16)
  dir.writeUInt8(S >= 256 ? 0 : S, i * 16 + 1)
  dir.writeUInt8(0, i * 16 + 2)
  dir.writeUInt8(0, i * 16 + 3)
  dir.writeUInt16LE(1, i * 16 + 4)
  dir.writeUInt16LE(32, i * 16 + 6)
  dir.writeUInt32LE(png.length, i * 16 + 8)
  dir.writeUInt32LE(offset, i * 16 + 12)
  offset += png.length
})

mkdirSync(join(root, 'build'), { recursive: true })
writeFileSync(join(root, 'build', 'icon.ico'), Buffer.concat([header, dir, ...pngs]))
console.log(`build/icon.ico 生成完毕:${SIZES.join('/')} 共 ${offset} 字节`)
