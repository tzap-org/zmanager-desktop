!define ZM_EXE_NAME "zmanager-desktop.exe"
!define ZM_SHELL_EXTENSION_NAME "zmanager-shell-extension.dll"
!define ZM_SHELL_EXTENSION_SOURCE "${__FILEDIR__}\..\..\target\windows-shell-extension\zmanager-shell-extension.dll"
!define ZM_SHELL_EXTENSION_DESCRIPTION "ZManager Shell Extension"
!define ZM_APPROVED_SHELL_EXTENSIONS_KEY "Software\Microsoft\Windows\CurrentVersion\Shell Extensions\Approved"
!define ZM_VERB_PREFIX "ZManager"
!define ZM_MENU_KEY "ZManager"
!define ZM_CLASSIC_CONTEXT_MENU_KEY "ZManager"
!define ZM_ARCHIVE_SUBCOMMANDS_KEY "ZManager.Desktop.ContextMenu.Archive"
!define ZM_CREATE_FILE_SUBCOMMANDS_KEY "ZManager.Desktop.ContextMenu.CreateFile"
!define ZM_CREATE_BACKGROUND_SUBCOMMANDS_KEY "ZManager.Desktop.ContextMenu.CreateBackground"
!define ZM_NON_ARCHIVE_FILE_APPLIES_TO "NOT System.FileExtension:=.7z AND NOT System.FileExtension:=.7z.001 AND NOT System.FileExtension:=.a AND NOT System.FileExtension:=.aar AND NOT System.FileExtension:=.ad1 AND NOT System.FileExtension:=.aea AND NOT System.FileExtension:=.aff4 AND NOT System.FileExtension:=.apk AND NOT System.FileExtension:=.appimage AND NOT System.FileExtension:=.appx AND NOT System.FileExtension:=.ar AND NOT System.FileExtension:=.b64 AND NOT System.FileExtension:=.br AND NOT System.FileExtension:=.bz2 AND NOT System.FileExtension:=.cab AND NOT System.FileExtension:=.cb7 AND NOT System.FileExtension:=.cbr AND NOT System.FileExtension:=.cbt AND NOT System.FileExtension:=.cbz AND NOT System.FileExtension:=.ccd AND NOT System.FileExtension:=.cdi AND NOT System.FileExtension:=.cpgz AND NOT System.FileExtension:=.cpio AND NOT System.FileExtension:=.cpio.bz2 AND NOT System.FileExtension:=.cpio.gz AND NOT System.FileExtension:=.cpio.lzma AND NOT System.FileExtension:=.cpio.xz AND NOT System.FileExtension:=.cpio.zst AND NOT System.FileExtension:=.cue AND NOT System.FileExtension:=.dar AND NOT System.FileExtension:=.dd AND NOT System.FileExtension:=.deb AND NOT System.FileExtension:=.dmg AND NOT System.FileExtension:=.dsk AND NOT System.FileExtension:=.e01 AND NOT System.FileExtension:=.epub AND NOT System.FileExtension:=.ex01 AND NOT System.FileExtension:=.gz AND NOT System.FileExtension:=.img AND NOT System.FileExtension:=.ipa AND NOT System.FileExtension:=.iso AND NOT System.FileExtension:=.isz AND NOT System.FileExtension:=.jar AND NOT System.FileExtension:=.lha AND NOT System.FileExtension:=.lib AND NOT System.FileExtension:=.lz AND NOT System.FileExtension:=.lz4 AND NOT System.FileExtension:=.lzh AND NOT System.FileExtension:=.lzma AND NOT System.FileExtension:=.lzo AND NOT System.FileExtension:=.mdf AND NOT System.FileExtension:=.mds AND NOT System.FileExtension:=.msi AND NOT System.FileExtension:=.mtree AND NOT System.FileExtension:=.nrg AND NOT System.FileExtension:=.pax AND NOT System.FileExtension:=.pkg AND NOT System.FileExtension:=.qcow AND NOT System.FileExtension:=.qcow2 AND NOT System.FileExtension:=.rar AND NOT System.FileExtension:=.raw AND NOT System.FileExtension:=.rpm AND NOT System.FileExtension:=.sevenz AND NOT System.FileExtension:=.sqfs AND NOT System.FileExtension:=.squashfs AND NOT System.FileExtension:=.swm AND NOT System.FileExtension:=.tar AND NOT System.FileExtension:=.tar.b64 AND NOT System.FileExtension:=.tar.br AND NOT System.FileExtension:=.tar.bz2 AND NOT System.FileExtension:=.tar.gz AND NOT System.FileExtension:=.tar.lrz AND NOT System.FileExtension:=.tar.lz AND NOT System.FileExtension:=.tar.lz4 AND NOT System.FileExtension:=.tar.lzma AND NOT System.FileExtension:=.tar.lzo AND NOT System.FileExtension:=.tar.uu AND NOT System.FileExtension:=.tar.xz AND NOT System.FileExtension:=.tar.z AND NOT System.FileExtension:=.tar.zst AND NOT System.FileExtension:=.taz AND NOT System.FileExtension:=.tbz AND NOT System.FileExtension:=.tbz2 AND NOT System.FileExtension:=.tgz AND NOT System.FileExtension:=.tlzma AND NOT System.FileExtension:=.txz AND NOT System.FileExtension:=.tzap AND NOT System.FileExtension:=.tzst AND NOT System.FileExtension:=.udf AND NOT System.FileExtension:=.ustar AND NOT System.FileExtension:=.uu AND NOT System.FileExtension:=.vdi AND NOT System.FileExtension:=.vhd AND NOT System.FileExtension:=.vhdx AND NOT System.FileExtension:=.vmdk AND NOT System.FileExtension:=.vol000.tzap AND NOT System.FileExtension:=.war AND NOT System.FileExtension:=.warc AND NOT System.FileExtension:=.wim AND NOT System.FileExtension:=.xar AND NOT System.FileExtension:=.xpi AND NOT System.FileExtension:=.xz AND NOT System.FileExtension:=.z AND NOT System.FileExtension:=.zip AND NOT System.FileExtension:=.zipx AND NOT System.FileExtension:=.zst"

