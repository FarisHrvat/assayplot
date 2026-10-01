; Saved projects get their own icon instead of the app's.
!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\AssayPlot.Project\DefaultIcon" "" "$INSTDIR\document.ico"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
