$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$taskTarget = $env:NOVEL_CRAWLER_OPEN_TARGET
if (-not $taskTarget -or -not (Test-Path -LiteralPath $taskTarget -PathType Container)) {
    throw 'The target directory does not exist.'
}
$taskTarget = (Get-Item -LiteralPath $taskTarget).FullName

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ShiyeFolderWindow {
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr window, int command);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
}
'@

$taskShell = New-Object -ComObject Shell.Application
function Find-TargetWindow {
    $taskCandidates = @(
        foreach ($taskWindow in $taskShell.Windows()) {
            try {
                $taskPath = [IO.Path]::GetFullPath([string]$taskWindow.Document.Folder.Self.Path).TrimEnd('\')
                if ($taskPath -ieq $taskTarget.TrimEnd('\')) { $taskWindow }
            } catch {
                # Shell enumeration can include non-folder or closing windows.
            }
        }
    )
    # Prefer an existing visible window. Reuse hidden windows left by older
    # versions instead of creating another invisible Explorer instance.
    foreach ($taskWindow in $taskCandidates) {
        if ([ShiyeFolderWindow]::IsWindowVisible([IntPtr]$taskWindow.HWND)) { return $taskWindow }
    }
    if ($taskCandidates.Count) { return $taskCandidates[0] }
}

$taskWindow = Find-TargetWindow
if (-not $taskWindow) {
    $taskShell.Explore($taskTarget)
    $taskDeadline = [DateTime]::UtcNow.AddSeconds(8)
    do {
        Start-Sleep -Milliseconds 100
        $taskWindow = Find-TargetWindow
    } while (-not $taskWindow -and [DateTime]::UtcNow -lt $taskDeadline)
}
if (-not $taskWindow) { throw 'Explorer did not create the requested directory window.' }

$taskHandle = [IntPtr]$taskWindow.HWND
$taskWasVisible = [ShiyeFolderWindow]::IsWindowVisible($taskHandle)
$taskWasMinimized = [ShiyeFolderWindow]::IsIconic($taskHandle)
$taskWindow.Visible = $true
if (-not $taskWasVisible -or $taskWasMinimized) {
    [void][ShiyeFolderWindow]::ShowWindowAsync($taskHandle, 9) # SW_RESTORE
}
# Show and raise this folder only; do not change system foreground-lock settings.
[void][ShiyeFolderWindow]::SetWindowPos($taskHandle, [IntPtr]::Zero, 0, 0, 0, 0, 0x43)
[void][ShiyeFolderWindow]::SetForegroundWindow($taskHandle)

$taskDeadline = [DateTime]::UtcNow.AddSeconds(2)
do {
    Start-Sleep -Milliseconds 100
    $taskVisible = [ShiyeFolderWindow]::IsWindowVisible($taskHandle)
    $taskMinimized = [ShiyeFolderWindow]::IsIconic($taskHandle)
} while ((-not $taskVisible -or $taskMinimized) -and [DateTime]::UtcNow -lt $taskDeadline)

# Re-check the folder after showing it, in case a tab navigated during launch.
$taskActualPath = [IO.Path]::GetFullPath([string]$taskWindow.Document.Folder.Self.Path).TrimEnd('\')
if (-not $taskVisible -or $taskMinimized -or $taskActualPath -ine $taskTarget.TrimEnd('\')) {
    throw 'The requested directory window is not visible.'
}
[void][ShiyeFolderWindow]::SetForegroundWindow($taskHandle)
@{
    verified = $true
    visible = $taskVisible
    minimized = $taskMinimized
    foreground = ([ShiyeFolderWindow]::GetForegroundWindow() -eq $taskHandle)
    restored = (-not $taskWasVisible -or $taskWasMinimized)
    windowId = $taskHandle.ToInt64()
    path = $taskTarget
} | ConvertTo-Json -Compress
