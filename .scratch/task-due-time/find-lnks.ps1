# 全盘搜索指向 Qink 的快捷方式（桌面×2 / 开始菜单×2 / 任务栏固定）
$ws = New-Object -ComObject WScript.Shell
$paths = @(
  "$env:USERPROFILE\Desktop",
  "$env:PUBLIC\Desktop",
  "$env:APPDATA\Microsoft\Windows\Start Menu\Programs",
  "$env:ProgramData\Microsoft\Windows\Start Menu\Programs",
  "$env:APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"
)
foreach ($dir in $paths) {
  if (Test-Path $dir) {
    Get-ChildItem $dir -Filter '*.lnk' -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
      $lnk = $ws.CreateShortcut($_.FullName)
      if ($lnk.TargetPath -match 'ink') {
        Write-Host ($_.FullName + '  ->  ' + $lnk.TargetPath + '  icon: [' + $lnk.IconLocation + ']')
      }
    }
  }
}
# 还有安装器可能留下的卸载入口（控制面板/设置里的图标走的是 Uninstall 注册表，不常驻桌面，顺带列出）
Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -match 'Qink' } |
  ForEach-Object { Write-Host ('注册表卸载项: ' + $_.DisplayName + '  icon: ' + $_.DisplayIcon) }
