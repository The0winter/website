Option Explicit
Dim shell, fs, root, script, command
Set shell = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
root = fs.GetParentFolderName(WScript.ScriptFullName)
script = fs.BuildPath(root, "tools\novel-crawler\desktop\launch.ps1")
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File " & Chr(34) & script & Chr(34)
shell.Run command, 0, False
