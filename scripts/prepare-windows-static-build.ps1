[CmdletBinding(PositionalBinding = $false)]
param(
    [ValidateSet("staging", "prod")]
    [string]$Environment = "staging",
    [string]$VcpkgRoot = "C:\vcpkg",
    [string]$PerlBin = "C:\Strawberry\perl\bin",
    [ValidateSet("Auto", "x64", "arm64")]
    [string]$Architecture = "Auto",
    [string]$Triplet = "",
    [string]$NodePath = "",
    [switch]$InstallMissing,
    [switch]$InstallNodeModules,
    [switch]$Build
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $repoRoot

$env:ZMANAGER_TZAP_BUILD_ENV = $Environment
$env:VITE_TZAP_BUILD_ENV = $Environment
if ($Environment -eq "staging") {
    $env:ZMANAGER_TZAP_SERVER_BASE_URL = "https://staging.tzap.org"
} else {
    Remove-Item Env:ZMANAGER_TZAP_SERVER_BASE_URL -ErrorAction SilentlyContinue
}
Write-Host "Hosted account build environment: $Environment"

$vcpkgPackages = @("zlib", "bzip2", "liblzma", "zstd", "lz4", "openssl")

function Invoke-Step {
    param(
        [string]$Name,
        [scriptblock]$Script
    )

    Write-Host ""
    Write-Host "== $Name =="
    & $Script
}

function Invoke-Native {
    param(
        [string]$FilePath,
        [string[]]$Arguments = @()
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
    }
}

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

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

function Resolve-FirstExistingPath {
    param([string[]]$Paths)

    foreach ($path in $Paths) {
        if (-not [string]::IsNullOrWhiteSpace($path) -and (Test-Path $path)) {
            return (Resolve-Path $path).Path
        }
    }

    return $null
}

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

function Resolve-WindowsStaticTriplet {
    param(
        [string]$RequestedTriplet,
        [string]$ResolvedArchitecture
    )

    if (-not [string]::IsNullOrWhiteSpace($RequestedTriplet)) {
        return $RequestedTriplet
    }

    if ($ResolvedArchitecture -eq "arm64") {
        return "arm64-windows-static-md"
    }

    return "x64-windows-static-md"
}

function Resolve-GitCommand {
    $git = Resolve-OptionalCommand -Names @("git.exe", "git")
    if ($git) {
        return $git
    }

    $git = Resolve-FirstExistingPath -Paths @(
        "C:\Program Files\Git\cmd\git.exe",
        "C:\Program Files\Git\bin\git.exe",
        "C:\Program Files (x86)\Git\cmd\git.exe"
    )
    if ($git) {
        return $git
    }

    throw "Git was not found. Install Git for Windows, or put git.exe on PATH."
}

function Resolve-WingetCommand {
    $winget = Resolve-OptionalCommand -Names @("winget.exe", "winget")
    if ($winget) {
        return $winget
    }

    throw "winget was not found. Install missing prerequisites manually, or run this script on a Windows image with winget."
}

function Install-WingetPackage {
    param(
        [string]$PackageId,
        [string[]]$ExtraArguments = @()
    )

    if (-not (Test-IsAdministrator)) {
        throw "Installing $PackageId requires an elevated PowerShell session. Re-run this script as Administrator, or install the prerequisite manually and run without -InstallMissing."
    }

    $winget = Resolve-WingetCommand
    Invoke-Native -FilePath $winget -Arguments (@(
        "install",
        "--id",
        $PackageId,
        "--exact",
        "--accept-package-agreements",
        "--accept-source-agreements"
    ) + $ExtraArguments)
}

function Test-Node24 {
    param([string]$NodePath)

    try {
        $version = (& $NodePath --version 2>$null | Select-Object -First 1).Trim()
        return $version -match '^v24\.'
    } catch {
        return $false
    }
}

function Resolve-NodeCommand {
    param([string]$RequestedNodePath)

    if (-not [string]::IsNullOrWhiteSpace($RequestedNodePath)) {
        if (-not (Test-Path $RequestedNodePath)) {
            throw "Node executable was not found: $RequestedNodePath"
        }
        $requested = (Resolve-Path $RequestedNodePath).Path
        if (-not (Test-Node24 -NodePath $requested)) {
            throw "Node.js 24 is required. The requested executable is not Node 24: $requested"
        }
        return $requested
    }

    $node = Resolve-OptionalCommand -Names @("node.exe", "node")
    if ($node -and (Test-Node24 -NodePath $node)) {
        return $node
    }

    $node = Resolve-FirstExistingPath -Paths @(
        (Join-Path $env:ProgramFiles "nodejs\node.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "nodejs\node.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe")
    )
    if ($node -and (Test-Node24 -NodePath $node)) {
        return $node
    }

    if (-not $InstallMissing) {
        throw "Node.js was not found. Install Node.js 24, pass -NodePath C:\path\to\node.exe, or rerun with -InstallMissing to try winget."
    }

    Install-WingetPackage -PackageId "OpenJS.NodeJS.LTS" -ExtraArguments @("--silent")

    $node = Resolve-FirstExistingPath -Paths @(
        (Join-Path $env:ProgramFiles "nodejs\node.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "nodejs\node.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe")
    )
    if ($node -and (Test-Node24 -NodePath $node)) {
        return $node
    }

    throw "Node.js installation completed, but node.exe was not found. Reopen the shell or pass -NodePath."
}

function Resolve-NpmCommand {
    param([string]$ResolvedNodePath)

    $nodeDir = Split-Path $ResolvedNodePath -Parent
    $npm = Resolve-FirstExistingPath -Paths @(
        (Join-Path $nodeDir "npm.cmd"),
        (Join-Path $nodeDir "npm")
    )
    if ($npm) {
        return $npm
    }

    $npm = Resolve-OptionalCommand -Names @("npm.cmd", "npm")
    if ($npm) {
        return $npm
    }

    throw "npm was not found next to Node.js or on PATH. Install Node.js with npm."
}

function Resolve-PerlBin {
    param([string]$RequestedPerlBin)

    if (Test-Path (Join-Path $RequestedPerlBin "perl.exe")) {
        return (Resolve-Path $RequestedPerlBin).Path
    }

    $perl = Resolve-OptionalCommand -Names @("perl.exe", "perl")
    if ($perl) {
        return (Split-Path $perl -Parent)
    }

    return $null
}

function Assert-VisualCppBuildTools {
    $cl = Resolve-OptionalCommand -Names @("cl.exe", "cl")
    if ($cl) {
        Write-Host "MSVC compiler found on PATH: $cl"
        return
    }

    $vswhere = Resolve-FirstExistingPath -Paths @(
        "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe",
        "$env:ProgramFiles\Microsoft Visual Studio\Installer\vswhere.exe"
    )

    if ($vswhere) {
        $installationPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
        if (-not [string]::IsNullOrWhiteSpace($installationPath)) {
            Write-Host "Visual Studio C++ Build Tools found: $installationPath"
            return
        }
    }

    if (-not $InstallMissing) {
        throw "Visual Studio 2022 Build Tools with the C++ desktop workload were not found. Install them before building Windows artifacts, or rerun with -InstallMissing to try winget."
    }

    Install-WingetPackage `
        -PackageId "Microsoft.VisualStudio.2022.BuildTools" `
        -ExtraArguments @(
            "--silent",
            "--override",
            "--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
        )

    $vswhere = Resolve-FirstExistingPath -Paths @(
        "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe",
        "$env:ProgramFiles\Microsoft Visual Studio\Installer\vswhere.exe"
    )
    if ($vswhere) {
        $installationPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
        if (-not [string]::IsNullOrWhiteSpace($installationPath)) {
            Write-Host "Visual Studio C++ Build Tools found: $installationPath"
            return
        }
    }

    throw "Visual Studio Build Tools installation completed, but C++ tools were not found. Reopen the shell or verify the Visual Studio installer workload."
}

function Assert-Cargo {
    $cargo = Resolve-OptionalCommand -Names @("cargo.exe", "cargo")
    if ($cargo) {
        Write-Host "Cargo found: $cargo"
        $env:PATH = "$(Split-Path $cargo -Parent);" + $env:PATH
        return
    }

    $cargo = Resolve-FirstExistingPath -Paths @(
        (Join-Path $env:USERPROFILE ".cargo\bin\cargo.exe")
    )
    if ($cargo) {
        Write-Host "Cargo found: $cargo"
        $env:PATH = "$(Split-Path $cargo -Parent);" + $env:PATH
        return
    }

    if (-not $InstallMissing) {
        throw "Rust Cargo was not found. Install Rust with the MSVC toolchain, or rerun with -InstallMissing to try winget."
    }

    Install-WingetPackage -PackageId "Rustlang.Rustup" -ExtraArguments @("--silent")

    $rustup = Resolve-FirstExistingPath -Paths @(
        (Join-Path $env:USERPROFILE ".cargo\bin\rustup.exe")
    )
    if ($rustup) {
        Invoke-Native -FilePath $rustup -Arguments @("default", "stable")
    }

    $cargo = Resolve-FirstExistingPath -Paths @(
        (Join-Path $env:USERPROFILE ".cargo\bin\cargo.exe")
    )
    if ($cargo) {
        Write-Host "Cargo found: $cargo"
        $env:PATH = "$(Split-Path $cargo -Parent);" + $env:PATH
        return
    }

    throw "Rust installation completed, but cargo.exe was not found. Reopen the shell or install Rust manually."
}

function Ensure-StrawberryPerl {
    param([string]$RequestedPerlBin)

    $resolvedPerlBin = Resolve-PerlBin -RequestedPerlBin $RequestedPerlBin
    if ($resolvedPerlBin) {
        Write-Host "Perl found: $resolvedPerlBin"
        return $resolvedPerlBin
    }

    if (-not $InstallMissing) {
        throw "Perl was not found at $RequestedPerlBin or on PATH. Install Strawberry Perl, pass -PerlBin, or rerun with -InstallMissing to try winget."
    }

    Install-WingetPackage -PackageId "StrawberryPerl.StrawberryPerl" -ExtraArguments @("--silent")

    $resolvedPerlBin = Resolve-PerlBin -RequestedPerlBin $RequestedPerlBin
    if (-not $resolvedPerlBin) {
        throw "Strawberry Perl install completed, but perl.exe was not found at $RequestedPerlBin. Reopen the shell or pass -PerlBin."
    }
    return $resolvedPerlBin
}

function Ensure-Vcpkg {
    param(
        [string]$RequestedVcpkgRoot,
        [string]$ResolvedTriplet
    )

    $toolchainFile = Join-Path $RequestedVcpkgRoot "scripts\buildsystems\vcpkg.cmake"
    $vcpkgExe = Join-Path $RequestedVcpkgRoot "vcpkg.exe"

    if (-not (Test-Path $toolchainFile)) {
        if (-not $InstallMissing) {
            throw "vcpkg toolchain file was not found: $toolchainFile. Install vcpkg, or rerun with -InstallMissing to clone and bootstrap it."
        }

        $git = Resolve-GitCommand
        if (-not (Test-Path $RequestedVcpkgRoot)) {
            Invoke-Native -FilePath $git -Arguments @("clone", "https://github.com/microsoft/vcpkg", $RequestedVcpkgRoot)
        }

        $bootstrap = Join-Path $RequestedVcpkgRoot "bootstrap-vcpkg.bat"
        if (-not (Test-Path $bootstrap)) {
            throw "vcpkg bootstrap script was not found: $bootstrap"
        }

        Invoke-Native -FilePath $bootstrap
    }

    if (-not (Test-Path $vcpkgExe)) {
        throw "vcpkg.exe was not found: $vcpkgExe"
    }

    $include = Join-Path $RequestedVcpkgRoot "installed\$ResolvedTriplet\include"
    $debugLib = Join-Path $RequestedVcpkgRoot "installed\$ResolvedTriplet\debug\lib"
    $releaseLib = Join-Path $RequestedVcpkgRoot "installed\$ResolvedTriplet\lib"
    if ((Test-Path $include) -and (Test-Path $debugLib) -and (Test-Path $releaseLib)) {
        Write-Host "vcpkg dependencies found for $ResolvedTriplet."
        return
    }

    if (-not $InstallMissing) {
        $packageList = $vcpkgPackages -join " "
        throw "vcpkg dependencies were not found for $ResolvedTriplet. Run: $vcpkgExe install $packageList --triplet $ResolvedTriplet"
    }

    Invoke-Native -FilePath $vcpkgExe -Arguments (@("install") + $vcpkgPackages + @("--triplet", $ResolvedTriplet))
}

$resolvedArchitecture = Resolve-WindowsStaticArchitecture -RequestedArchitecture $Architecture
$resolvedTriplet = Resolve-WindowsStaticTriplet -RequestedTriplet $Triplet -ResolvedArchitecture $resolvedArchitecture
$resolvedNodePath = ""
$npmCommand = ""
$resolvedPerlBin = ""

Invoke-Step "Resolve Windows static target" {
    Write-Host "Architecture: $resolvedArchitecture"
    Write-Host "Triplet: $resolvedTriplet"
}

Invoke-Step "Check native build tools" {
    Assert-VisualCppBuildTools
    Assert-Cargo
}

Invoke-Step "Check Node.js" {
    $script:resolvedNodePath = Resolve-NodeCommand -RequestedNodePath $NodePath
    $script:npmCommand = Resolve-NpmCommand -ResolvedNodePath $script:resolvedNodePath
    $nodeVersion = (& $script:resolvedNodePath --version).Trim()
    Write-Host "Node found: $script:resolvedNodePath ($nodeVersion)"
    Write-Host "npm found: $script:npmCommand"
}

Invoke-Step "Prepare Perl and vcpkg" {
    $script:resolvedPerlBin = Ensure-StrawberryPerl -RequestedPerlBin $PerlBin
    Ensure-Vcpkg -RequestedVcpkgRoot $VcpkgRoot -ResolvedTriplet $resolvedTriplet
}

if ($InstallNodeModules) {
    Invoke-Step "Install frontend dependencies" {
        if (Test-Path (Join-Path $repoRoot "package-lock.json")) {
            Invoke-Native -FilePath $script:npmCommand -Arguments @("ci")
        } else {
            Invoke-Native -FilePath $script:npmCommand -Arguments @("install")
        }
    }
}

Invoke-Step "Verify configured build environment" {
    $setupScript = Join-Path $PSScriptRoot "setup-windows-static-env.ps1"
    & $setupScript `
        -VcpkgRoot $VcpkgRoot `
        -PerlBin $script:resolvedPerlBin `
        -Architecture $resolvedArchitecture `
        -Triplet $resolvedTriplet `
        -InstallClang:$InstallMissing `
        -Run "Write-Host 'Windows static build environment is ready.'"
    if ($LASTEXITCODE -ne 0) {
        throw "Environment verification failed with exit code $LASTEXITCODE."
    }
}

if ($Build) {
    Invoke-Step "Ensure sibling repositories" {
        $siblingScript = Join-Path $PSScriptRoot "ensure-sibling-repos.ps1"
        & $siblingScript
        if ($LASTEXITCODE -ne 0) {
            throw "Sibling repository setup failed with exit code $LASTEXITCODE."
        }
    }

    Invoke-Step "Build Windows artifact" {
        $buildScript = Join-Path $PSScriptRoot "build-windows-static.ps1"
        & $buildScript `
            -Environment $Environment `
            -VcpkgRoot $VcpkgRoot `
            -PerlBin $script:resolvedPerlBin `
            -Architecture $resolvedArchitecture `
            -Triplet $resolvedTriplet `
            -NodePath $script:resolvedNodePath `
            -InstallClang:$InstallMissing
        if ($LASTEXITCODE -ne 0) {
            throw "Windows artifact build failed with exit code $LASTEXITCODE."
        }
    }
}
