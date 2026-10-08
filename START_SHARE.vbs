Option Explicit
Dim shell, fso, root, cmd
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root
cmd = Chr(34) & root & "\runtime\node.exe" & Chr(34) & " " & Chr(34) & root & "\share-launcher.mjs" & Chr(34) & ""
shell.Run cmd, 0, False
