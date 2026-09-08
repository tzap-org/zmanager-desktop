!define ZM_EXE_NAME "zmanager-desktop.exe"
!define ZM_SHELL_EXTENSION_NAME "zmanager-shell-extension.dll"
!define ZM_SHELL_EXTENSION_SOURCE "${__FILEDIR__}\..\..\target\windows-shell-extension\zmanager-shell-extension.dll"
!define ZM_VERB_PREFIX "ZManager"
!define ZM_MENU_KEY "ZManager"
!define ZM_ARCHIVE_SUBCOMMANDS_KEY "ZManager.Desktop.ContextMenu.Archive"
!define ZM_CREATE_FILE_SUBCOMMANDS_KEY "ZManager.Desktop.ContextMenu.CreateFile"
!define ZM_CREATE_BACKGROUND_SUBCOMMANDS_KEY "ZManager.Desktop.ContextMenu.CreateBackground"
!define ZM_NON_ARCHIVE_FILE_APPLIES_TO "NOT System.FileExtension:=.7z AND NOT System.FileExtension:=.7z.001 AND NOT System.FileExtension:=.a AND NOT System.FileExtension:=.aar AND NOT System.FileExtension:=.ad1 AND NOT System.FileExtension:=.aea AND NOT System.FileExtension:=.aff4 AND NOT System.FileExtension:=.apk AND NOT System.FileExtension:=.appimage AND NOT System.FileExtension:=.appx AND NOT System.FileExtension:=.ar AND NOT System.FileExtension:=.b64 AND NOT System.FileExtension:=.br AND NOT System.FileExtension:=.bz2 AND NOT System.FileExtension:=.cab AND NOT System.FileExtension:=.cb7 AND NOT System.FileExtension:=.cbr AND NOT System.FileExtension:=.cbt AND NOT System.FileExtension:=.cbz AND NOT System.FileExtension:=.ccd AND NOT System.FileExtension:=.cdi AND NOT System.FileExtension:=.cpgz AND NOT System.FileExtension:=.cpio AND NOT System.FileExtension:=.cpio.bz2 AND NOT System.FileExtension:=.cpio.gz AND NOT System.FileExtension:=.cpio.lzma AND NOT System.FileExtension:=.cpio.xz AND NOT System.FileExtension:=.cpio.zst AND NOT System.FileExtension:=.cue AND NOT System.FileExtension:=.dar AND NOT System.FileExtension:=.dd AND NOT System.FileExtension:=.deb AND NOT System.FileExtension:=.dmg AND NOT System.FileExtension:=.dsk AND NOT System.FileExtension:=.e01 AND NOT System.FileExtension:=.epub AND NOT System.FileExtension:=.ex01 AND NOT System.FileExtension:=.gz AND NOT System.FileExtension:=.img AND NOT System.FileExtension:=.ipa AND NOT System.FileExtension:=.iso AND NOT System.FileExtension:=.isz AND NOT System.FileExtension:=.jar AND NOT System.FileExtension:=.lha AND NOT System.FileExtension:=.lib AND NOT System.FileExtension:=.lz AND NOT System.FileExtension:=.lz4 AND NOT System.FileExtension:=.lzh AND NOT System.FileExtension:=.lzma AND NOT System.FileExtension:=.lzo AND NOT System.FileExtension:=.mdf AND NOT System.FileExtension:=.mds AND NOT System.FileExtension:=.msi AND NOT System.FileExtension:=.mtree AND NOT System.FileExtension:=.nrg AND NOT System.FileExtension:=.pax AND NOT System.FileExtension:=.pkg AND NOT System.FileExtension:=.qcow AND NOT System.FileExtension:=.qcow2 AND NOT System.FileExtension:=.rar AND NOT System.FileExtension:=.raw AND NOT System.FileExtension:=.rpm AND NOT System.FileExtension:=.sevenz AND NOT System.FileExtension:=.sqfs AND NOT System.FileExtension:=.squashfs AND NOT System.FileExtension:=.swm AND NOT System.FileExtension:=.tar AND NOT System.FileExtension:=.tar.b64 AND NOT System.FileExtension:=.tar.br AND NOT System.FileExtension:=.tar.bz2 AND NOT System.FileExtension:=.tar.gz AND NOT System.FileExtension:=.tar.lrz AND NOT System.FileExtension:=.tar.lz AND NOT System.FileExtension:=.tar.lz4 AND NOT System.FileExtension:=.tar.lzma AND NOT System.FileExtension:=.tar.lzo AND NOT System.FileExtension:=.tar.uu AND NOT System.FileExtension:=.tar.xz AND NOT System.FileExtension:=.tar.z AND NOT System.FileExtension:=.tar.zst AND NOT System.FileExtension:=.taz AND NOT System.FileExtension:=.tbz AND NOT System.FileExtension:=.tbz2 AND NOT System.FileExtension:=.tgz AND NOT System.FileExtension:=.tlzma AND NOT System.FileExtension:=.txz AND NOT System.FileExtension:=.tzap AND NOT System.FileExtension:=.tzst AND NOT System.FileExtension:=.udf AND NOT System.FileExtension:=.ustar AND NOT System.FileExtension:=.uu AND NOT System.FileExtension:=.vdi AND NOT System.FileExtension:=.vhd AND NOT System.FileExtension:=.vhdx AND NOT System.FileExtension:=.vmdk AND NOT System.FileExtension:=.vol000.tzap AND NOT System.FileExtension:=.war AND NOT System.FileExtension:=.warc AND NOT System.FileExtension:=.wim AND NOT System.FileExtension:=.xar AND NOT System.FileExtension:=.xpi AND NOT System.FileExtension:=.xz AND NOT System.FileExtension:=.z AND NOT System.FileExtension:=.zip AND NOT System.FileExtension:=.zipx AND NOT System.FileExtension:=.zst"