!macro ZM_WRITE_STATIC_CASCADE_MENU SHELL_KEY SUBCOMMANDS_KEY
  DeleteRegValue HKCU "${SHELL_KEY}\${ZM_MENU_KEY}" "SubCommands"
  DeleteRegValue HKCU "${SHELL_KEY}\${ZM_MENU_KEY}" "ExplorerCommandHandler"
  DeleteRegKey HKCU "${SHELL_KEY}\${ZM_MENU_KEY}\ExtendedSubCommandsKey"
  WriteRegStr HKCU "${SHELL_KEY}\${ZM_MENU_KEY}" "MUIVerb" "ZManager"
  WriteRegStr HKCU "${SHELL_KEY}\${ZM_MENU_KEY}" "Icon" "$INSTDIR\${ZM_EXE_NAME}"
  WriteRegStr HKCU "${SHELL_KEY}\${ZM_MENU_KEY}" "ExtendedSubCommandsKey" "${SUBCOMMANDS_KEY}"
  WriteRegStr HKCU "${SHELL_KEY}\${ZM_MENU_KEY}" "MultiSelectModel" "Player"
!macroend

!macro ZM_WRITE_COMMAND_SUBCOMMAND_VERB SUBCOMMANDS_KEY VERB_NAME LABEL QUICK_ACTION TARGET_TOKEN
  WriteRegStr HKCU "Software\Classes\${SUBCOMMANDS_KEY}\shell\${VERB_NAME}" "MUIVerb" "${LABEL}"
  WriteRegStr HKCU "Software\Classes\${SUBCOMMANDS_KEY}\shell\${VERB_NAME}" "Icon" "$INSTDIR\${ZM_EXE_NAME}"
  WriteRegStr HKCU "Software\Classes\${SUBCOMMANDS_KEY}\shell\${VERB_NAME}" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\${SUBCOMMANDS_KEY}\shell\${VERB_NAME}\command" "" "$\"$INSTDIR\${ZM_EXE_NAME}$\" --quick-action ${QUICK_ACTION} --path $\"${TARGET_TOKEN}$\""
!macroend

; Match the 7-Zip registration model: Explorer creates the COM object through
; the classic ContextMenuHandlers contract, then calls IShellExtInit and
; IContextMenu on the registered class.
!macro ZM_REGISTER_CLASSIC_CONTEXT_MENU_HANDLER SHELL_KEY
  WriteRegStr HKCU "Software\Classes\${SHELL_KEY}\shellex\ContextMenuHandlers\${ZM_CLASSIC_CONTEXT_MENU_KEY}" "" "${ZM_CREATE_ROOT_CLSID}"
!macroend

!macro ZM_UNREGISTER_CLASSIC_CONTEXT_MENU_HANDLER SHELL_KEY
  DeleteRegKey HKCU "Software\Classes\${SHELL_KEY}\shellex\ContextMenuHandlers\${ZM_CLASSIC_CONTEXT_MENU_KEY}"
!macroend

; Same CLSID layout 7-Zip writes from DllRegisterServer: a friendly name on the
; class key, the in-process server, and the Apartment threading model. The
; Approved list is only consulted when the shell-extension security policy is
; enabled, and it lives under HKLM, so a per-user install writes it
; best-effort and keeps going when it is not elevated.
!macro ZM_REGISTER_COM_CLASS CLSID
  WriteRegStr HKCU "Software\Classes\CLSID\${CLSID}" "" "${ZM_SHELL_EXTENSION_DESCRIPTION}"
  WriteRegStr HKCU "Software\Classes\CLSID\${CLSID}\InprocServer32" "" "$INSTDIR\${ZM_SHELL_EXTENSION_NAME}"
  WriteRegStr HKCU "Software\Classes\CLSID\${CLSID}\InprocServer32" "ThreadingModel" "Apartment"
  ClearErrors
  WriteRegStr HKLM "${ZM_APPROVED_SHELL_EXTENSIONS_KEY}" "${CLSID}" "${ZM_SHELL_EXTENSION_DESCRIPTION}"
  ClearErrors
!macroend

!macro ZM_UNREGISTER_COM_CLASS CLSID
  DeleteRegKey HKCU "Software\Classes\CLSID\${CLSID}"
  ClearErrors
  DeleteRegValue HKLM "${ZM_APPROVED_SHELL_EXTENSIONS_KEY}" "${CLSID}"
  ClearErrors
!macroend

!include "${__FILEDIR__}\nsis-shell-actions.generated.nsh"

!macro ZM_REGISTER_SHELL_EXTENSION_CLASSES
  !insertmacro ZM_REGISTER_GENERATED_SHELL_EXTENSION_CLASSES
!macroend

!macro ZM_UNREGISTER_SHELL_EXTENSION_CLASSES
  !insertmacro ZM_UNREGISTER_GENERATED_SHELL_EXTENSION_CLASSES
!macroend

!macro ZM_DELETE_SUBCOMMANDS SUBCOMMANDS_KEY
  DeleteRegKey HKCU "Software\Classes\${SUBCOMMANDS_KEY}"
!macroend

!macro ZM_DELETE_RETIRED_COMMANDSTORE_VERB COMMAND_NAME
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\CommandStore\shell\${COMMAND_NAME}"
!macroend

!macro ZM_UNREGISTER_RETIRED_COMMANDSTORE_VERBS
  !insertmacro ZM_DELETE_RETIRED_COMMANDSTORE_VERB "ZManager.OpenArchive"
  !insertmacro ZM_DELETE_RETIRED_COMMANDSTORE_VERB "ZManager.ExtractHere"
  !insertmacro ZM_DELETE_RETIRED_COMMANDSTORE_VERB "ZManager.AddToArchiveFile"
  !insertmacro ZM_DELETE_RETIRED_COMMANDSTORE_VERB "ZManager.AddToTzapFile"
  !insertmacro ZM_DELETE_RETIRED_COMMANDSTORE_VERB "ZManager.AddToZipFile"
  !insertmacro ZM_DELETE_RETIRED_COMMANDSTORE_VERB "ZManager.AddToSevenZFile"
  !insertmacro ZM_DELETE_RETIRED_COMMANDSTORE_VERB "ZManager.AddToTzstFile"
  !insertmacro ZM_DELETE_RETIRED_COMMANDSTORE_VERB "ZManager.AddToArchiveBackground"
  !insertmacro ZM_DELETE_RETIRED_COMMANDSTORE_VERB "ZManager.AddToTzapBackground"
  !insertmacro ZM_DELETE_RETIRED_COMMANDSTORE_VERB "ZManager.AddToZipBackground"
  !insertmacro ZM_DELETE_RETIRED_COMMANDSTORE_VERB "ZManager.AddToSevenZBackground"
  !insertmacro ZM_DELETE_RETIRED_COMMANDSTORE_VERB "ZManager.AddToTzstBackground"
  !insertmacro ZM_DELETE_RETIRED_COMMANDSTORE_VERB "ZManager.AddToTgzFile"
  !insertmacro ZM_DELETE_RETIRED_COMMANDSTORE_VERB "ZManager.AddToTgzBackground"
