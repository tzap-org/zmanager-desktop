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

$rustClassIds = [regex]::Matches($rust, 'GUID::from_u128\(0x([0-9a-fA-F_]+)\)') |
    ForEach-Object { $_.Groups[1].Value.Replace('_', '').ToLowerInvariant() } |
    Sort-Object -Unique
$nsisClassIds = [regex]::Matches($nsis, '!define ZM_[A-Z_]+_CLSID "\{([0-9A-Fa-f-]+)\}"') |
    ForEach-Object { $_.Groups[1].Value.Replace('-', '').ToLowerInvariant() } |
    Sort-Object -Unique

if ($rustClassIds.Count -ne 11) {
    throw "Expected 11 COM class IDs in the shell extension, found $($rustClassIds.Count)."
}
if (Compare-Object $rustClassIds $nsisClassIds) {
    throw "Shell extension and NSIS COM class IDs have drifted."
}
if ($quickAction.Contains('QUICK_ACTION_BURST_DEBOUNCE') -or $quickAction.Contains('pending_creates')) {
    throw "Timing-based quick-action coalescing must not return."
}
if (-not $nsis.Contains('ZM_REGISTER_GENERATED_CREATE_FILE_SUBCOMMANDS SHELL_KEY')) {
    throw "Selected create verbs are not registered through IExplorerCommand."
}
if (-not $nsis.Contains('ZM_REGISTER_GENERATED_BACKGROUND_SUBCOMMANDS SHELL_KEY')) {
    throw "Folder-background verbs must retain their single-target command registration."
}
if (-not (Test-Path $extensionArtifact)) {
    throw "Windows shell extension artifact is missing: $extensionArtifact"
}

Write-Host "Windows shell integration contract is consistent."
