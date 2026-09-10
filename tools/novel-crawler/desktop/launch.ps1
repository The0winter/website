$ErrorActionPreference = 'Stop'
try {
    $taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
    $taskNode = Join-Path $taskRoot '.runtime/node-v22.23.2-win-x64/node.exe'
    if (-not (Test-Path -LiteralPath $taskNode)) {
        $taskNode = (Get-Command node.exe -ErrorAction Stop).Source
    }
    if (-not (Test-Path -LiteralPath (Join-Path $taskRoot 'node_modules/puppeteer/package.json'))) {
        throw 'Project dependencies are missing. Run npm install in the project folder first.'
    }
    $taskState = Join-Path $taskRoot '.novel-crawler'
    New-Item -ItemType Directory -Force -Path $taskState | Out-Null
    $taskLog = Join-Path $taskState ('desktop-' + [Guid]::NewGuid().ToString('N') + '.log')
    $taskErrorLog = $taskLog + '.error.log'
    $taskEntry = Join-Path $PSScriptRoot 'main.mjs'
    $taskProcess = Start-Process -FilePath $taskNode -ArgumentList @('"' + $taskEntry + '"') -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput $taskLog -RedirectStandardError $taskErrorLog -PassThru -Wait
    if ($taskProcess.ExitCode -ne 0) { throw ('Could not start the downloader. Details: ' + $taskErrorLog) }
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Novel Downloader', 'OK', 'Error') | Out-Null
    exit 1
}