!macroend

!macro ZM_UNREGISTER_ORDERED_SUBCOMMANDS
  !insertmacro ZM_DELETE_SUBCOMMANDS "${ZM_ARCHIVE_SUBCOMMANDS_KEY}"
  !insertmacro ZM_DELETE_SUBCOMMANDS "${ZM_CREATE_FILE_SUBCOMMANDS_KEY}"
  !insertmacro ZM_DELETE_SUBCOMMANDS "${ZM_CREATE_BACKGROUND_SUBCOMMANDS_KEY}"
!macroend

!macro ZM_WRITE_BACKGROUND_CREATE_CASCADE_MENU SHELL_KEY
  !insertmacro ZM_WRITE_STATIC_CASCADE_MENU "${SHELL_KEY}" "${ZM_CREATE_BACKGROUND_SUBCOMMANDS_KEY}"
  !insertmacro ZM_REGISTER_GENERATED_BACKGROUND_SUBCOMMANDS "${ZM_CREATE_BACKGROUND_SUBCOMMANDS_KEY}"
!macroend

!macro ZM_DELETE_CONTEXT_VERB SHELL_KEY VERB_NAME
  DeleteRegKey HKCU "${SHELL_KEY}\${ZM_VERB_PREFIX}${VERB_NAME}"
!macroend

!macro ZM_DELETE_CASCADE_MENU SHELL_KEY
  DeleteRegKey HKCU "${SHELL_KEY}\${ZM_MENU_KEY}"
!macroend

; Archive extensions need no registration of their own. Like 7-Zip, the single
; handler on "*" sees the whole selection and decides for itself whether the
; extract actions apply, so this macro only clears registrations left behind by
; earlier per-extension releases.
!macro ZM_REGISTER_ARCHIVE_EXTENSION EXTENSION
  !insertmacro ZM_DELETE_CONTEXT_VERB "Software\Classes\SystemFileAssociations\${EXTENSION}\shell" "Extract"
  !insertmacro ZM_DELETE_CASCADE_MENU "Software\Classes\SystemFileAssociations\${EXTENSION}\shell"
  !insertmacro ZM_UNREGISTER_CLASSIC_CONTEXT_MENU_HANDLER "SystemFileAssociations\${EXTENSION}"
!macroend

!macro ZM_UNREGISTER_ARCHIVE_EXTENSION EXTENSION
  !insertmacro ZM_DELETE_CASCADE_MENU "Software\Classes\SystemFileAssociations\${EXTENSION}\shell"
  !insertmacro ZM_UNREGISTER_CLASSIC_CONTEXT_MENU_HANDLER "SystemFileAssociations\${EXTENSION}"
  !insertmacro ZM_DELETE_CONTEXT_VERB "Software\Classes\SystemFileAssociations\${EXTENSION}\shell" "Extract"
  !insertmacro ZM_DELETE_CONTEXT_VERB "Software\Classes\SystemFileAssociations\${EXTENSION}\shell" "ExtractHere"
  !insertmacro ZM_DELETE_CONTEXT_VERB "Software\Classes\SystemFileAssociations\${EXTENSION}\shell" "ExtractToFolder"
!macroend

!macro ZM_UNREGISTER_RETIRED_ARCHIVE_EXTENSION_VERBS_FOR EXTENSION
  !insertmacro ZM_DELETE_CONTEXT_VERB "Software\Classes\SystemFileAssociations\${EXTENSION}\shell" "ExtractHere"
  !insertmacro ZM_DELETE_CONTEXT_VERB "Software\Classes\SystemFileAssociations\${EXTENSION}\shell" "ExtractToFolder"
!macroend

!macro ZM_REGISTER_ARCHIVE_EXTENSIONS
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".7z"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".7z.001"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".a"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".aar"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".ad1"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".aea"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".aff4"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".apk"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".appimage"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".appx"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".ar"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".b64"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".br"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".bz2"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".cab"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".cb7"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".cbr"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".cbt"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".cbz"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".ccd"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".cdi"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".cpgz"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".cpio"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".cpio.bz2"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".cpio.gz"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".cpio.lzma"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".cpio.xz"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".cpio.zst"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".cue"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".dar"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".dd"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".deb"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".dmg"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".dsk"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".e01"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".epub"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".ex01"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".gz"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".img"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".ipa"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".iso"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".isz"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".jar"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".lha"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".lib"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".lz"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".lz4"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".lzh"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".lzma"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".lzo"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".mdf"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".mds"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".msi"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".mtree"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".nrg"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".pax"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".pkg"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".qcow"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".qcow2"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".rar"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".raw"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".rpm"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".sevenz"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".sqfs"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".squashfs"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".swm"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".tar"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".tar.b64"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".tar.br"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".tar.bz2"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".tar.gz"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".tar.lrz"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".tar.lz"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".tar.lz4"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".tar.lzma"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".tar.lzo"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".tar.uu"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".tar.xz"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".tar.z"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".tar.zst"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".taz"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".tbz"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".tbz2"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".tgz"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".tlzma"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".txz"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".tzap"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".tzst"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".udf"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".ustar"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".uu"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".vdi"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".vhd"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".vhdx"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".vmdk"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".vol000.tzap"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".war"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".warc"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".wim"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".xar"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".xpi"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".xz"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".z"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".zip"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".zipx"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSION ".zst"
!macroend

!macro ZM_UNREGISTER_ARCHIVE_EXTENSIONS
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".7z"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".7z.001"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".a"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".aar"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".ad1"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".aea"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".aff4"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".apk"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".appimage"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".appx"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".ar"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".b64"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".br"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".bz2"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".cab"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".cb7"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".cbr"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".cbt"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".cbz"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".ccd"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".cdi"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".cpgz"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".cpio"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".cpio.bz2"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".cpio.gz"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".cpio.lzma"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".cpio.xz"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".cpio.zst"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".cue"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".dar"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".dd"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".deb"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".dmg"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".dsk"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".e01"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".epub"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".ex01"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".gz"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".img"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".ipa"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".iso"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".isz"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".jar"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".lha"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".lib"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".lz"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".lz4"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".lzh"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".lzma"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".lzo"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".mdf"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".mds"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".msi"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".mtree"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".nrg"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".pax"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".pkg"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".qcow"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".qcow2"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".rar"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".raw"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".rpm"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".sevenz"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".sqfs"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".squashfs"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".swm"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".tar"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".tar.b64"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".tar.br"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".tar.bz2"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".tar.gz"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".tar.lrz"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".tar.lz"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".tar.lz4"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".tar.lzma"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".tar.lzo"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".tar.uu"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".tar.xz"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".tar.z"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".tar.zst"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".taz"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".tbz"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".tbz2"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".tgz"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".tlzma"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".txz"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".tzap"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".tzst"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".udf"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".ustar"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".uu"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".vdi"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".vhd"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".vhdx"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".vmdk"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".vol000.tzap"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".war"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".warc"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".wim"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".xar"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".xpi"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".xz"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".z"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".zip"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".zipx"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSION ".zst"
!macroend

