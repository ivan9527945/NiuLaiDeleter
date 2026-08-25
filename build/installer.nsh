; electron-builder NSIS 自定義指令碼
;
; 安裝目錄:精靈模式下模板自帶 instFilesPre 會在使用者選的目錄後追加
; \NiuLaiDeleter 子目錄(避免選到磁碟機代號根目錄);但靜默安裝(/S)沒有頁面,
; 該回撥不觸發,這裡在 customInit 裡補同樣的邏輯(只處理磁碟機代號根目錄)。
; 本指令碼還負責:解除安裝時清理右鍵選單登錄檔殘留。

!macro customInit
  ${If} ${Silent}
    ; 靜默安裝:使用者 /D 指定的磁碟機代號根目錄(D: 或 D:\) → 追加應用子目錄
    StrLen $R0 $INSTDIR
    ${If} $R0 = 2                 ; "D:"
      StrCpy $R1 $INSTDIR 1 1
      ${If} $R1 == ":"
        StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
      ${EndIf}
    ${ElseIf} $R0 = 3             ; "D:\"
      StrCpy $R1 $INSTDIR 1 1
      StrCpy $R2 $INSTDIR 1 2
      ${If} $R1 == ":"
      ${AndIf} $R2 == "\"
        StrCpy $INSTDIR "$INSTDIR${APP_FILENAME}"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro customUnInstall
  ; 只清右鍵選單登錄檔(檔案 * + 資料夾 Directory);InstallLocation("記住的
  ; 安裝位置")是使用者的選擇,保留它,重灌時自動沿用上次目錄
  DeleteRegKey HKCU "Software\Classes\*\shell\SummonNiuLai"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\SummonNiuLai"
!macroend
