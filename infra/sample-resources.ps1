$ErrorActionPreference = 'Stop'
$stageState = Get-Content -LiteralPath '.runtime/staging.json' -Raw | ConvertFrom-Json
if ($stageState.env.APP_ENV -ne 'test' -or $stageState.uri -notmatch '^mongodb://127\.0\.0\.1:(\d+)/test1_test\?') { throw 'Synthetic staging required' }
$mongoPort = [int]$Matches[1]
$ports = @(5001, 3001, 8088, $mongoPort)
$listeners = Get-NetTCPConnection -LocalPort $ports -State Listen
$targets = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
$rows = [System.Collections.Generic.List[object]]::new()
for ($sampleNumber=0; $sampleNumber -lt 60; $sampleNumber++) {
  foreach ($taskProcessId in $targets) {
    $taskProcess = Get-Process -Id $taskProcessId -ErrorAction SilentlyContinue
    if ($null -eq $taskProcess) { throw 'Staging process disappeared during sampling' }
    $rows.Add([pscustomobject]@{at=[DateTime]::UtcNow.ToString('o');pid=$taskProcess.Id;process=$taskProcess.ProcessName;cpuSeconds=$taskProcess.CPU;workingSetBytes=$taskProcess.WorkingSet64;privateBytes=$taskProcess.PrivateMemorySize64;handles=$taskProcess.HandleCount})
  }
  Start-Sleep -Seconds 2
}
$rows | Export-Csv -LiteralPath 'artifacts/resources-mixed.csv' -NoTypeInformation