!macro ZM_UNREGISTER_RETIRED_ARCHIVE_EXTENSION_VERBS
  !insertmacro ZM_UNREGISTER_RETIRED_ARCHIVE_EXTENSION_VERBS_FOR ".zip"
  !insertmacro ZM_UNREGISTER_RETIRED_ARCHIVE_EXTENSION_VERBS_FOR ".zipx"
  !insertmacro ZM_UNREGISTER_RETIRED_ARCHIVE_EXTENSION_VERBS_FOR ".7z"
  !insertmacro ZM_UNREGISTER_RETIRED_ARCHIVE_EXTENSION_VERBS_FOR ".rar"
  !insertmacro ZM_UNREGISTER_RETIRED_ARCHIVE_EXTENSION_VERBS_FOR ".tar"
  !insertmacro ZM_UNREGISTER_RETIRED_ARCHIVE_EXTENSION_VERBS_FOR ".gz"
  !insertmacro ZM_UNREGISTER_RETIRED_ARCHIVE_EXTENSION_VERBS_FOR ".tgz"
  !insertmacro ZM_UNREGISTER_RETIRED_ARCHIVE_EXTENSION_VERBS_FOR ".xz"
  !insertmacro ZM_UNREGISTER_RETIRED_ARCHIVE_EXTENSION_VERBS_FOR ".txz"
  !insertmacro ZM_UNREGISTER_RETIRED_ARCHIVE_EXTENSION_VERBS_FOR ".zst"
  !insertmacro ZM_UNREGISTER_RETIRED_ARCHIVE_EXTENSION_VERBS_FOR ".tzst"
  !insertmacro ZM_UNREGISTER_RETIRED_ARCHIVE_EXTENSION_VERBS_FOR ".tzap"
!macroend

!macro ZM_REFRESH_SHELL_ASSOCIATIONS
  ; SHCNE_ASSOCCHANGED (0x08000000) with SHCNF_FLUSHNOWAIT (0x2000) tells
  ; Explorer to re-read the registry without making the silent installer wait
  ; indefinitely for every shell listener to acknowledge the notification.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x2000, i 0, i 0)'
  ; WM_SETTINGCHANGE (0x001A) broadcast ensures any loaded Explorer shell views
  ; pick up the new registry entries without waiting for the next process start.
  System::Call 'user32::SendMessageTimeoutW(i 0xFFFF, i 0x001A, i 0, w "Shell", i 0x0002, i 5000, *i 0)'
!macroend

; Set when a current or stale handler image may still be loaded by a shell
; process. Windows can successfully delete the pathname while keeping the
; mapped image alive until that process exits.
Var /GLOBAL ZM_ShellExtensionWasLocked
Var /GLOBAL ZM_CurrentShellExtensionWasLocked
Var /GLOBAL ZM_PreviousShellActionRequestVersion
Var /GLOBAL ZM_InstalledShellActionRequestVersion
Var /GLOBAL ZM_ShellExtensionBackupCounter
Var /GLOBAL ZM_UninstallShellExtensionWasLocked

; Clear all renamed handler images we can release. If any image may remain
; loaded, keep the compatibility marker until an explicit shell restart.
!macro ZM_CLEANUP_STALE_SHELL_EXTENSION_IMAGES SUFFIX
  ClearErrors
  IfFileExists "$INSTDIR\${ZM_SHELL_EXTENSION_NAME}.old" 0 zm_shell_cleanup_delete_legacy_${SUFFIX}
  ; After an explicit Explorer restart, successful deletion is sufficient
  ; evidence that the previous mapping has been released.
  StrCmp "${SUFFIX}" "RESTART" zm_shell_cleanup_delete_legacy_${SUFFIX}
  StrCpy $ZM_ShellExtensionWasLocked "1"
  IntCmp $ZM_PreviousShellActionRequestVersion 0 zm_shell_cleanup_seed_legacy_before_delete_${SUFFIX} zm_shell_cleanup_delete_legacy_${SUFFIX} zm_shell_cleanup_delete_legacy_${SUFFIX}
zm_shell_cleanup_seed_legacy_before_delete_${SUFFIX}:
  StrCpy $ZM_PreviousShellActionRequestVersion $ZM_InstalledShellActionRequestVersion
  Goto zm_shell_cleanup_delete_legacy_${SUFFIX}
zm_shell_cleanup_delete_legacy_${SUFFIX}:
  Delete "$INSTDIR\${ZM_SHELL_EXTENSION_NAME}.old"
  IfErrors zm_shell_cleanup_legacy_locked_${SUFFIX}
  Goto zm_shell_cleanup_find_backups_${SUFFIX}
zm_shell_cleanup_legacy_locked_${SUFFIX}:
  StrCpy $ZM_ShellExtensionWasLocked "1"
  IntCmp $ZM_PreviousShellActionRequestVersion 0 zm_shell_cleanup_seed_legacy_pending_${SUFFIX} zm_shell_cleanup_find_backups_${SUFFIX} zm_shell_cleanup_find_backups_${SUFFIX}
zm_shell_cleanup_seed_legacy_pending_${SUFFIX}:
  StrCpy $ZM_PreviousShellActionRequestVersion $ZM_InstalledShellActionRequestVersion
zm_shell_cleanup_find_backups_${SUFFIX}:
  FindFirst $R0 $R1 "$INSTDIR\${ZM_SHELL_EXTENSION_NAME}.old.*"
zm_shell_cleanup_backup_loop_${SUFFIX}:
  StrCmp $R1 "" zm_shell_cleanup_find_done_${SUFFIX}
  StrCmp "${SUFFIX}" "RESTART" zm_shell_cleanup_delete_backup_${SUFFIX}
  StrCpy $ZM_ShellExtensionWasLocked "1"
  IntCmp $ZM_PreviousShellActionRequestVersion 0 zm_shell_cleanup_seed_backup_before_delete_${SUFFIX} zm_shell_cleanup_delete_backup_${SUFFIX} zm_shell_cleanup_delete_backup_${SUFFIX}
