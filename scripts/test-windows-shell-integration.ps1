$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent
$extensionSource = Join-Path $repoRoot "native\windows-shell-extension\src\generated.rs"
$installerHook = Join-Path $repoRoot "packaging\windows\nsis-context-menu.nsh"
$installerActions = Join-Path $repoRoot "packaging\windows\nsis-shell-actions.generated.nsh"
$quickActionSource = Join-Path $repoRoot "src-tauri\src\quick_action.rs"
$extensionHandler = Join-Path $repoRoot "native\windows-shell-extension\src\lib.rs"
$batchBuild = Join-Path $repoRoot "scripts\build.bat"
$staticBuild = Join-Path $repoRoot "scripts\build-windows-static.ps1"
$extensionArtifact = Join-Path $repoRoot "target\windows-shell-extension\zmanager-shell-extension.dll"

$rust = Get-Content -Raw $extensionSource
$nsis = (Get-Content -Raw $installerHook) + (Get-Content -Raw $installerActions)
$quickAction = Get-Content -Raw $quickActionSource
$handler = Get-Content -Raw $extensionHandler
$batch = Get-Content -Raw $batchBuild
$static = Get-Content -Raw $staticBuild

$rustRootIds = [regex]::Matches($rust, 'const (?:ARCHIVE_ROOT_CLSID|CREATE_ROOT_CLSID): GUID = GUID::from_u128\(0x([0-9a-fA-F_]+)\)') |
    ForEach-Object { $_.Groups[1].Value.Replace('_', '').ToLowerInvariant() } |
    Sort-Object -Unique
$nsisRootIds = [regex]::Matches($nsis, '!define ZM_(?:ARCHIVE_ROOT|CREATE_ROOT)_CLSID "\{([0-9A-Fa-f-]+)\}"') |
    ForEach-Object { $_.Groups[1].Value.Replace('-', '').ToLowerInvariant() } |
    Sort-Object -Unique

if ($rustRootIds.Count -ne 2) {
    throw "Expected 2 root COM class IDs in the shell extension, found $($rustRootIds.Count)."
}
if (Compare-Object $rustRootIds $nsisRootIds) {
    throw "Shell extension and NSIS root COM class IDs have drifted."
}
if ($quickAction.Contains('QUICK_ACTION_BURST_DEBOUNCE') -or $quickAction.Contains('pending_creates')) {
    throw "Timing-based quick-action coalescing must not return."
}
if (-not $nsis.Contains('shellex\ContextMenuHandlers\${ZM_CLASSIC_CONTEXT_MENU_KEY}') -or
    -not $nsis.Contains('ZM_REGISTER_CLASSIC_CONTEXT_MENU_HANDLER "*"') -or
    -not $nsis.Contains('ZM_REGISTER_CLASSIC_CONTEXT_MENU_HANDLER "Directory"') -or
    -not $nsis.Contains('ZM_REGISTER_CLASSIC_CONTEXT_MENU_HANDLER "Folder"')) {
    throw "Selected-item quick actions are not registered through the classic ContextMenuHandlers contract for *, Directory and Folder."
}

# 7-Zip's DllRegisterServer writes the class friendly name, the in-process
# server, the Apartment threading model, and the Approved shell-extension entry.
foreach ($registration in @(
    'WriteRegStr HKCU "Software\Classes\CLSID\${CLSID}" "" "${ZM_SHELL_EXTENSION_DESCRIPTION}"',
    'WriteRegStr HKCU "Software\Classes\CLSID\${CLSID}\InprocServer32" "" "$INSTDIR\${ZM_SHELL_EXTENSION_NAME}"',
    'WriteRegStr HKCU "Software\Classes\CLSID\${CLSID}\InprocServer32" "ThreadingModel" "Apartment"',
    'WriteRegStr HKLM "${ZM_APPROVED_SHELL_EXTENSIONS_KEY}" "${CLSID}" "${ZM_SHELL_EXTENSION_DESCRIPTION}"'
)) {
    if (-not $nsis.Contains($registration)) {
        throw "The shell extension COM class registration is missing: $registration"
    }
}

# Explorer keeps the handler DLL loaded, so an in-place overwrite fails and the
# installer would register a CLSID that still resolves to the previous build.
if (-not $nsis.Contains('!insertmacro ZM_INSTALL_SHELL_EXTENSION_BINARY') -or
    -not $nsis.Contains('Rename "$INSTDIR\${ZM_SHELL_EXTENSION_NAME}" "$INSTDIR\${ZM_SHELL_EXTENSION_NAME}.old"')) {
    throw "The installer must move a locked handler DLL aside before writing the new one."
}

