[CmdletBinding(PositionalBinding = $false)]
param(
    [string]$VcpkgRoot = "C:\vcpkg",
    [string]$PerlBin = "C:\Strawberry\perl\bin",
    [ValidateSet("Auto", "x64", "arm64")]
    [string]$Architecture = "Auto",
    [string]$Triplet = "",
    [switch]$InstallMissing,
    [switch]$InstallNodeModules,
    [switch]$ReleaseArtifact,
    [switch]$KeepArtifacts
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot
. (Join-Path $PSScriptRoot "windows-package-artifact.ps1")

function Import-StagingEnvironmentFile {
    $envFile = $env:TZAP_E2E_ENV_FILE
    if ([string]::IsNullOrWhiteSpace($envFile)) {
        return
    }

    $resolvedEnvFile = if ([IO.Path]::IsPathRooted($envFile)) {
        $envFile
    } else {
        Join-Path (Get-Location) $envFile
    }
    if (-not (Test-Path -LiteralPath $resolvedEnvFile -PathType Leaf)) {
        throw "TZAP_E2E_ENV_FILE does not exist: $resolvedEnvFile"
    }

    $values = @{}
    foreach ($line in Get-Content -LiteralPath $resolvedEnvFile) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) {
            continue
        }
        if ($trimmed -match "^(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$") {
            $key = $matches[1]
            $value = $matches[2].Trim().Trim('''').Trim('"')
            $values[$key] = $value
            if (($key.StartsWith("TZAP_E2E_") -or $key -eq "TZAP_DESKTOP_STAGING_CLIENT_ID") -and [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($key))) {
                Set-Item -Path "env:$key" -Value $value
            }
        }
    }

    if ([string]::IsNullOrWhiteSpace($env:TZAP_E2E_USERNAME) -and $values.ContainsKey("STAGING_TEST_USER_1")) {
        $env:TZAP_E2E_USERNAME = $values["STAGING_TEST_USER_1"]
    }
    if ([string]::IsNullOrWhiteSpace($env:TZAP_E2E_PASSWORD) -and $values.ContainsKey("STAGING_TEST_USER_PASSWORD")) {
        $env:TZAP_E2E_PASSWORD = $values["STAGING_TEST_USER_PASSWORD"]
    }
}

Import-StagingEnvironmentFile

if ($env:TZAP_E2E_ENV -and $env:TZAP_E2E_ENV.ToLowerInvariant() -ne "staging") {
    throw "TZAP_E2E_ENV must be staging; production and local fixtures are not allowed for the standalone E2E runner."
}
foreach ($name in @("TZAP_DESKTOP_STAGING_CLIENT_ID", "TZAP_E2E_USERNAME", "TZAP_E2E_PASSWORD")) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
        throw "$name is required for the staging standalone E2E runner."
    }
}

$env:ZMANAGER_TZAP_BUILD_ENV = "staging"
$env:VITE_TZAP_BUILD_ENV = "staging"
$env:ZMANAGER_TZAP_SERVER_BASE_URL = "https://staging.tzap.org"
$env:TZAP_E2E_ENV = "staging"
$env:TZAP_E2E_STAGING_CALLBACK_ADAPTER = "1"
Write-Host "Hosted account standalone E2E environment: staging"

function Resolve-TargetArchitecture {
    param([string]$RequestedArchitecture)

    if ($RequestedArchitecture -ne "Auto") {
        return $RequestedArchitecture
    }

    if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64" -or $env:PROCESSOR_ARCHITEW6432 -eq "ARM64" -or $env:PROCESSOR_IDENTIFIER -like "*ARM*") {
        return "arm64"
    }

    $rustc = Get-Command "rustc.exe" -ErrorAction SilentlyContinue
    if (-not $rustc) {
        $rustc = Get-Command "rustc" -ErrorAction Stop
    }
    $hostLine = & $rustc.Source -vV | Where-Object { $_ -like "host: *" } | Select-Object -First 1
    if ($hostLine -like "*aarch64*") {
        return "arm64"
    }
    if ($hostLine -like "*x86_64*") {
        return "x64"
    }

    throw "Could not determine the Rust Windows target architecture. Pass -Architecture x64 or -Architecture arm64."
}

function Stop-InstalledAppProcesses {
    param([string]$ExecutablePath)

    $resolvedPath = (Resolve-Path -LiteralPath $ExecutablePath).Path
    Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
        try {
            if ($_.Path -and ((Resolve-Path -LiteralPath $_.Path -ErrorAction SilentlyContinue).Path -ieq $resolvedPath)) {
                Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
            }
        } catch {
            # A process may exit between enumeration and path resolution.
        }
    }
}

$resolvedArchitecture = Resolve-TargetArchitecture -RequestedArchitecture $Architecture
$targetTriple = if ($resolvedArchitecture -eq "arm64") {
    "aarch64-pc-windows-msvc"
} else {
    "x86_64-pc-windows-msvc"
}

if (-not $env:CARGO_TARGET_DIR) {
    $env:CARGO_TARGET_DIR = Join-Path $env:USERPROFILE ".zmbuild"
}

if ($InstallNodeModules) {
    $npm = Get-Command "npm.cmd" -ErrorAction Stop
    & $npm.Source ci
    if ($LASTEXITCODE -ne 0) {
        throw "npm ci failed with exit code $LASTEXITCODE."
    }
}

& (Join-Path $PSScriptRoot "ensure-sibling-repos.ps1")
if ($LASTEXITCODE -ne 0) {
    throw "Sibling repository setup failed with exit code $LASTEXITCODE."
}

# Dot-sourcing preserves the imported MSVC/vcpkg/OpenSSL environment for the
# Tauri build and the standalone driver that follows it.
. (Join-Path $PSScriptRoot "setup-windows-static-env.ps1") `
    -VcpkgRoot $VcpkgRoot `
    -PerlBin $PerlBin `
    -Architecture $resolvedArchitecture `
    -Triplet $Triplet `
    -InstallClang:$InstallMissing

$node = Get-Command "node.exe" -ErrorAction Stop
$tauriCli = Join-Path $repoRoot "node_modules\@tauri-apps\cli\tauri.js"
$tauriConfigPath = Join-Path $repoRoot "src-tauri\tauri.conf.json"
if (-not (Test-Path -LiteralPath $tauriCli -PathType Leaf)) {
    throw "Tauri CLI was not found at $tauriCli. Run with -InstallNodeModules or run npm ci first."
}

$product = Get-Content -LiteralPath $tauriConfigPath -Raw | ConvertFrom-Json
$standaloneDebugConfigPath = Join-Path $repoRoot "src-tauri\tauri.standalone-debug.conf.json"
$runId = $env:TZAP_E2E_RUN_ID
if ([string]::IsNullOrWhiteSpace($runId)) {
    $runId = "standalone-$([Guid]::NewGuid().ToString('N'))"
}
$artifactDirectoryManaged = [string]::IsNullOrWhiteSpace($env:TZAP_E2E_ARTIFACT_DIR)
$artifactRoot = if (-not $artifactDirectoryManaged) {
    [IO.Path]::GetFullPath($env:TZAP_E2E_ARTIFACT_DIR)
} else {
    Join-Path ([IO.Path]::GetTempPath()) "zmanager-standalone-e2e\$runId"
}
$installDir = Join-Path $artifactRoot "installed"
$resolvedTempRoot = (Resolve-Path -LiteralPath ([IO.Path]::GetTempPath())).Path
$resolvedArtifactParent = [IO.Path]::GetFullPath((Split-Path -Parent $artifactRoot))
if (-not $resolvedArtifactParent.StartsWith($resolvedTempRoot, [StringComparison]::OrdinalIgnoreCase) -and $artifactDirectoryManaged) {
    throw "Refusing to use an unmanaged standalone E2E artifact path outside the system temp directory."
}
if (Test-Path -LiteralPath $artifactRoot) {
    if (-not $artifactDirectoryManaged) {
        throw "TZAP_E2E_ARTIFACT_DIR already exists; refusing to overwrite a caller-owned artifact directory: $artifactRoot"
    }
    Remove-Item -LiteralPath $artifactRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null

$env:TZAP_E2E_RUN_ID = $runId
$env:TZAP_E2E_ARTIFACT_DIR = $artifactRoot
$stateRoot = Join-Path $artifactRoot "desktop-state"
New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null
$secureStoreNamespace = "e2e-$([regex]::Replace($runId, '[^A-Za-z0-9_-]', '-'))"
$env:TZAP_E2E_ACCOUNT_STATE_ROOT = $stateRoot
$env:TZAP_E2E_ACCOUNT_STATE_ROOT_REUSE = "1"
$env:TZAP_E2E_SECURE_STORE_NAMESPACE = $secureStoreNamespace.Substring(0, [Math]::Min(128, $secureStoreNamespace.Length))
$env:TZAP_E2E_KEEP_ARTIFACTS = if ($KeepArtifacts) { "1" } else { "0" }
$env:ZMANAGER_GUI_TEST_MODE = "1"
$env:ZMANAGER_GUI_TEST_DEEP_LINK = "1"
$env:TZAP_E2E_RELEASE_ARTIFACT = if ($ReleaseArtifact) { "1" } else { "0" }

$installerPath = $null
$installedExe = Join-Path $installDir "zmanager-desktop.exe"
$exitCode = 1

try {
    $configuration = if ($ReleaseArtifact) { "release" } else { "debug" }
    # Tauri always loads tauri.conf.json as the base configuration. Pass only
    # the standalone overlay here so its app section is merged into that base
    # instead of re-supplying the base file as another custom configuration.
    $buildArgs = @( "build", "--ci", "--no-sign", "--bundles", "nsis" )
    if (-not $ReleaseArtifact) {
        $buildArgs += @("--config", $standaloneDebugConfigPath)
        $buildArgs += "--debug"
    }
    $buildArgs += @("--target", $targetTriple)
    Write-Host "Building the staging $configuration product configuration: $targetTriple"
    & $node.Source $tauriCli @buildArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Staging standalone Tauri build failed with exit code $LASTEXITCODE."
    }
    $installerPath = Resolve-ZManagerNsisInstaller `
        -CargoTargetDir $env:CARGO_TARGET_DIR `
        -Architecture $resolvedArchitecture `
        -ProductName $product.productName `
        -ProductVersion $product.version `
        -Configuration $configuration

    New-Item -ItemType Directory -Force -Path $installDir | Out-Null
    Write-Host "Installing staging standalone artifact: $installDir"
    $installer = Start-Process `
        -FilePath $installerPath `
        -ArgumentList @("/S", "/D=$installDir") `
        -Wait `
        -PassThru `
        -WindowStyle Hidden
    if ($installer.ExitCode -ne 0) {
        throw "Staging standalone installer failed with exit code $($installer.ExitCode)."
    }
    if (-not (Test-Path -LiteralPath $installedExe -PathType Leaf)) {
        $installedExeItem = Get-ChildItem -LiteralPath $installDir -Recurse -Filter "zmanager-desktop.exe" | Select-Object -First 1
        if ($null -eq $installedExeItem) {
            throw "Installed staging executable was not found under $installDir."
        }
        $installedExe = $installedExeItem.FullName
    }

    $protocolEvidencePath = Join-Path $artifactRoot "protocol-registration.txt"
    & (Join-Path $PSScriptRoot "test-windows-protocol-registration.ps1") -ExecutablePath $installedExe *>&1 | Tee-Object -FilePath $protocolEvidencePath

    $installedVersion = (Get-Item -LiteralPath $installedExe).VersionInfo.FileVersion
    [pscustomobject]@{
        runId = $runId
        environment = "staging"
        architecture = $resolvedArchitecture
        configuration = $configuration
        productName = $product.productName
        productVersion = $product.version
        installedExecutable = [IO.Path]::GetFileName($installedExe)
        installedFileVersion = $installedVersion
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $artifactRoot "artifact-metadata.json")

    $env:ZMANAGER_GUI_APP_PATH = (Resolve-Path -LiteralPath $installedExe).Path
    Write-Host "Running staging $configuration standalone E2E against installed application: $env:ZMANAGER_GUI_APP_PATH"
    $npm = Get-Command "npm.cmd" -ErrorAction Stop
    if ($ReleaseArtifact) {
        & $npm.Source exec -- tsx e2e/tauri/release-artifact-smoke.ts
    } else {
        # WDIO owns the warm account and archive assertions. The installed
        # artifact smoke owns process-stop/process-restart boundaries because
        # stopping the app also stops the embedded WebDriver server; a WDIO
        # session cannot be reused across a cold restart.
        & $npm.Source run test:gui:run -- --spec e2e/tauri/online-account.spec.ts
        $onlineExitCode = $LASTEXITCODE
        if ($onlineExitCode -eq 0) {
            & $npm.Source exec -- tsx e2e/tauri/release-artifact-smoke.ts
            $exitCode = $LASTEXITCODE
        } else {
            $exitCode = $onlineExitCode
        }
    }
    if ($ReleaseArtifact) {
        $exitCode = $LASTEXITCODE
    }
} catch {
    Write-Error $_
    $exitCode = 1
} finally {
    if (Test-Path -LiteralPath $installedExe -PathType Leaf) {
        Stop-InstalledAppProcesses -ExecutablePath $installedExe
    }
    $diagnosticLogPath = Join-Path $installDir "logs\zmanager-diagnostics.log"
    if (Test-Path -LiteralPath $diagnosticLogPath -PathType Leaf) {
        Copy-Item -LiteralPath $diagnosticLogPath -Destination (Join-Path $artifactRoot "zmanager-diagnostics.log") -Force
    }
    $uninstaller = if (Test-Path -LiteralPath $installDir -PathType Container) {
        Get-ChildItem -LiteralPath $installDir -Recurse -Filter "uninstall.exe" -File | Select-Object -First 1
    }
    if ($null -ne $uninstaller -and (Test-Path -LiteralPath $uninstaller.FullName -PathType Leaf)) {
        $uninstallProcess = Start-Process -FilePath $uninstaller.FullName -ArgumentList @("/S") -Wait -PassThru -WindowStyle Hidden
        if ($uninstallProcess.ExitCode -ne 0) {
            Write-Error "Standalone NSIS uninstaller returned exit code $($uninstallProcess.ExitCode)."
            $exitCode = 1
        }
        & (Join-Path $PSScriptRoot "test-windows-protocol-registration.ps1") -ExecutablePath $installedExe -ExpectAbsent
    } elseif ($null -ne $installerPath) {
        Write-Error "Standalone NSIS uninstaller was not found under $installDir."
        $exitCode = 1
    }
    if (-not $KeepArtifacts -and $exitCode -eq 0 -and (Test-Path -LiteralPath $artifactRoot)) {
        Remove-Item -LiteralPath $artifactRoot -Recurse -Force
    } else {
        Write-Host "Standalone E2E artifacts: $artifactRoot"
    }
}

exit $exitCode
