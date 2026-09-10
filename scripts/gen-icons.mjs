// 生成应用图标 build/icon.ico：多尺寸 PNG-in-ICO（16/24/32/48/64/128/256）。
// 设计与托盘一致：白色圆片 + 琥珀橙圆点。重新生成：node scripts/gen-icons.mjs

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZES = [16, 24, 32, 48, 64, 128, 256]

function drawRgba(S) {
  const px = new Uint8Array(S * S * 4)
  const discC = (S - 1) / 2
  const discR = S * 0.41
  const dotC = discC + S * 0.19
  const dotR = S * 0.14
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4
      const d = Math.hypot(x - discC, y - discC)
      if (d > discR) continue
      const aa = 1 // 画大图时边缘抗锯齿
      const edge = Math.max(0, Math.min(1, discR - d))
      px[i] = 255
      px[i + 1] = 255
      px[i + 2] = 255
      px[i + 3] = Math.round(Math.min(aa, edge) * 255)
      if (d > discR - S * 0.05 && d <= discR - S * 0.018) {
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
  return px
}

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

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function makePng(S) {
  const px = drawRgba(S)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(S, 0)
  ihdr.writeUInt32BE(S, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc((S * 4 + 1) * S)
  for (let y = 0; y < S; y++) {
    raw[y * (S * 4 + 1)] = 0
    Buffer.from(px.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

// ---- ICO 容器：目录 + 各尺寸 PNG ----
const pngs = SIZES.map(makePng)
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

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
mkdirSync(join(root, 'build'), { recursive: true })
writeFileSync(join(root, 'build', 'icon.ico'), Buffer.concat([header, dir, ...pngs]))
console.log(`build/icon.ico 生成完毕：${SIZES.join('/')} 共 ${offset} 字节`)