zm_shell_cleanup_seed_backup_before_delete_${SUFFIX}:
  StrCpy $ZM_PreviousShellActionRequestVersion $ZM_InstalledShellActionRequestVersion
  Goto zm_shell_cleanup_delete_backup_${SUFFIX}
zm_shell_cleanup_delete_backup_${SUFFIX}:
  ClearErrors
  Delete "$INSTDIR\$R1"
  IfErrors zm_shell_cleanup_backup_locked_${SUFFIX}
  FindNext $R0 $R1
  Goto zm_shell_cleanup_backup_loop_${SUFFIX}
zm_shell_cleanup_backup_locked_${SUFFIX}:
  StrCpy $ZM_ShellExtensionWasLocked "1"
  IntCmp $ZM_PreviousShellActionRequestVersion 0 zm_shell_cleanup_seed_backup_pending_${SUFFIX} zm_shell_cleanup_find_next_backup_${SUFFIX} zm_shell_cleanup_find_next_backup_${SUFFIX}
zm_shell_cleanup_seed_backup_pending_${SUFFIX}:
  StrCpy $ZM_PreviousShellActionRequestVersion $ZM_InstalledShellActionRequestVersion
zm_shell_cleanup_find_next_backup_${SUFFIX}:
  FindNext $R0 $R1
  Goto zm_shell_cleanup_backup_loop_${SUFFIX}
zm_shell_cleanup_find_done_${SUFFIX}:
  FindClose $R0
  FindFirst $R0 $R1 "$INSTDIR\*.zmanager-uninstall-pending"
zm_shell_cleanup_uninstall_pending_loop_${SUFFIX}:
  StrCmp $R1 "" zm_shell_cleanup_uninstall_pending_done_${SUFFIX}
  StrCmp "${SUFFIX}" "RESTART" zm_shell_cleanup_delete_uninstall_pending_${SUFFIX}
  StrCpy $ZM_ShellExtensionWasLocked "1"
  IntCmp $ZM_PreviousShellActionRequestVersion 0 zm_shell_cleanup_seed_uninstall_before_delete_${SUFFIX} zm_shell_cleanup_delete_uninstall_pending_${SUFFIX} zm_shell_cleanup_delete_uninstall_pending_${SUFFIX}
zm_shell_cleanup_seed_uninstall_before_delete_${SUFFIX}:
  StrCpy $ZM_PreviousShellActionRequestVersion $ZM_InstalledShellActionRequestVersion
  Goto zm_shell_cleanup_delete_uninstall_pending_${SUFFIX}
zm_shell_cleanup_delete_uninstall_pending_${SUFFIX}:
  ClearErrors
  Delete "$INSTDIR\$R1"
  IfErrors zm_shell_cleanup_uninstall_pending_locked_${SUFFIX}
  FindNext $R0 $R1
  Goto zm_shell_cleanup_uninstall_pending_loop_${SUFFIX}
zm_shell_cleanup_uninstall_pending_locked_${SUFFIX}:
  StrCpy $ZM_ShellExtensionWasLocked "1"
  IntCmp $ZM_PreviousShellActionRequestVersion 0 zm_shell_cleanup_seed_uninstall_pending_${SUFFIX} zm_shell_cleanup_find_next_uninstall_pending_${SUFFIX} zm_shell_cleanup_find_next_uninstall_pending_${SUFFIX}
zm_shell_cleanup_seed_uninstall_pending_${SUFFIX}:
  StrCpy $ZM_PreviousShellActionRequestVersion $ZM_InstalledShellActionRequestVersion
zm_shell_cleanup_find_next_uninstall_pending_${SUFFIX}:
  FindNext $R0 $R1
  Goto zm_shell_cleanup_uninstall_pending_loop_${SUFFIX}
zm_shell_cleanup_uninstall_pending_done_${SUFFIX}:
  FindClose $R0
  StrCmp $ZM_ShellExtensionWasLocked "1" zm_shell_cleanup_done_${SUFFIX}
  DeleteRegValue HKCU "Software\ZManager\ShellIntegration" "PendingLoadedRequestVersion"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\RunOnce" "ZManagerShellCleanup"
  StrCpy $ZM_PreviousShellActionRequestVersion "0"
zm_shell_cleanup_done_${SUFFIX}:
!macroend

; Capture the request protocol associated with the installed DLL before
; replacing it. Releases before this marker existed shipped request version 1,
; so use that as the legacy default when an old DLL is present. Renaming a
; loaded DLL within its directory lets the app update immediately; the old
; image remains mapped in the current shell process until it exits.
!macro ZM_INSTALL_SHELL_EXTENSION_BINARY
  StrCpy $ZM_ShellExtensionWasLocked "0"
  ReadRegDWORD $ZM_InstalledShellActionRequestVersion HKCU "Software\ZManager\ShellIntegration" "InstalledRequestVersion"
  IfErrors zm_shell_extension_read_legacy_version zm_shell_extension_read_pending_version
zm_shell_extension_read_legacy_version:
  IfFileExists "$INSTDIR\${ZM_SHELL_EXTENSION_NAME}" 0 zm_shell_extension_check_legacy_old_image
  StrCpy $ZM_InstalledShellActionRequestVersion "1"
  Goto zm_shell_extension_read_pending_version
zm_shell_extension_check_legacy_old_image:
  IfFileExists "$INSTDIR\${ZM_SHELL_EXTENSION_NAME}.old" 0 zm_shell_extension_check_legacy_versioned_image
  StrCpy $ZM_InstalledShellActionRequestVersion "1"
  Goto zm_shell_extension_read_pending_version
zm_shell_extension_check_legacy_versioned_image:
  FindFirst $R0 $R1 "$INSTDIR\${ZM_SHELL_EXTENSION_NAME}.old.*"
  FindClose $R0
  StrCmp $R1 "" zm_shell_extension_no_previous_version
  StrCpy $ZM_InstalledShellActionRequestVersion "1"
  Goto zm_shell_extension_read_pending_version
zm_shell_extension_no_previous_version:
  StrCpy $ZM_InstalledShellActionRequestVersion "0"
