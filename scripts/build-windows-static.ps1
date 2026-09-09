param(
    [ValidateSet("staging", "prod")]
    [string]$Environment = "staging",
    [string]$VcpkgRoot = "C:\vcpkg",
    [string]$PerlBin = "C:\Strawberry\perl\bin",
    [ValidateSet("Auto", "x64", "arm64")]
    [string]$Architecture = "Auto",
    [string]$Triplet = "",
    [string]$NodePath = "",
    [switch]$InstallClang,
    [switch]$Install,
    [string]$InstallDir = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $repoRoot
. (Join-Path $PSScriptRoot "windows-install-location.ps1")
. (Join-Path $PSScriptRoot "windows-package-artifact.ps1")

# The frontend and Rust compiler both inherit these values. The frontend fixes
# the visible environment and the native command boundary rejects requests for
# a different environment after compilation.
$env:ZMANAGER_TZAP_BUILD_ENV = $Environment
$env:VITE_TZAP_BUILD_ENV = $Environment
if ($Environment -eq "staging") {
    $env:ZMANAGER_TZAP_SERVER_BASE_URL = "https://staging.tzap.org"
} else {
    Remove-Item Env:ZMANAGER_TZAP_SERVER_BASE_URL -ErrorAction SilentlyContinue
}
Write-Host "Hosted account build environment: $Environment"

# Respect CARGO_TARGET_DIR so build artifacts land in a short path
# (avoids Windows MAX_PATH issues with deeply nested build outputs).
$cargoTargetDir = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $env:USERPROFILE ".zmbuild" }
$env:CARGO_TARGET_DIR = $cargoTargetDir
if (-not (Test-Path $cargoTargetDir)) {
    New-Item -ItemType Directory -Force -Path $cargoTargetDir | Out-Null
}

$resolvedArch = $Architecture
if ($resolvedArch -eq "Auto") {
    if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64" -or $env:PROCESSOR_ARCHITEW6432 -eq "ARM64" -or $env:PROCESSOR_IDENTIFIER -like "*ARM*") {
        $resolvedArch = "arm64"
    } else {
        $resolvedArch = "x64"
    }
}
$targetTriple = if ($resolvedArch -eq "arm64") { "aarch64-pc-windows-msvc" } else { "x86_64-pc-windows-msvc" }

if ($env:ZMANAGER_BUILD_NUMBER) {
    $buildNumber = $env:ZMANAGER_BUILD_NUMBER
} else {
    $buildNumber = (git rev-list --count HEAD 2>$null)
    if (-not $buildNumber) {
        $buildNumber = "1"
    }
}
$osLabel = "Windows"
$buildId = "${osLabel}-${resolvedArch}-${buildNumber}"
$env:ZMANAGER_BUILD_NUMBER = $buildNumber
$env:ZMANAGER_BUILD_ID = $buildId
Write-Host "Build: ${buildId}"

function Resolve-OptionalCommand {
    param([string[]]$Names)

    foreach ($name in $Names) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if ($command) {
            return $command.Source
        }
    }

    return $null
}

function Resolve-NodePath {
    param([string]$RequestedNodePath)

    if (-not [string]::IsNullOrWhiteSpace($RequestedNodePath)) {
        if (-not (Test-Path $RequestedNodePath)) {
            throw "Node executable was not found: $RequestedNodePath"
        }
        $resolved = (Resolve-Path $RequestedNodePath).Path
        try {
            & $resolved --version *> $null
            return $resolved
        } catch {
            throw "Node executable could not be run: $resolved"
        }
    }

    $candidates = @()

    $commonNodePaths = @()
    if (-not [string]::IsNullOrWhiteSpace($env:ProgramFiles)) {
        $commonNodePaths += Join-Path $env:ProgramFiles "nodejs\node.exe"
    }
    if (-not [string]::IsNullOrWhiteSpace(${env:ProgramFiles(x86)})) {
        $commonNodePaths += Join-Path ${env:ProgramFiles(x86)} "nodejs\node.exe"
    }
    if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        $commonNodePaths += Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe"
    }
    if (-not [string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
        $commonNodePaths += Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
    }

    foreach ($commonNodePath in $commonNodePaths) {
        if ($commonNodePath -and (Test-Path $commonNodePath)) {
            $candidates += $commonNodePath
        }
    }

    $nodeCommand = Resolve-OptionalCommand -Names @("node.exe", "node")
    if ($nodeCommand) {
        $candidates += $nodeCommand
    }

    $seen = @{}
    foreach ($candidate in $candidates) {
        if ($seen.ContainsKey($candidate)) {
            continue
        }
        $seen[$candidate] = $true

        try {
            & $candidate --version *> $null
            return $candidate
        } catch {
            Write-Host "Skipping node candidate that could not run: $candidate"
        }
    }

    throw "node.exe was not found on PATH. Install Node.js, or pass -NodePath C:\path\to\node.exe."
}

function Resolve-NpmCommand {
    param([string]$ResolvedNodePath)

    $nodeDir = Split-Path $ResolvedNodePath -Parent
    foreach ($candidate in @((Join-Path $nodeDir "npm.cmd"), (Join-Path $nodeDir "npm"))) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    return Resolve-OptionalCommand -Names @("npm.cmd", "npm")
}

