# Pixel-verdict: extract icon from installed exe + from build/icon.ico + from dist exe,
# count dark vs amber pixels. No vision model, pixels only.
Add-Type -AssemblyName System.Drawing
function Verdict-Icon($source, $label) {
  $icon = $null
  if ($source -like '*.exe') { $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($source) }
  else { $icon = New-Object System.Drawing.Icon($source, 32, 32) }
  $bmp = $icon.ToBitmap()
  $dark = 0; $amber = 0; $total = 0
  for ($x = 0; $x -lt $bmp.Width; $x++) {
    for ($y = 0; $y -lt $bmp.Height; $y++) {
      $p = $bmp.GetPixel($x, $y)
      if ($p.A -lt 40) { continue }
      $total++
      if ($p.R -lt 70 -and $p.G -lt 70 -and $p.B -lt 70) { $dark++ }
      if ($p.R -gt 190 -and $p.G -gt 95 -and $p.G -lt 175 -and $p.B -lt 95) { $amber++ }
    }
  }
  $darkPct = if ($total) { [math]::Round(100 * $dark / $total) } else { 0 }
  $verdict = if ($darkPct -gt 50) { 'NEW-black-Q' } elseif ($amber -gt 3) { 'OLD-amber' } else { "other(dark=$darkPct%, amber=$amber)" }
  Write-Host "$label : size=$($bmp.Width) dark=${darkPct}% amber=$amber total=$total ==> $verdict"
  $bmp.Dispose(); $icon.Dispose()
}
$apps = Get-ChildItem "$env:LOCALAPPDATA\Programs" -Directory | Where-Object Name -imatch '^qink$'
Write-Host ("install dirs found: " + ($apps.FullName -join ' , '))
Verdict-Icon "$env:LOCALAPPDATA\Programs\Qink\Qink.exe" "installed Qink.exe"
Verdict-Icon "E:\备份-公司\练习项目\Qink\build\icon.ico" "build/icon.ico"
Verdict-Icon "E:\备份-公司\练习项目\Qink\dist\win-unpacked\Qink.exe" "dist win-unpacked Qink.exe"
Verdict-Icon "E:\备份-公司\练习项目\Qink\dist\Qink-Setup-0.1.0.exe" "setup exe"