!macro ZM_WRITE_CASCADE_MENU SHELL_KEY ROOT_CLSID
  DeleteRegValue HKCU "${SHELL_KEY}\${ZM_MENU_KEY}" "SubCommands"
  DeleteRegValue HKCU "${SHELL_KEY}\${ZM_MENU_KEY}" "ExtendedSubCommandsKey"
  DeleteRegKey HKCU "${SHELL_KEY}\${ZM_MENU_KEY}\ExtendedSubCommandsKey"
  WriteRegStr HKCU "${SHELL_KEY}\${ZM_MENU_KEY}" "MUIVerb" "ZManager"
  WriteRegStr HKCU "${SHELL_KEY}\${ZM_MENU_KEY}" "Icon" "$INSTDIR\${ZM_EXE_NAME}"
  WriteRegStr HKCU "${SHELL_KEY}\${ZM_MENU_KEY}" "ExplorerCommandHandler" "${ROOT_CLSID}"
  WriteRegStr HKCU "${SHELL_KEY}\${ZM_MENU_KEY}" "MultiSelectModel" "Player"
!macroend

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

!macro ZM_REGISTER_COM_CLASS CLSID
  WriteRegStr HKCU "Software\Classes\CLSID\${CLSID}\InprocServer32" "" "$INSTDIR\${ZM_SHELL_EXTENSION_NAME}"
  WriteRegStr HKCU "Software\Classes\CLSID\${CLSID}\InprocServer32" "ThreadingModel" "Apartment"
!macroend

!macro ZM_UNREGISTER_COM_CLASS CLSID
  DeleteRegKey HKCU "Software\Classes\CLSID\${CLSID}"
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

!macro ZM_WRITE_ARCHIVE_CASCADE_MENU SHELL_KEY
  !insertmacro ZM_WRITE_CASCADE_MENU "${SHELL_KEY}" "${ZM_ARCHIVE_ROOT_CLSID}"
!macroend

!macro ZM_WRITE_CREATE_CASCADE_MENU SHELL_KEY
  !insertmacro ZM_WRITE_CASCADE_MENU "${SHELL_KEY}" "${ZM_CREATE_ROOT_CLSID}"
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

!macro ZM_REGISTER_ARCHIVE_EXTENSION EXTENSION
  !insertmacro ZM_DELETE_CONTEXT_VERB "Software\Classes\SystemFileAssociations\${EXTENSION}\shell" "Extract"
  !insertmacro ZM_DELETE_CASCADE_MENU "Software\Classes\SystemFileAssociations\${EXTENSION}\shell"
  !insertmacro ZM_WRITE_ARCHIVE_CASCADE_MENU "Software\Classes\SystemFileAssociations\${EXTENSION}\shell"
!macroend

!macro ZM_UNREGISTER_ARCHIVE_EXTENSION EXTENSION
  !insertmacro ZM_DELETE_CASCADE_MENU "Software\Classes\SystemFileAssociations\${EXTENSION}\shell"
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
  ; SHCNE_ASSOCCHANGED (0x08000000) with SHCNF_FLUSH (0x1000) forces Explorer to
  ; immediately re-read the registry and discover new COM context menu handlers
  ; instead of relying on cached state from before the installation.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, i 0, i 0)'
  ; WM_SETTINGCHANGE (0x001A) broadcast ensures any loaded Explorer shell views
  ; pick up the new registry entries without waiting for the next process start.
  System::Call 'user32::SendMessageTimeoutW(i 0xFFFF, i 0x001A, i 0, w "Shell", i 0x0002, i 5000, *i 0)'
!macroend

!macro NSIS_HOOK_POSTINSTALL
  SetOutPath "$INSTDIR"
  File /oname=${ZM_SHELL_EXTENSION_NAME} "${ZM_SHELL_EXTENSION_SOURCE}"
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
  !insertmacro ZM_WRITE_CREATE_CASCADE_MENU "Software\Classes\*\shell"
  !insertmacro ZM_WRITE_CREATE_CASCADE_MENU "Software\Classes\Directory\shell"
  !insertmacro ZM_WRITE_BACKGROUND_CREATE_CASCADE_MENU "Software\Classes\Directory\Background\shell"
  !insertmacro ZM_REGISTER_ARCHIVE_EXTENSIONS
  !insertmacro ZM_REFRESH_SHELL_ASSOCIATIONS
!macroend

!macro NSIS_HOOK_PREUNINSTALL
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
  Delete /REBOOTOK "$INSTDIR\${ZM_SHELL_EXTENSION_NAME}"
!macroend