function Assert-ReleaseExecutableIsNotRunning {
    $releaseExe = Join-Path $cargoTargetDir "$targetTriple\release\zmanager-desktop.exe"
    if (-not (Test-Path $releaseExe)) {
        $releaseExe = Join-Path $cargoTargetDir "release\zmanager-desktop.exe"
        if (-not (Test-Path $releaseExe)) {
            return
        }
    }

    $resolvedReleaseExe = (Resolve-Path $releaseExe).Path
    $running = Get-Process -ErrorAction SilentlyContinue | Where-Object {
        try {
            $_.Path -and ((Resolve-Path $_.Path -ErrorAction SilentlyContinue).Path -ieq $resolvedReleaseExe)
        } catch {
            $false
        }
    }

    if ($running) {
        $ids = ($running | ForEach-Object { "$($_.ProcessName)#$($_.Id)" }) -join ", "
        throw "Close running ZManager process(es) before building; the release executable is locked by: $ids"
    }
}

function Install-NsisBuild {
    param(
        [string]$InstallerPath,
        [string]$RequestedInstallDir
    )

    $resolvedInstallDir = Resolve-ZManagerInstallDirectory -RequestedInstallDir $RequestedInstallDir
    $arguments = New-ZManagerNsisInstallArguments -InstallDirectory $resolvedInstallDir

    Write-Host "Installing built NSIS package: $InstallerPath"
    if ($resolvedInstallDir) {
        Write-Host "Install directory: $resolvedInstallDir"
    }

    $installer = Start-Process `
        -FilePath $InstallerPath `
        -ArgumentList $arguments `
        -Wait `
        -PassThru `
        -WindowStyle Hidden
    if ($installer.ExitCode -ne 0) {
        throw "Installer failed with exit code $($installer.ExitCode)"
    }
    Write-Host "Install completed."
}

$resolvedNodePath = Resolve-NodePath -RequestedNodePath $NodePath
$npmCommand = Resolve-NpmCommand -ResolvedNodePath $resolvedNodePath
$tauriCli = Join-Path $repoRoot "node_modules\@tauri-apps\cli\tauri.js"
$resolvedNodeDir = Split-Path $resolvedNodePath -Parent
$env:PATH = "$resolvedNodeDir;" + $env:PATH

# Target triple is resolved at the top of the script

if (-not (Test-Path $tauriCli)) {
    throw "Tauri CLI was not found under node_modules. Run npm install before building."
}

Assert-ReleaseExecutableIsNotRunning

$shellExtensionBuild = Join-Path $PSScriptRoot "build-windows-shell-extension.ps1"
& powershell -ExecutionPolicy Bypass -File $shellExtensionBuild -Architecture $Architecture
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
$shellIntegrationTest = Join-Path $PSScriptRoot "test-windows-shell-integration.ps1"
& powershell -ExecutionPolicy Bypass -File $shellIntegrationTest
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
$installLocationTest = Join-Path $PSScriptRoot "test-windows-install-location.ps1"
& powershell -NoProfile -ExecutionPolicy Bypass -File $installLocationTest
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
$packageArtifactTest = Join-Path $PSScriptRoot "test-windows-package-artifact.ps1"
& powershell -NoProfile -ExecutionPolicy Bypass -File $packageArtifactTest
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

if ($npmCommand) {
    $runCommand = "& '$resolvedNodePath' '$tauriCli' build --target $targetTriple"
} else {
    $shimDir = Join-Path $env:TEMP "zmanager-desktop-build-shims"
    New-Item -ItemType Directory -Force -Path $shimDir | Out-Null

    $npmShim = Join-Path $shimDir "npm.cmd"
    $typescriptCli = Join-Path $repoRoot "node_modules\typescript\bin\tsc"
    $viteCli = Join-Path $repoRoot "node_modules\vite\bin\vite.js"

    if (-not (Test-Path $typescriptCli)) {
        throw "TypeScript CLI was not found under node_modules. Run npm install before building."
    }
    if (-not (Test-Path $viteCli)) {
        throw "Vite CLI was not found under node_modules. Run npm install before building."
    }

    @"
@echo off
if "%~1"=="run" if "%~2"=="build" (
  "$resolvedNodePath" "$typescriptCli" --noEmit
  if errorlevel 1 exit /b %errorlevel%
  "$resolvedNodePath" "$viteCli" build
  exit /b %errorlevel%
)
echo This temporary npm shim only supports npm run build for the Tauri beforeBuildCommand.
exit /b 1
"@ | Set-Content -Path $npmShim -Encoding ASCII

    $env:PATH = "$shimDir;" + $env:PATH
    Write-Host "npm was not found; using local Node and a temporary npm run build shim."
    $runCommand = "& '$resolvedNodePath' '$tauriCli' build --target $targetTriple"
}

& (Join-Path $PSScriptRoot "setup-windows-static-env.ps1") `
    -VcpkgRoot $VcpkgRoot `
    -PerlBin $PerlBin `
    -Architecture $Architecture `
    -Triplet $Triplet `
    -InstallClang:$InstallClang `
    -Run $runCommand

$buildExitCode = $LASTEXITCODE
if ($buildExitCode -ne 0) {
    exit $buildExitCode
}

if ($Install) {
    $tauriConfig = Get-Content (Join-Path $repoRoot "src-tauri\tauri.conf.json") | ConvertFrom-Json
    $installerPath = Resolve-ZManagerNsisInstaller `
        -CargoTargetDir $cargoTargetDir `
        -Architecture $resolvedArch `
        -ProductName $tauriConfig.productName `
        -ProductVersion $tauriConfig.version
    Install-NsisBuild -InstallerPath $installerPath -RequestedInstallDir $InstallDir
}

exit 0
