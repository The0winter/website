param([switch]$Run, [switch]$Inspect)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$hasher = [Security.Cryptography.SHA256]::Create()
try { $rootHash = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($projectRoot))).Replace('-','') }
finally { $hasher.Dispose() }
$taskName = 'Test1-Local-Storage-' + $rootHash.Substring(0, 10)
$stateDir = Join-Path $projectRoot '.runtime/storage-maintenance'
if ($Inspect) {
  Get-ScheduledTask -TaskName $taskName | Select-Object TaskName, State, Actions, Triggers | ConvertTo-Json -Depth 5
  exit
}
if ($Run) {
  $settings = Get-Content (Join-Path $stateDir 'schedule.json') -Raw | ConvertFrom-Json
  $arguments = @('--require', ('"' + $settings.preload + '"'), ('"' + (Join-Path $projectRoot 'tools/storage-maintenance.cjs') + '"'), '--daily')
  $child = Start-Process -FilePath $settings.node -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput (Join-Path $stateDir 'daily.log') -RedirectStandardError (Join-Path $stateDir 'daily-error.log')
  exit $child.ExitCode
}
$nodePath = (Get-Command node.exe).Source
$preload = 'D:/Apps/Codex/home/tools/windows-hide.cjs'
if (!(Test-Path -LiteralPath $preload)) { throw 'The configured hidden-window Node preload is missing.' }
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
@{node=$nodePath; preload=$preload; taskName=$taskName; installedAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content (Join-Path $stateDir 'schedule.json') -Encoding utf8
# wscript creates no console window; it launches hidden PowerShell, which starts
# Node hidden with the inherited child-process preload. No foreground activation.
$launcher = Join-Path $stateDir 'daily.vbs'
$psPath = (Get-Command powershell.exe).Source
$scriptPath = Join-Path $projectRoot 'tools/storage-schedule.ps1'
$command = '"' + $psPath + '" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $scriptPath + '" -Run'
$vbs = 'Dim result' + "`r`n" + 'result = CreateObject("WScript.Shell").Run("' + $command.Replace('"','""') + '", 0, True)' + "`r`nWScript.Quit result"
[IO.File]::WriteAllText($launcher, $vbs, [Text.UnicodeEncoding]::new($false,$true))
$action = New-ScheduledTaskAction -Execute (Join-Path $env:WINDIR 'System32/wscript.exe') -Argument ('//B //Nologo "' + $launcher + '"') -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -Daily -At '12:30'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Hidden local Test1 cache cleanup, verified snapshot retention and 30-day disk usage ledger.' -Force | Select-Object TaskName, State | ConvertTo-Json
