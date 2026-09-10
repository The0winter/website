$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$taskName = ([string][char]0x62FE) + [char]0x9875
$taskLauncherName = $taskName + [char]0x5C0F + [char]0x8BF4 + [char]0x91C7 + [char]0x96C6 + '.vbs'
$taskLauncher = Join-Path $taskRoot $taskLauncherName
$taskIcon = Join-Path $PSScriptRoot 'icon.ico'
foreach ($taskFile in @($taskLauncher, $taskIcon)) {
    if (-not (Test-Path -LiteralPath $taskFile -PathType Leaf)) { throw "Required file not found: $taskFile" }
}
$taskDesktop = [Environment]::GetFolderPath('Desktop')
if (-not $taskDesktop) { throw 'Windows Desktop folder was not found.' }
$taskShortcutPath = Join-Path $taskDesktop ($taskName + '.lnk')
$taskShell = New-Object -ComObject WScript.Shell
$taskShortcut = $taskShell.CreateShortcut($taskShortcutPath)
$taskShortcut.TargetPath = Join-Path $env:WINDIR 'System32/wscript.exe'
$taskShortcut.Arguments = '"' + $taskLauncher + '"'
$taskShortcut.WorkingDirectory = $taskRoot
$taskShortcut.IconLocation = $taskIcon + ',0'
$taskShortcut.Description = 'Shi Ye - local novel downloader'
$taskShortcut.WindowStyle = 7
$taskShortcut.Save()
Write-Output $taskShortcutPath
