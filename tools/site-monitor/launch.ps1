$ErrorActionPreference = 'Stop'
try {
    $taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
    $taskNode = Join-Path $taskRoot '.runtime/node-v22.23.2-win-x64/node.exe'
    if (-not (Test-Path -LiteralPath $taskNode)) { $taskNode = (Get-Command node.exe -ErrorAction Stop).Source }
    $taskState = Join-Path $taskRoot '.runtime/site-monitor'
    New-Item -ItemType Directory -Force -Path $taskState | Out-Null
    $taskEntry = Join-Path $PSScriptRoot 'main.mjs'
    # Fixed-size lifecycle: these two files are replaced on each launch.
    $taskProcess = Start-Process -FilePath $taskNode -ArgumentList @('"' + $taskEntry + '"') -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskState 'last-launch.log') -RedirectStandardError (Join-Path $taskState 'last-launch.error.log') -PassThru -Wait
    if ($taskProcess.ExitCode -ne 0) { throw 'Monitor could not start. See .runtime/site-monitor/last-launch.error.log.' }
} catch {
    if ($env:SITE_MONITOR_NO_DIALOG -eq '1') {
        [Console]::Error.WriteLine($_.Exception.Message)
        exit 1
    }
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Shiye Monitor', 'OK', 'Error') | Out-Null
    exit 1
}
