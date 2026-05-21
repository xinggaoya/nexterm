; "Open in Nexterm" shell verbs for folders, folder backgrounds, and drives.
; HKCU matches installer currentUser scope. %V = clicked path.
; NoWorkingDirectory keeps Explorer from overriding %V (System32 on Drive).

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInNexterm" "" "Open in Nexterm"
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInNexterm" "Icon" '"$INSTDIR\nexterm.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInNexterm" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInNexterm\command" "" '"$INSTDIR\nexterm.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInNexterm" "" "Open in Nexterm"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInNexterm" "Icon" '"$INSTDIR\nexterm.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInNexterm" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInNexterm\command" "" '"$INSTDIR\nexterm.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInNexterm" "" "Open in Nexterm"
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInNexterm" "Icon" '"$INSTDIR\nexterm.exe",0'
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInNexterm" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInNexterm\command" "" '"$INSTDIR\nexterm.exe" "%V"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\OpenInNexterm"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\OpenInNexterm"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\OpenInNexterm"
!macroend
