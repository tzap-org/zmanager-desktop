param(
    [string]$Tag = "v2.1.7",
    [string]$Repo = "https://github.com/tzap-org/zmanager",
    [string]$CargoFile = "src-tauri/Cargo.toml"
)

$ErrorActionPreference = "Stop"
$repoEscaped = $Repo.Replace('"', '\"')

$content = Get-Content -Path $CargoFile -Raw
$pattern = 'zmanager-core\s*=\s*\{\s*path\s*=\s*"[^"]*"\s*\}'
$replacement = 'zmanager-core = { git = "' + $repoEscaped + '", tag = "' + $Tag + '", package = "zmanager-core" }'

if ($content -notmatch $pattern) {
  Write-Host "No path-based zmanager-core dependency found in $CargoFile"
  exit 1
}

$updated = [System.Text.RegularExpressions.Regex]::Replace($content, $pattern, $replacement, 1)
Set-Content -Path $CargoFile -Value $updated -Encoding UTF8

Write-Host "Pinned zmanager-core to $Repo with tag $Tag in $CargoFile"