# An upgrade over a running Explorer leaves the previous image mapped, so the
# installer restarts the shell - but only in that case, never on a fresh install.
if (-not $nsis.Contains('Var /GLOBAL ZM_ShellExtensionWasLocked') -or
    -not $nsis.Contains('StrCpy $ZM_ShellExtensionWasLocked "1"') -or
    -not $nsis.Contains('!insertmacro ZM_RESTART_EXPLORER_IF_STALE')) {
    throw "The installer must restart Explorer when it replaces a handler DLL that was locked."
}
if (-not $nsis.Contains('IfSilent zm_explorer_restart_now') -or -not $nsis.Contains('MessageBox MB_YESNO')) {
    throw "An interactive install must ask before closing the user's Explorer windows; a silent install must not prompt."
}
if (-not $nsis.Contains('SHCNF_FLUSHNOWAIT (0x2000)') -or
    -not $nsis.Contains("SHChangeNotify(i 0x08000000, i 0x2000") -or
    $nsis.Contains("SHChangeNotify(i 0x08000000, i 0x1000")) {
    throw "The silent installer must not block indefinitely while notifying Explorer about association changes."
}

# The developer loop verifies the result of that install.
$refreshScript = Join-Path $repoRoot "scripts\refresh-windows-shell-extension.ps1"
if (-not (Test-Path $refreshScript)) {
    throw "scripts\refresh-windows-shell-extension.ps1 is missing."
}
$refresh = Get-Content -Raw $refreshScript
foreach ($guarantee in @(
    @{ Pattern = 'QueryInterface'; Message = "must QueryInterface the registered class for the classic interfaces" },
    @{ Pattern = '000214E8-0000-0000-C000-000000000046'; Message = "must check IShellExtInit" },
    @{ Pattern = '000214E4-0000-0000-C000-000000000046'; Message = "must check IContextMenu" },
    @{ Pattern = 'SessionId -eq $currentSession'; Message = "must only restart Explorer in the current session" }
)) {
    if (-not $refresh.Contains($guarantee.Pattern)) {
        throw "refresh-windows-shell-extension.ps1 $($guarantee.Message)."
    }
}
# Timestamps are not a valid staleness signal: NSIS and Copy-Item both preserve
# the source mtime, so an installed DLL carries its build time.
if ($refresh -match 'StartTime\s+-lt\s+\$installedWrite') {
    throw "Explorer staleness must not be inferred from timestamps; use the locked '.old' image instead."
}
if (-not $static.Contains('refresh-windows-shell-extension.ps1')) {
    throw "build-windows-static.ps1 must verify the installed shell extension after -Install."
}

if (-not $handler.Contains('#[implement(IExplorerCommand, IContextMenu, IShellExtInit)]')) {
    throw "The shell extension must expose the classic IShellExtInit + IContextMenu handler."
}
if ($handler.Contains('classic_command_first')) {
    throw "InvokeCommand must use the command offset Explorer passes, which is already relative to idCmdFirst."
}
if (-not $nsis.Contains('ZM_REGISTER_GENERATED_BACKGROUND_SUBCOMMANDS SUBCOMMANDS_KEY')) {
    throw "Folder-background verbs must retain their single-target command registration."
}

# scripts\build.bat and scripts\build-windows-static.ps1 must register the
# context menu the same way: by running the NSIS installer that carries the hook.
if (-not $batch.Contains('scripts\build-windows-static.ps1')) {
    throw "scripts\build.bat must delegate to build-windows-static.ps1 so it installs through the NSIS hook."
}
if ($batch -notmatch 'build-windows-static\.ps1.*-Install') {
    throw "scripts\build.bat must pass -Install so the built installer performs the context menu registration."
}
if (-not $static.Contains('build-windows-shell-extension.ps1')) {
    throw "build-windows-static.ps1 must build the shell extension before packaging the installer."
}
if (-not $static.Contains('Install-NsisBuild')) {
    throw "build-windows-static.ps1 must install through the built NSIS package, not by copying files."
}
if (-not $static.Contains('Assert-ZManagerExecutableIsNotRunning') -or
    -not $static.Contains('Wait-ZManagerInstaller') -or
    -not $static.Contains('Installer still running...') -or
    -not $static.Contains('InstallerTimeoutSeconds')) {
    throw "The Windows build installer must reject a running target and provide bounded, visible install progress."
}

if (-not (Test-Path $extensionArtifact)) {
    throw "Windows shell extension artifact is missing: $extensionArtifact"
}

Write-Host "Windows shell integration contract is consistent."
