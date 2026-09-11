# Controls only the test's temporary directory window, never the user's folders.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$taskTarget = [IO.Path]::GetFullPath($env:NOVEL_CRAWLER_OPEN_TARGET)
$taskTemporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
if (-not $taskTarget.StartsWith($taskTemporaryRoot, [StringComparison]::OrdinalIgnoreCase) -or
    -not ([IO.Path]::GetFileName($taskTarget)).StartsWith('shiye-explorer-test-')) {
    throw 'Not a temporary Explorer test directory.'
}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ExplorerFixture {
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr window, int command);
}
'@
$taskShell = New-Object -ComObject Shell.Application
$taskResult = @(
    foreach ($taskWindow in $taskShell.Windows()) {
        try {
            if ($taskWindow.Document.Folder.Self.Path -ine $taskTarget) { continue }
            $taskHandle = [IntPtr]$taskWindow.HWND
            switch ($env:NOVEL_CRAWLER_TEST_ACTION) {
                'hide' { $taskWindow.Visible = $false }
                'minimize' { [void][ExplorerFixture]::ShowWindowAsync($taskHandle, 6) }
                'close' { $taskWindow.Quit(); continue }
                'inspect' {}
                default { throw 'Invalid test action.' }
            }
            Start-Sleep -Milliseconds 150
            @{
                path = $taskWindow.Document.Folder.Self.Path
                windowId = $taskWindow.HWND
                visible = [ExplorerFixture]::IsWindowVisible($taskHandle)
                minimized = [ExplorerFixture]::IsIconic($taskHandle)
            }
        } catch {
            if ($env:NOVEL_CRAWLER_TEST_ACTION -ne 'close') { throw }
        }
    }
)
ConvertTo-Json -InputObject $taskResult -Compress
