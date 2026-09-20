Option Explicit
Dim taskShell, taskFs, taskScript
Set taskShell = CreateObject("WScript.Shell")
Set taskFs = CreateObject("Scripting.FileSystemObject")
taskScript = taskFs.BuildPath(taskFs.GetParentFolderName(WScript.ScriptFullName), "launch.ps1")
taskShell.Run "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & taskScript & """", 0, False
