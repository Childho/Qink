import { spawn } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { WallpaperImage } from '../shared/glass'

// 壁纸来源：优先 TranscodedWallpaper（系统渲染好的当前壁纸，幻灯片/拉伸都反映在此文件），
// 兜底注册表 HKCU\Control Panel\Desktop\Wallpaper 指向的文件。

function transcodedPath(): string {
  return join(app.getPath('appData'), 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper')
}

function regWallpaperPath(): Promise<string | null> {
  return new Promise((resolve) => {
    const p = spawn('reg', ['query', 'HKCU\\Control Panel\\Desktop', '/v', 'Wallpaper'])
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.on('error', () => resolve(null))
    p.on('close', () => {
      const m = out.match(/Wallpaper\s+REG_SZ\s+(\S+)/)
      resolve(m ? m[1] : null)
    })
  })
}

function mimeOf(path: string): string {
  return path.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
}

export async function readWallpaper(): Promise<WallpaperImage> {
  const candidates = [transcodedPath(), await regWallpaperPath()]
  for (const path of candidates) {
    if (!path) continue
    try {
      const buf = await readFile(path)
      if (buf.length > 0) return { b64: buf.toString('base64'), mime: mimeOf(path) }
    } catch {
      // 该来源不可读，试下一个
    }
  }
  return { b64: null, mime: 'image/jpeg' } // 纯色/动态壁纸等场景：降级纯半透明
}

/** 轮询壁纸签名（TranscodedWallpaper 的 mtime+size），变了才回调重采样 */
export function watchWallpaper(onChange: (w: WallpaperImage) => void): void {
  let lastSig = ''
  const tick = async (): Promise<void> => {
    let sig = 'none'
    try {
      const s = await stat(transcodedPath())
      sig = `${s.size}:${s.mtimeMs}`
    } catch {
      // 文件不存在（纯色壁纸）时靠注册表路径兜底检测
      const p = await regWallpaperPath()
      sig = p ?? 'none'
    }
    if (lastSig !== '' && sig !== lastSig) {
      onChange(await readWallpaper())
    }
    lastSig = sig
  }
  void tick() // 建立基线
  setInterval(() => void tick(), 5000)
}
