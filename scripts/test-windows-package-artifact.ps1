$ErrorActionPreference = "Stop"

$productVersion = (Get-Content (Join-Path $PSScriptRoot "..\package.json") -Raw | ConvertFrom-Json).version

$helperPath = Join-Path $PSScriptRoot "windows-package-artifact.ps1"
. $helperPath

function Assert-Equal {
    param(
        [object]$Expected,
        [object]$Actual,
        [string]$Message
    )

    if ($Expected -ne $Actual) {
        throw "$Message Expected '$Expected', received '$Actual'."
    }
}

$testRoot = Join-Path ([IO.Path]::GetTempPath()) "zmanager-package-artifact-$([Guid]::NewGuid())"

try {
    $bundleDir = Join-Path $testRoot "aarch64-pc-windows-msvc\release\bundle\nsis"
    New-Item -ItemType Directory -Force -Path $bundleDir | Out-Null

    $currentInstaller = Join-Path $bundleDir "zmanager-desktop_${productVersion}_arm64-setup.exe"
    $retiredInstaller = Join-Path $bundleDir "ZManager_${productVersion}_arm64-setup.exe"
    New-Item -ItemType File -Path $retiredInstaller | Out-Null

    $missingCurrentThrew = $false
    try {
        Resolve-ZManagerNsisInstaller `
            -CargoTargetDir $testRoot `
            -Architecture "arm64" `
            -ProductName "zmanager-desktop" `
            -ProductVersion $productVersion | Out-Null
    } catch {
        $missingCurrentThrew = $true
    }
    Assert-Equal $true $missingCurrentThrew "A retired installer must not satisfy the current package contract."

    New-Item -ItemType File -Path $currentInstaller | Out-Null
    $resolvedInstaller = Resolve-ZManagerNsisInstaller `
        -CargoTargetDir $testRoot `
        -Architecture "arm64" `
        -ProductName "zmanager-desktop" `
        -ProductVersion $productVersion
    Assert-Equal $currentInstaller $resolvedInstaller "The exact current ARM64 installer must be selected."

    $releaseExecutable = Get-ZManagerReleaseExecutablePath `
        -CargoTargetDir $testRoot `
        -Architecture "arm64"
    Assert-Equal `
        (Join-Path $testRoot "aarch64-pc-windows-msvc\release\zmanager-desktop.exe") `
        $releaseExecutable `
        "The packaged executable must use the architecture-specific Cargo target directory."

    $debugInstaller = Get-ZManagerNsisInstallerPath `
        -CargoTargetDir $testRoot `
        -Architecture "arm64" `
        -ProductName "zmanager-desktop" `
        -ProductVersion $productVersion `
        -Configuration "debug"
    Assert-Equal `
        (Join-Path $testRoot "aarch64-pc-windows-msvc\debug\bundle\nsis\zmanager-desktop_${productVersion}_arm64-setup.exe") `
        $debugInstaller `
        "The standalone E2E installer must resolve from the architecture-specific debug directory."
} finally {
    if (Test-Path -LiteralPath $testRoot) {
        $resolvedTestRoot = (Resolve-Path -LiteralPath $testRoot).Path
        $resolvedTempRoot = (Resolve-Path -LiteralPath ([IO.Path]::GetTempPath())).Path
        if (-not $resolvedTestRoot.StartsWith($resolvedTempRoot, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to remove package-artifact test directory outside the temp root: $resolvedTestRoot"
        }
        Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
    }
}

Write-Host "Windows package-artifact regression tests passed."