zm_shell_extension_read_pending_version:
  ReadRegDWORD $ZM_PreviousShellActionRequestVersion HKCU "Software\ZManager\ShellIntegration" "PendingLoadedRequestVersion"
  IfErrors 0 zm_shell_extension_version_ready
  StrCpy $ZM_PreviousShellActionRequestVersion "0"
zm_shell_extension_version_ready:
  StrCpy $ZM_ShellExtensionWasLocked "0"
  IntCmp $ZM_PreviousShellActionRequestVersion 0 zm_shell_extension_pending_marker_ready zm_shell_extension_pending_marker_loaded zm_shell_extension_pending_marker_loaded
zm_shell_extension_pending_marker_loaded:
  ; An uninstall may have removed the DLL pathname while Explorer still has
  ; the image mapped. Carry that compatibility state across reinstall.
  StrCpy $ZM_ShellExtensionWasLocked "1"
zm_shell_extension_pending_marker_ready:
  StrCpy $ZM_CurrentShellExtensionWasLocked "0"
  !insertmacro ZM_CLEANUP_STALE_SHELL_EXTENSION_IMAGES INSTALL
zm_shell_extension_delete_current:
  ; A successful DeleteFile can mark a mapped image for deletion and hide its
  ; pathname immediately. Keep its protocol as potentially loaded for this
  ; install; testing only the NSIS error flag misses that Windows behavior.
  IfFileExists "$INSTDIR\${ZM_SHELL_EXTENSION_NAME}" 0 zm_shell_extension_delete_current_file
  StrCpy $ZM_ShellExtensionWasLocked "1"
  StrCpy $ZM_CurrentShellExtensionWasLocked "1"
  IntCmp $ZM_PreviousShellActionRequestVersion 0 zm_shell_extension_seed_current_protocol zm_shell_extension_delete_current_file zm_shell_extension_delete_current_file
zm_shell_extension_seed_current_protocol:
  StrCpy $ZM_PreviousShellActionRequestVersion $ZM_InstalledShellActionRequestVersion
zm_shell_extension_delete_current_file:
  ClearErrors
  Delete "$INSTDIR\${ZM_SHELL_EXTENSION_NAME}"
  IfErrors zm_shell_extension_current_locked zm_shell_extension_binary_write
zm_shell_extension_current_locked:
  StrCpy $ZM_ShellExtensionWasLocked "1"
  StrCpy $ZM_CurrentShellExtensionWasLocked "1"
  ; If multiple older images remain loaded, retain the lowest protocol marker.
  IntCmp $ZM_PreviousShellActionRequestVersion 0 zm_shell_extension_use_installed_protocol_for_current zm_shell_extension_compare_protocol_generations zm_shell_extension_compare_protocol_generations
zm_shell_extension_compare_protocol_generations:
  IntCmp $ZM_PreviousShellActionRequestVersion $ZM_InstalledShellActionRequestVersion zm_shell_extension_keep_previous_protocol zm_shell_extension_keep_previous_protocol zm_shell_extension_use_installed_protocol_for_current
zm_shell_extension_keep_previous_protocol:
  Goto zm_shell_extension_rename_current
zm_shell_extension_use_installed_protocol_for_current:
  StrCpy $ZM_PreviousShellActionRequestVersion $ZM_InstalledShellActionRequestVersion
zm_shell_extension_rename_current:
  StrCpy $ZM_ShellExtensionBackupCounter "0"
zm_shell_extension_choose_backup_name:
  IntOp $ZM_ShellExtensionBackupCounter $ZM_ShellExtensionBackupCounter + 1
  IfFileExists "$INSTDIR\${ZM_SHELL_EXTENSION_NAME}.old.$ZM_ShellExtensionBackupCounter" zm_shell_extension_choose_backup_name
  ClearErrors
  Rename "$INSTDIR\${ZM_SHELL_EXTENSION_NAME}" "$INSTDIR\${ZM_SHELL_EXTENSION_NAME}.old.$ZM_ShellExtensionBackupCounter"
  IfErrors 0 zm_shell_extension_rename_complete
  Abort "Could not stage the loaded shell handler for update. Close applications using Explorer and try again."
zm_shell_extension_rename_complete:
  ClearErrors
zm_shell_extension_binary_write:
  SetOverwrite on
  File /oname=${ZM_SHELL_EXTENSION_NAME} "${ZM_SHELL_EXTENSION_SOURCE}"
  IfFileExists "$INSTDIR\${ZM_SHELL_EXTENSION_NAME}" zm_shell_extension_binary_done
  Abort "Failed to install ${ZM_SHELL_EXTENSION_NAME}; the ZManager context menu would not work."
zm_shell_extension_binary_done:
  WriteRegDWORD HKCU "Software\ZManager\ShellIntegration" "InstalledRequestVersion" ${ZM_SHELL_ACTION_REQUEST_VERSION}
  StrCmp $ZM_ShellExtensionWasLocked "1" zm_shell_extension_record_pending_protocol zm_shell_extension_clear_pending_protocol
zm_shell_extension_record_pending_protocol:
  WriteRegDWORD HKCU "Software\ZManager\ShellIntegration" "PendingLoadedRequestVersion" $ZM_PreviousShellActionRequestVersion
  Goto zm_shell_extension_protocol_recorded
zm_shell_extension_clear_pending_protocol:
  DeleteRegValue HKCU "Software\ZManager\ShellIntegration" "PendingLoadedRequestVersion"
zm_shell_extension_protocol_recorded:
!macroend

; Existing handler requests inside the app's supported protocol range remain
; usable after the app updates. Leave their loaded image in place and let the
; next natural shell start load the new DLL. Only a protocol-incompatible old
; handler needs an immediate reload.
!macro ZM_RESTART_EXPLORER_IF_INCOMPATIBLE
  StrCmp $ZM_ShellExtensionWasLocked "1" 0 zm_explorer_restart_done
  IntCmp $ZM_PreviousShellActionRequestVersion ${ZM_MIN_SUPPORTED_SHELL_ACTION_REQUEST_VERSION} zm_shell_handler_protocol_compatible zm_shell_handler_protocol_incompatible zm_shell_handler_check_max
zm_shell_handler_check_max:
  IntCmp $ZM_PreviousShellActionRequestVersion ${ZM_SHELL_ACTION_REQUEST_VERSION} zm_shell_handler_protocol_compatible zm_shell_handler_protocol_compatible zm_shell_handler_protocol_incompatible
