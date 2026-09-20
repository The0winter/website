$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskDesktop = [Environment]::GetFolderPath('Desktop')
if (-not $taskDesktop) { throw 'Windows Desktop folder was not found.' }
$taskName = -join ([char[]]@(0x62FE,0x9875,0x7F51,0x7AD9,0x76D1,0x63A7))
$taskShell = New-Object -ComObject WScript.Shell
$taskShortcut = $taskShell.CreateShortcut((Join-Path $taskDesktop ($taskName + '.lnk')))
$taskShortcut.TargetPath = Join-Path $env:WINDIR 'System32/wscript.exe'
$taskShortcut.Arguments = '"' + (Join-Path $PSScriptRoot 'launch.vbs') + '"'
$taskShortcut.WorkingDirectory = $taskRoot
$taskShortcut.IconLocation = (Join-Path $PSScriptRoot 'icon.ico') + ',0'
$taskShortcut.Description = 'Shiye - read-only website monitor. Stops when closed.'
$taskShortcut.WindowStyle = 7
$taskShortcut.Save()
Write-Output (Join-Path $taskDesktop ($taskName + '.lnk'))
