$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent
$extensionSource = Join-Path $repoRoot "native\windows-shell-extension\src\generated.rs"
$installerHook = Join-Path $repoRoot "packaging\windows\nsis-context-menu.nsh"
$installerActions = Join-Path $repoRoot "packaging\windows\nsis-shell-actions.generated.nsh"
$quickActionSource = Join-Path $repoRoot "src-tauri\src\quick_action.rs"
$extensionArtifact = Join-Path $repoRoot "target\windows-shell-extension\zmanager-shell-extension.dll"

$rust = Get-Content -Raw $extensionSource
$nsis = (Get-Content -Raw $installerHook) + (Get-Content -Raw $installerActions)
$quickAction = Get-Content -Raw $quickActionSource

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
if (-not $nsis.Contains('ExplorerCommandHandler') -or -not $nsis.Contains('ZM_WRITE_CASCADE_MENU "${SHELL_KEY}" "${ZM_ARCHIVE_ROOT_CLSID}"')) {
    throw "Selected-item cascades are not registered through root IExplorerCommand providers."
}
if (-not $nsis.Contains('ZM_REGISTER_GENERATED_BACKGROUND_SUBCOMMANDS SUBCOMMANDS_KEY')) {
    throw "Folder-background verbs must retain their single-target command registration."
}
if (-not (Test-Path $extensionArtifact)) {
    throw "Windows shell extension artifact is missing: $extensionArtifact"
}

Write-Host "Windows shell integration contract is consistent."