zm_shell_handler_protocol_compatible:
  StrCmp $ZM_CurrentShellExtensionWasLocked "1" 0 zm_shell_handler_all_compatible
  IntCmp $ZM_InstalledShellActionRequestVersion ${ZM_MIN_SUPPORTED_SHELL_ACTION_REQUEST_VERSION} zm_shell_handler_check_current_max zm_shell_handler_protocol_incompatible zm_shell_handler_check_current_max
zm_shell_handler_check_current_max:
  IntCmp $ZM_InstalledShellActionRequestVersion ${ZM_SHELL_ACTION_REQUEST_VERSION} zm_shell_handler_all_compatible zm_shell_handler_all_compatible zm_shell_handler_protocol_incompatible
zm_shell_handler_all_compatible:
  DetailPrint "The loaded ZManager shell handler is compatible and will refresh the next time Explorer starts."
  Goto zm_explorer_restart_done
zm_shell_handler_protocol_incompatible:
  IfSilent zm_explorer_restart_now
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "ZManager updated its Explorer context menu.$\r$\n$\r$\nWindows Explorer is still running the previous version and must restart before the menu works.$\r$\n$\r$\nRestart Explorer now? Your open Explorer windows will close." \
    IDYES zm_explorer_restart_now IDNO zm_explorer_restart_later
zm_explorer_restart_now:
  DetailPrint "Restarting Windows Explorer to load the updated context menu handler..."
  nsExec::Exec 'taskkill /F /IM explorer.exe'
  Pop $0
  Sleep 3000
  ; Windows normally relaunches the shell on its own (AutoRestartShell). Only
  ; start it manually when it did not come back, so we never open a stray window.
  FindWindow $0 "Shell_TrayWnd"
  IntCmp $0 0 zm_explorer_restart_launch zm_explorer_restart_cleanup zm_explorer_restart_cleanup
zm_explorer_restart_launch:
  Exec '$WINDIR\explorer.exe'
zm_explorer_restart_cleanup:
  ; Try to release every renamed image. A remaining copy is retried next
  ; install, without setting NSIS's reboot-required flag.
  StrCpy $ZM_ShellExtensionWasLocked "0"
  !insertmacro ZM_CLEANUP_STALE_SHELL_EXTENSION_IMAGES RESTART
  Goto zm_explorer_restart_done
zm_explorer_restart_later:
  DetailPrint "The ZManager context menu will finish updating after you sign out or restart."
zm_explorer_restart_done:
!macroend

!macro NSIS_HOOK_POSTINSTALL
  SetOutPath "$INSTDIR"
  !insertmacro ZM_INSTALL_SHELL_EXTENSION_BINARY
  !insertmacro ZM_UNREGISTER_RETIRED_SHELL_EXTENSION_CLASSES
  !insertmacro ZM_REGISTER_SHELL_EXTENSION_CLASSES
  !insertmacro ZM_DELETE_CONTEXT_VERB "Software\Classes\*\shell" "CompressZip"
  !insertmacro ZM_DELETE_CONTEXT_VERB "Software\Classes\*\shell" "CompressCleanSource"
  !insertmacro ZM_DELETE_CONTEXT_VERB "Software\Classes\Directory\shell" "CompressZip"
  !insertmacro ZM_DELETE_CONTEXT_VERB "Software\Classes\Directory\shell" "CompressCleanSource"
  !insertmacro ZM_DELETE_CONTEXT_VERB "Software\Classes\Directory\Background\shell" "CompressZip"
  !insertmacro ZM_DELETE_CONTEXT_VERB "Software\Classes\Directory\Background\shell" "CompressCleanSource"
  !insertmacro ZM_UNREGISTER_RETIRED_ARCHIVE_EXTENSION_VERBS
  !insertmacro ZM_UNREGISTER_RETIRED_COMMANDSTORE_VERBS
  !insertmacro ZM_UNREGISTER_ORDERED_SUBCOMMANDS
  !insertmacro ZM_DELETE_CONTEXT_VERB "Software\Classes\*\shell" "Compress"
  !insertmacro ZM_DELETE_CONTEXT_VERB "Software\Classes\Directory\shell" "Compress"
  !insertmacro ZM_DELETE_CONTEXT_VERB "Software\Classes\Directory\Background\shell" "Compress"
  !insertmacro ZM_DELETE_CASCADE_MENU "Software\Classes\*\shell"
  !insertmacro ZM_DELETE_CASCADE_MENU "Software\Classes\Directory\shell"
  !insertmacro ZM_DELETE_CASCADE_MENU "Software\Classes\Directory\Background\shell"
  !insertmacro ZM_REGISTER_CLASSIC_CONTEXT_MENU_HANDLER "*"
  !insertmacro ZM_REGISTER_CLASSIC_CONTEXT_MENU_HANDLER "Directory"
  !insertmacro ZM_REGISTER_CLASSIC_CONTEXT_MENU_HANDLER "Folder"
  !insertmacro ZM_WRITE_BACKGROUND_CREATE_CASCADE_MENU "Software\Classes\Directory\Background\shell"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSIONS
  !insertmacro ZM_REFRESH_SHELL_ASSOCIATIONS
  ; Last, so an incompatible loaded handler is refreshed only after registration.
  !insertmacro ZM_RESTART_EXPLORER_IF_INCOMPATIBLE
!macroend

!macro ZM_DELETE_OR_SCHEDULE_LOCKED_FILE PATH SUFFIX
  IfFileExists ${PATH} 0 zm_delete_or_schedule_done_${SUFFIX}
  StrCpy $ZM_UninstallShellExtensionWasLocked "1"
  IntCmp $ZM_PreviousShellActionRequestVersion 0 zm_uninstall_seed_protocol_for_${SUFFIX} zm_delete_or_schedule_file_${SUFFIX} zm_delete_or_schedule_file_${SUFFIX}
zm_uninstall_seed_protocol_for_${SUFFIX}:
  StrCpy $ZM_PreviousShellActionRequestVersion $ZM_InstalledShellActionRequestVersion
zm_delete_or_schedule_file_${SUFFIX}:
  ClearErrors
  Delete ${PATH}
  IfErrors zm_rename_locked_file_${SUFFIX} zm_delete_or_schedule_done_${SUFFIX}
zm_rename_locked_file_${SUFFIX}:
  ; Never queue deletion against a path a later installer may reuse.
  GetTempFileName $R3 "$INSTDIR"
  IfErrors zm_delete_or_schedule_done_${SUFFIX}
  ClearErrors
  Delete "$R3"
  IfErrors zm_delete_or_schedule_done_${SUFFIX}
  StrCpy $R3 "$R3.zmanager-uninstall-pending"
  Rename ${PATH} "$R3"
  IfErrors zm_delete_or_schedule_done_${SUFFIX}
  System::Call 'kernel32::MoveFileExW(w "$R3", p 0, i 4) i .r2'
  StrCmp $2 0 zm_register_user_shell_cleanup_${SUFFIX} zm_delete_or_schedule_done_${SUFFIX}
