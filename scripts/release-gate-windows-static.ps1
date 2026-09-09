param(
    [switch]$SkipInstallerInstall,
    [switch]$SkipAppLaunch,
    [ValidateSet("Auto", "x64", "arm64")]
    [string]$Architecture = "Auto"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot "windows-package-artifact.ps1")
$cargoTargetDir = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $repoRoot "src-tauri\target" }
$logDir = Join-Path $repoRoot "target/release-gate"
$installDir = Join-Path $logDir "installed-app"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

function Resolve-WindowsStaticArchitecture {
    param([string]$RequestedArchitecture)

    if ($RequestedArchitecture -ne "Auto") {
        return $RequestedArchitecture
    }

    if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64" -or $env:PROCESSOR_ARCHITEW6432 -eq "ARM64" -or $env:PROCESSOR_IDENTIFIER -like "*ARM*") {
        return "arm64"
    }

    $rustc = Get-Command "rustc.exe" -ErrorAction SilentlyContinue
    if (-not $rustc) {
        $rustc = Get-Command "rustc" -ErrorAction SilentlyContinue
    }
    if ($rustc) {
        $hostLine = & $rustc.Source -vV | Where-Object { $_ -like "host: *" } | Select-Object -First 1
        if ($hostLine -like "*aarch64*") {
            return "arm64"
        }
    }

    if ($env:PROCESSOR_ARCHITECTURE -eq "AMD64") {
        return "x64"
    }

    throw "Could not determine Windows build architecture. Pass -Architecture x64 or -Architecture arm64."
}

$resolvedArchitecture = Resolve-WindowsStaticArchitecture -RequestedArchitecture $Architecture
$platformLabel = if ($resolvedArchitecture -eq "arm64") { "Windows ARM64" } else { "Windows x64" }
$transcriptPath = Join-Path $logDir "release-gate-windows-static-$resolvedArchitecture-$timestamp.log"
$tauriConfig = Get-Content (Join-Path $repoRoot "src-tauri\tauri.conf.json") | ConvertFrom-Json
$installerPath = Get-ZManagerNsisInstallerPath `
    -CargoTargetDir $cargoTargetDir `
    -Architecture $resolvedArchitecture `
    -ProductName $tauriConfig.productName `
    -ProductVersion $tauriConfig.version
$artifactPath = Get-ZManagerReleaseExecutablePath `
    -CargoTargetDir $cargoTargetDir `
    -Architecture $resolvedArchitecture
$gateResult = "Pass"
$gateNotes = "Release gate passed. Log: $transcriptPath"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Invoke-GateStep([string]$Name, [scriptblock]$Script) {
    Write-Host ""
    Write-Host "== $Name =="
    & $Script
}

function Stop-GateProcess($Process) {
    if ($null -ne $Process -and -not $Process.HasExited) {
        Stop-Process -Id $Process.Id -Force
        $Process.WaitForExit(5000) | Out-Null
    }
}

Start-Transcript -Path $transcriptPath -Force | Out-Null

try {
    Invoke-GateStep "Frontend tests" {
        & "C:\Program Files\nodejs\npm.cmd" run test:frontend
        if ($LASTEXITCODE -ne 0) {
            throw "Frontend tests failed with exit code $LASTEXITCODE."
        }
    }

    Invoke-GateStep "Rust command tests in Windows static environment" {
        $setupScript = Join-Path $repoRoot "scripts/setup-windows-static-env.ps1"
        & powershell -ExecutionPolicy Bypass -File $setupScript -Architecture $resolvedArchitecture -Run "Set-Location src-tauri; cargo test"
        if ($LASTEXITCODE -ne 0) {
            throw "Rust command tests failed with exit code $LASTEXITCODE."
        }
    }

    Invoke-GateStep "Windows static package build" {
        $buildScript = Join-Path $repoRoot "scripts/build-windows-static.ps1"
        & powershell -ExecutionPolicy Bypass -File $buildScript -Environment prod -Architecture $resolvedArchitecture
        if ($LASTEXITCODE -ne 0) {
            throw "Windows static package build failed with exit code $LASTEXITCODE."
        }
    }

    Invoke-GateStep "Recovery smoke" {
        $smokeScript = Join-Path $repoRoot "scripts/smoke-windows-static.ps1"
        $smokeArgs = @(
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            $smokeScript,
            "-Architecture",
            $resolvedArchitecture,
            "-SkipResultAppend",
            "-LogDir",
            $logDir
        )
        if ($SkipAppLaunch) {
            $smokeArgs += "-SkipAppLaunch"
        }
        & powershell @smokeArgs
        if ($LASTEXITCODE -ne 0) {
            throw "Recovery smoke failed with exit code $LASTEXITCODE."
        }
    }

    if (-not $SkipInstallerInstall) {
        Invoke-GateStep "Silent installer install and launch smoke" {
            if (-not (Test-Path $installerPath)) {
                throw "Installer not found: $installerPath"
            }

            if (Test-Path $installDir) {
                Remove-Item -LiteralPath $installDir -Recurse -Force
            }
            New-Item -ItemType Directory -Force -Path $installDir | Out-Null

            $installer = Start-Process `
                -FilePath $installerPath `
                -ArgumentList @("/S", "/D=$installDir") `
                -Wait `
                -PassThru `
                -WindowStyle Hidden
            if ($installer.ExitCode -ne 0) {
                throw "Installer smoke failed with exit code $($installer.ExitCode)"
            }

            $installedExe = Get-ChildItem -Path $installDir -Recurse -Filter "zmanager-desktop.exe" |
                Select-Object -First 1
            if ($null -eq $installedExe) {
                throw "Installed executable not found under $installDir"
            }

            $process = Start-Process -FilePath $installedExe.FullName -PassThru -WindowStyle Hidden
            try {
                Start-Sleep -Seconds 5
                if ($process.HasExited) {
                    throw "Installed app exited during launch smoke with code $($process.ExitCode)"
                }
            } finally {
                Stop-GateProcess $process
            }
        }
    } else {
        Invoke-GateStep "Installer smoke skipped" {
            Write-Host "Installer install/launch smoke skipped by -SkipInstallerInstall."
            if (-not (Test-Path $artifactPath)) {
                throw "Packaged executable missing: $artifactPath"
            }
        }
    }

    Invoke-GateStep "Release gate passed" {
        Write-Host "Release gate log: $transcriptPath"
    }
} catch {
    $gateResult = "Fail"
    $gateNotes = "Release gate failed: $($_.Exception.Message). Log: $transcriptPath"
    throw
} finally {
    Stop-Transcript | Out-Null
    $appendScript = Join-Path $repoRoot "scripts/append-platform-smoke-test-result.ps1"
    $artifact = if (Test-Path $installerPath) { $installerPath } elseif (Test-Path $artifactPath) { $artifactPath } else { "Not built" }
    & powershell -ExecutionPolicy Bypass -File $appendScript `
        -Platform $platformLabel `
        -OS "Windows" `
        -Artifact $artifact `
        -InstallStep $(if ($SkipInstallerInstall) { "Installer install skipped; packaged exe launch checked" } else { "Silent installer install and launch" }) `
        -Launch $gateResult `
        -OpenArchive $gateResult `
        -Extract $gateResult `
        -DismissJob "Command smoke covered terminal jobs" `
        -Result $gateResult `
        -CommitTag "working-tree" `
        -Notes $gateNotes
}
