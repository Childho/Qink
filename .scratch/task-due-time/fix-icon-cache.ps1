# Nuke Windows icon cache: kill explorer, delete iconcache DBs, restart explorer.
# Standard fix for stale icons on taskbar/desktop/start-menu after exe icon change.
taskkill /f /im explorer.exe 2>$null | Out-Null
Start-Sleep -Milliseconds 800
$removed = 0
foreach ($f in @("$env:LOCALAPPDATA\IconCache.db")) {
  if (Test-Path $f) { Remove-Item $f -Force -ErrorAction SilentlyContinue; $removed++ }
}
Get-ChildItem "$env:LOCALAPPDATA\Microsoft\Windows\Explorer" -Filter 'iconcache_*.db' -ErrorAction SilentlyContinue |
  ForEach-Object { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue; $removed++ }
Write-Host "removed cache files: $removed"
# flush icon cache notifications
ie4uinit.exe -show | Out-Null
Start-Process explorer.exe
Start-Sleep -Seconds 3
Write-Host "explorer restarted"
# also list taskbar pinned items dir for later inspection
$pin = "$env:APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"
if (Test-Path $pin) { Get-ChildItem $pin -Filter '*.lnk' | ForEach-Object { Write-Host ("pinned: " + $_.Name) } }
