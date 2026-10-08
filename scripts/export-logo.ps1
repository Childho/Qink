# 用 Windows 自带 GDI+(System.Drawing)把品牌源图导出为图标管线中间资产,零 npm 依赖。
# 输入  build/logo/qink.jpg(黑底白 Q 品牌图)
# 输出  build/logo/tile-{16,24,32,48,64,128,256}.png  圆角黑片,gen-icons.mjs 打包成 build/icon.ico
#       build/logo/tray-32.png                        托盘专用 32px 圆角黑片(可单独微调 Q 占比)
#       build/logo/glyph-256.png                      墨色 Q 透明底,悬浮球 CSS mask 用
# 重新生成: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/export-logo.ps1
param(
  [string]$Source = '',
  [string]$OutDir = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
if (-not $Source) { $Source = Join-Path $root 'build/logo/qink.jpg' }
if (-not $OutDir) { $OutDir = Join-Path $root 'build/logo' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$src = [System.Drawing.Bitmap]::new($Source)
try {
  # ---- 高质量缩放工具:双三次插值 + 高质量像素偏移,大比例缩到 16px 仍平滑 ----
  function Resize-Bitmap([System.Drawing.Bitmap]$bmp, [int]$size) {
    $out = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($out)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.DrawImage($bmp, (New-Object System.Drawing.Rectangle(0, 0, $size, $size)),
                 0, 0, $bmp.Width, $bmp.Height, [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()
    return $out
  }

  # ---- 1) 中心方裁(防御非正方形输入) ----
  $side = [Math]::Min($src.Width, $src.Height)
  $crop = New-Object System.Drawing.Bitmap($side, $side, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($crop)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $srcRect = New-Object System.Drawing.Rectangle((($src.Width - $side) / 2), (($src.Height - $side) / 2), $side, $side)
  $g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $side, $side)), $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()

  # ---- 2) 圆角黑片:全分辨率烘焙 ~20% 圆角(TextureBrush + FillPath,边缘抗锯齿),再缩到各尺寸 ----
  $rounded = New-Object System.Drawing.Bitmap($side, $side, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($rounded)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $r = $side * 0.20
  $d = 2 * $r
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc(0, 0, $d, $d, 180, 90)
  $path.AddArc($side - $d, 0, $d, $d, 270, 90)
  $path.AddArc($side - $d, $side - $d, $d, $d, 0, 90)
  $path.AddArc(0, $side - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  $brush = New-Object System.Drawing.TextureBrush($crop)
  $brush.WrapMode = [System.Drawing.Drawing2D.WrapMode]::Clamp
  $g.FillPath($brush, $path)
  $g.Dispose()
  $brush.Dispose()
  $path.Dispose()

  foreach ($size in 16, 24, 32, 48, 64, 128, 256) {
    $b = Resize-Bitmap $rounded $size
    $b.Save((Join-Path $OutDir "tile-$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $b.Dispose()
  }
  # 托盘单独落一份 32px:以后若 16px 渲染下 Q 不清,可在此基础上微调 Q 占比而不影响 exe 图标
  Copy-Item (Join-Path $OutDir 'tile-32.png') (Join-Path $OutDir 'tray-32.png') -Force
  $rounded.Dispose()

  # ---- 3) 墨色 Q glyph:亮度映射为 alpha(黑=全透明、白=不透明),低亮度阈值防 JPEG 黑底噪点成灰雾 ----
  # 色面统一烘成便签墨色 #1d1d1f,与 --fg 前景变量一致(悬浮球走 CSS mask 时只取 alpha,颜色作兜底)
  $gs = 256
  $glyph = Resize-Bitmap $crop $gs
  $rect = New-Object System.Drawing.Rectangle(0, 0, $gs, $gs)
  $data = $glyph.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bytes = New-Object byte[] ($gs * $gs * 4)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  for ($i = 0; $i -lt $bytes.Length; $i += 4) {
    # 内存布局小端 BGRA:[0]=B [1]=G [2]=R [3]=A
    $lum = (299 * $bytes[$i + 2] + 587 * $bytes[$i + 1] + 114 * $bytes[$i]) / 1000
    $a = ($lum - 20) / 235
    if ($a -lt 0) { $a = 0 }
    elseif ($a -gt 1) { $a = 1 }
    $bytes[$i] = 31       # B
    $bytes[$i + 1] = 29   # G
    $bytes[$i + 2] = 29   # R
    $bytes[$i + 3] = [int][Math]::Round($a * 255)
  }
  [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
  $glyph.UnlockBits($data)
  $glyph.Save((Join-Path $OutDir 'glyph-256.png'), [System.Drawing.Imaging.ImageFormat]::Png)
  $glyph.Dispose()
  $crop.Dispose()
}
finally {
  $src.Dispose()
}
Write-Host "build/logo 资产导出完毕:tile-{16..256}.png / tray-32.png / glyph-256.png"
