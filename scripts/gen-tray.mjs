// 生成托盘图标：32x32 白色圆片 + 琥珀橙圆点（便利贴与滚入色的微缩标识）。
// 输出 src/main/tray-icon.ts（base64 常量），主进程 nativeImage.createFromDataURL 直接使用，
// 避免 main 进程静态资源打包路径问题。重新生成：node scripts/gen-tray.mjs

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const S = 32
const px = new Uint8Array(S * S * 4)

const discC = 15.5
const discR = 13
const dotC = 21.5
const dotR = 4.5

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4
    const d = Math.hypot(x - discC, y - discC)
    if (d > discR) continue
    const edge = Math.max(0, Math.min(1, discR - d)) // 边缘 1px 抗锯齿
    px[i] = 255
    px[i + 1] = 255
    px[i + 2] = 255
    px[i + 3] = Math.round(edge * 255)
    if (d > discR - 1.7 && d <= discR - 0.6) {
      // 内侧细描边（淡灰），深浅任务栏都可辨
      px[i] = 120
      px[i + 1] = 120
      px[i + 2] = 128
    }
    const d2 = Math.hypot(x - dotC, y - dotC)
    if (d2 <= dotR) {
      const e2 = Math.max(0, Math.min(1, dotR - d2))
      px[i] = 217
      px[i + 1] = 119
      px[i + 2] = 6
      px[i + 3] = Math.round(Math.min(edge, e2) * 255)
    }
  }
}

// ---- PNG 编码（RGBA, bit depth 8, color type 6）----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0)
ihdr.writeUInt32BE(S, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
const raw = Buffer.alloc((S * 4 + 1) * S)
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0 // filter: none
  Buffer.from(px.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1)
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0))
])

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
mkdirSync(join(root, 'src', 'main'), { recursive: true })
writeFileSync(join(root, 'src', 'main', 'tray-icon.ts'), `// 由 scripts/gen-tray.mjs 生成，勿手改\nexport const TRAY_ICON_DATA_URL =\n  'data:image/png;base64,${png.toString('base64')}'\n`)
console.log(`tray icon ${S}x${S} 生成完毕 (${png.length} bytes)`)