zm_register_user_shell_cleanup_${SUFFIX}:
  ; A per-user install may not have rights to write Session Manager's
  ; machine-wide pending-delete list. Retry after the next logon instead.
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\RunOnce" "ZManagerShellCleanup" '"$SYSDIR\cmd.exe" /D /C del /F /Q "$INSTDIR\*.zmanager-uninstall-pending" 2>nul & rmdir "$INSTDIR" 2>nul'
zm_delete_or_schedule_done_${SUFFIX}:
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  StrCpy $ZM_UninstallShellExtensionWasLocked "0"
  ReadRegDWORD $ZM_InstalledShellActionRequestVersion HKCU "Software\ZManager\ShellIntegration" "InstalledRequestVersion"
  IfErrors 0 zm_uninstall_read_pending_version
  StrCpy $ZM_InstalledShellActionRequestVersion "1"
zm_uninstall_read_pending_version:
  ReadRegDWORD $ZM_PreviousShellActionRequestVersion HKCU "Software\ZManager\ShellIntegration" "PendingLoadedRequestVersion"
  IfErrors 0 zm_uninstall_versions_ready
  StrCpy $ZM_PreviousShellActionRequestVersion "0"
zm_uninstall_versions_ready:
  !insertmacro ZM_UNREGISTER_CLASSIC_CONTEXT_MENU_HANDLER "*"
  !insertmacro ZM_UNREGISTER_CLASSIC_CONTEXT_MENU_HANDLER "Directory"
  !insertmacro ZM_UNREGISTER_CLASSIC_CONTEXT_MENU_HANDLER "Folder"
  !insertmacro ZM_DELETE_CASCADE_MENU "Software\Classes\*\shell"
  !insertmacro ZM_DELETE_CONTEXT_VERB "Software\Classes\*\shell" "Compress"
  !insertmacro ZM_DELETE_CONTEXT_VERB "Software\Classes\*\shell" "CompressZip"
  !insertmacro ZM_DELETE_CONTEXT_VERB "Software\Classes\*\shell" "CompressCleanSource"
  !insertmacro ZM_DELETE_CASCADE_MENU "Software\Classes\Directory\shell"
  !insertmacro ZM_DELETE_CONTEXT_VERB "Software\Classes\Directory\shell" "Compress"
  !insertmacro ZM_DELETE_CONTEXT_VERB "Software\Classes\Directory\shell" "CompressZip"
  !insertmacro ZM_DELETE_CONTEXT_VERB "Software\Classes\Directory\shell" "CompressCleanSource"
  !insertmacro ZM_DELETE_CASCADE_MENU "Software\Classes\Directory\Background\shell"
  !insertmacro ZM_DELETE_CONTEXT_VERB "Software\Classes\Directory\Background\shell" "Compress"
  !insertmacro ZM_DELETE_CONTEXT_VERB "Software\Classes\Directory\Background\shell" "CompressZip"
  !insertmacro ZM_DELETE_CONTEXT_VERB "Software\Classes\Directory\Background\shell" "CompressCleanSource"
  !insertmacro ZM_UNREGISTER_ARCHIVE_EXTENSIONS
  !insertmacro ZM_UNREGISTER_ORDERED_SUBCOMMANDS
  !insertmacro ZM_UNREGISTER_RETIRED_SHELL_EXTENSION_CLASSES
  !insertmacro ZM_UNREGISTER_RETIRED_COMMANDSTORE_VERBS
  !insertmacro ZM_UNREGISTER_SHELL_EXTENSION_CLASSES
  !insertmacro ZM_REFRESH_SHELL_ASSOCIATIONS
  ; Like 7-Zip, try immediate removal first and queue a locked image for the
  ; next reboot. MoveFileEx does not set NSIS's reboot-required flag, so this
  ; never prompts the user to restart just to finish uninstalling.
  !insertmacro ZM_DELETE_OR_SCHEDULE_LOCKED_FILE "$INSTDIR\${ZM_SHELL_EXTENSION_NAME}" CURRENT
  !insertmacro ZM_DELETE_OR_SCHEDULE_LOCKED_FILE "$INSTDIR\${ZM_SHELL_EXTENSION_NAME}.old" LEGACY
  FindFirst $R0 $R1 "$INSTDIR\${ZM_SHELL_EXTENSION_NAME}.old.*"
zm_uninstall_old_image_loop:
  StrCmp $R1 "" zm_uninstall_old_images_done
  !insertmacro ZM_DELETE_OR_SCHEDULE_LOCKED_FILE "$INSTDIR\$R1" VERSIONED
  FindNext $R0 $R1
  Goto zm_uninstall_old_image_loop
zm_uninstall_old_images_done:
  FindClose $R0
  StrCmp $ZM_UninstallShellExtensionWasLocked "1" zm_uninstall_preserve_shell_protocol zm_uninstall_delete_shell_protocol
zm_uninstall_preserve_shell_protocol:
  IntCmp $ZM_PreviousShellActionRequestVersion 0 zm_uninstall_seed_shell_protocol zm_uninstall_write_pending_shell_protocol zm_uninstall_write_pending_shell_protocol
zm_uninstall_seed_shell_protocol:
  StrCpy $ZM_PreviousShellActionRequestVersion $ZM_InstalledShellActionRequestVersion
zm_uninstall_write_pending_shell_protocol:
  WriteRegDWORD HKCU "Software\ZManager\ShellIntegration" "PendingLoadedRequestVersion" $ZM_PreviousShellActionRequestVersion
  Goto zm_uninstall_shell_protocol_done
zm_uninstall_delete_shell_protocol:
  DeleteRegKey HKCU "Software\ZManager\ShellIntegration"
zm_uninstall_shell_protocol_done:
  ClearErrors
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; NSIS has removed the rest of the application files by this point. Queue
  ; the install directory after the locked DLL removals, matching 7-Zip's
  ; best-effort directory cleanup at reboot without requesting that reboot.
  IfFileExists "$INSTDIR" 0 zm_uninstall_directory_done
  System::Call 'kernel32::MoveFileExW(w "$INSTDIR", p 0, i 4) i .r0'
zm_uninstall_directory_done:
!macroend
