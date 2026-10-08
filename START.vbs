Option Explicit
Dim shell, fso, root, cmd
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root
cmd = Chr(34) & root & "\runtime\node.exe" & Chr(34) & " " & Chr(34) & root & "\launcher.mjs" & Chr(34)
If Not fso.FileExists(root & "\runtime\node.exe") Then
  MsgBox "실행 파일이 없습니다. ZIP 전체를 먼저 압축 해제한 뒤 START.cmd를 실행하세요.", 48, "AI 코스터 스튜디오"
Else
  shell.Run cmd, 0, False
End If
