[CmdletBinding(PositionalBinding = $false)]
param(
    [string]$VcpkgRoot = "C:\vcpkg",
    [string]$PerlBin = "C:\Strawberry\perl\bin",
    [ValidateSet("Auto", "x64", "arm64")]
    [string]$Architecture = "Auto",
    [string]$Triplet = "",
    [switch]$InstallClang,
    [string]$Run
)

$ErrorActionPreference = "Stop"

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

function Resolve-PerlBin {
    param([string]$RequestedPerlBin)

    if ((Test-Path (Join-Path $RequestedPerlBin "perl.exe"))) {
        return (Resolve-Path $RequestedPerlBin).Path
    }

    $perl = Get-Command "perl.exe" -ErrorAction SilentlyContinue
    if (-not $perl) {
        $perl = Get-Command "perl" -ErrorAction SilentlyContinue
    }
    if ($perl) {
        return (Split-Path $perl.Source -Parent)
    }

    throw "Perl was not found at $RequestedPerlBin or on PATH. Install Strawberry Perl, or pass -PerlBin C:\path\to\perl\bin."
}

function Resolve-CargoBin {
    $cargo = Get-Command "cargo.exe" -ErrorAction SilentlyContinue
    if (-not $cargo) {
        $cargo = Get-Command "cargo" -ErrorAction SilentlyContinue
    }
    if ($cargo) {
        return (Split-Path $cargo.Source -Parent)
    }

    $defaultCargo = Join-Path $env:USERPROFILE ".cargo\bin\cargo.exe"
    if (Test-Path $defaultCargo) {
        return (Split-Path (Resolve-Path $defaultCargo).Path -Parent)
    }

    throw "Rust Cargo was not found on PATH or at $defaultCargo. Install Rust with the MSVC toolchain, then reopen the shell."
}

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Resolve-WingetCommand {
    foreach ($name in @("winget.exe", "winget")) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if ($command) {
            return $command.Source
        }
    }

    return $null
}

function Test-Executable {
    param([string]$Path)

    if (-not $Path -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $false
    }

    try {
        & $Path --version *> $null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

function Resolve-ClangPath {
    $command = Get-Command "clang.exe" -ErrorAction SilentlyContinue
    if ($command -and (Test-Executable -Path $command.Source)) {
        return (Resolve-Path -LiteralPath $command.Source).Path
    }

    $candidates = @(
        (Join-Path $env:ProgramFiles "LLVM\bin\clang.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "LLVM\bin\clang.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\LLVM\bin\clang.exe")
    )

    $vswherePaths = @(
        "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe",
        "$env:ProgramFiles\Microsoft Visual Studio\Installer\vswhere.exe"
    )
    $vswhere = $vswherePaths | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if ($vswhere) {
        $installations = & $vswhere -products * -property installationPath 2>$null
        foreach ($installation in $installations) {
            $candidates += Join-Path $installation "VC\Tools\Llvm\bin\clang.exe"
        }
    }

    foreach ($candidate in $candidates) {
        if (Test-Executable -Path $candidate) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    return $null
}

function Ensure-Arm64Clang {
    param([string]$ResolvedArchitecture)

    if ($ResolvedArchitecture -ne "arm64") {
        return
    }

    $clang = Resolve-ClangPath
    if (-not $clang) {
        if (-not $InstallClang) {
            throw "Clang is required to build ring for Windows ARM64, but clang.exe was not found. Install LLVM (winget package LLVM.LLVM), or rerun with -InstallClang."
        }

        $winget = Resolve-WingetCommand
        if (-not $winget) {
            throw "Clang is required to build ring for Windows ARM64, but winget.exe was not found. Install LLVM manually from https://llvm.org/ or install winget, then retry."
        }

        Write-Host "Clang was not found; installing LLVM with winget..."
        $arguments = @(
            "install",
            "--id",
            "LLVM.LLVM",
            "--exact",
            "--silent",
            "--accept-package-agreements",
            "--accept-source-agreements"
        )
        if (Test-IsAdministrator) {
            & $winget @arguments
            $installExitCode = $LASTEXITCODE
        } else {
            Write-Host "The LLVM installer requires elevation; requesting a UAC prompt..."
            try {
                $installer = Start-Process `
                    -FilePath $winget `
                    -ArgumentList $arguments `
                    -Verb RunAs `
                    -Wait `
                    -PassThru `
                    -WindowStyle Normal
                $installExitCode = $installer.ExitCode
            } catch {
                throw "Could not start the elevated LLVM installer. Approve the UAC prompt or install clang.exe manually, then retry. $($_.Exception.Message)"
            }
        }
        if ($installExitCode -ne 0) {
            throw "LLVM installation failed with exit code $installExitCode. Install clang.exe manually, then retry."
        }

        $clang = Resolve-ClangPath
    }

    if (-not $clang) {
        throw "LLVM installation completed, but clang.exe could not be located. Reopen the shell or install LLVM manually, then retry."
    }

    $clangBin = Split-Path $clang -Parent
    $env:PATH = "$clangBin;$env:PATH"
    Write-Host "Clang configured for Windows ARM64: $clang"
}

function Import-MsvcEnvironment {
    param([string]$TargetArchitecture = "x64")

    # If cl.exe is already on PATH (e.g. from a VS Developer Command Prompt),
    # we don't need to do anything.
    $existingCl = Get-Command "cl.exe" -ErrorAction SilentlyContinue
    if ($existingCl) {
        Write-Host "MSVC compiler already on PATH: $($existingCl.Source)"
        return
    }

    $vswherePaths = @(
        "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe",
        "$env:ProgramFiles\Microsoft Visual Studio\Installer\vswhere.exe"
    )
    $vswhere = $vswherePaths | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $vswhere) {
        Write-Host "WARNING: vswhere.exe not found. MSVC environment may not be configured."
        return
    }

    # vswhere is not on the default PATH, but vcvarsall.bat (and its helper
    # scripts) may invoke it internally.  Prepend its directory so the child
    # cmd.exe session can find it.
    $vswhereDir = Split-Path $vswhere -Parent
    $env:PATH = "$vswhereDir;$env:PATH"

    $rawPaths = & $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>&1
    if (-not $rawPaths) {
        Write-Host "WARNING: No Visual Studio installation with C++ tools found via vswhere."
        return
    }

    $vcvars = $null
    foreach ($path in $rawPaths) {
        $candidate = Join-Path $path "VC\Auxiliary\Build\vcvarsall.bat"
        if (Test-Path $candidate) {
            $vcvars = $candidate
            break
        }
    }
    if (-not $vcvars) {
        Write-Host "WARNING: vcvarsall.bat not found in any VS installation."
        return
    }

    $archArg = if ($TargetArchitecture -eq "arm64") {
        if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "amd64_arm64" }
    } else {
        if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64_x64" } else { "amd64" }
    }

    Write-Host "Importing MSVC environment: $vcvars $archArg"

    $file = [System.IO.Path]::GetTempFileName() + ".bat"
    # Redirect both stdout and stderr inside the cmd.exe session so that
    # any incidental errors from vcvarsall.bat helpers (e.g. vswhere.exe)
    # don't leak to the console or the error stream.
    Set-Content -Path $file -Value "@echo off`r`ncall `"$vcvars`" $archArg >nul 2>&1`r`nset"
    $envOutput = cmd.exe /c $file 2>&1
    Remove-Item $file -Force -ErrorAction SilentlyContinue

    # Import all MSVC and Windows SDK environment variables from the
    # vcvarsall.bat output.  Build scripts (cc-rs, ring, etc.) probe for
    # variables like VCINSTALLDIR, VCToolsVersion, WindowsSdkDir, and
    # WindowsSDKVersion to detect the MSVC toolchain — without them they
    # fall back to looking for clang/gcc and fail.
    $msvcPrefixes = @(
        "VC", "VS", "VCTools", "DevEnv",
        "WindowsSdk", "WindowsSDK", "ExtensionSdk",
        "UCRT", "UniversalCRT", "Framework",
        "VisualStudio", "CommandPrompt", "Platform",
        "VSCMD"
    )
    foreach ($line in $envOutput) {
        if ($line -match "^([^=]+)=(.*)$") {
            $key = $matches[1]
            $val = $matches[2]
            $import = ($key -ieq "PATH" -or $key -ieq "INCLUDE" -or $key -ieq "LIB" -or $key -ieq "LIBPATH")
            if (-not $import) {
                foreach ($prefix in $msvcPrefixes) {
                    if ($key -like "$prefix*") { $import = $true; break }
                }
            }
            if ($import) {
                [Environment]::SetEnvironmentVariable($key, $val, [EnvironmentVariableTarget]::Process)
                Set-Item -Path "env:$key" -Value $val
            }
        }
    }

    # Verify the import actually worked.
    $cl = Get-Command "cl.exe" -ErrorAction SilentlyContinue
    if ($cl) {
        Write-Host "MSVC compiler configured: $($cl.Source)"
    } else {
        Write-Host "WARNING: cl.exe was not found on PATH after importing the MSVC environment. The build may fail."
    }
}

$resolvedArchitecture = Resolve-WindowsStaticArchitecture -RequestedArchitecture $Architecture
$Triplet = Resolve-WindowsStaticTriplet -RequestedTriplet $Triplet -ResolvedArchitecture $resolvedArchitecture
$resolvedPerlBin = Resolve-PerlBin -RequestedPerlBin $PerlBin
$resolvedCargoBin = Resolve-CargoBin

Import-MsvcEnvironment -TargetArchitecture $resolvedArchitecture
Ensure-Arm64Clang -ResolvedArchitecture $resolvedArchitecture

$toolchainFile = Join-Path $VcpkgRoot "scripts\buildsystems\vcpkg.cmake"
$debugLib = Join-Path $VcpkgRoot "installed\$Triplet\debug\lib"
$releaseLib = Join-Path $VcpkgRoot "installed\$Triplet\lib"
$include = Join-Path $VcpkgRoot "installed\$Triplet\include"
$debugBin = Join-Path $VcpkgRoot "installed\$Triplet\debug\bin"
$releaseBin = Join-Path $VcpkgRoot "installed\$Triplet\bin"

if (-not (Test-Path $toolchainFile)) {
    throw "vcpkg toolchain file was not found: $toolchainFile. Install vcpkg at $VcpkgRoot and run $VcpkgRoot\bootstrap-vcpkg.bat."
}

if ((-not (Test-Path $include)) -or (-not (Test-Path $debugLib)) -or (-not (Test-Path $releaseLib))) {
    $vcpkgExe = Join-Path $VcpkgRoot "vcpkg.exe"
    throw "vcpkg dependencies were not found for triplet '$Triplet'. Run: $vcpkgExe install zlib bzip2 liblzma zstd lz4 --triplet $Triplet"
}

$env:VCPKG_INSTALLATION_ROOT = $VcpkgRoot
$env:VCPKG_ROOT = $VcpkgRoot
$env:CMAKE_TOOLCHAIN_FILE = $toolchainFile
$env:VCPKG_DEFAULT_TRIPLET = $Triplet
$env:VCPKG_TARGET_TRIPLET = $Triplet
# Seed a fallback for tools that use the Windows static environment without
# compiling the desktop. Desktop Cargo builds replace it with pinned OpenSSL.
$env:OPENSSL_DIR = Join-Path $VcpkgRoot "installed\$Triplet"
$env:OPENSSL_STATIC = "1"
$env:OPENSSL_NO_VENDOR = "1"

if ($Run -match "(?i)(src-tauri[\\/]Cargo\.toml|tauri\.js|tauri build)") {
    $opensslTarget = if ($resolvedArchitecture -eq "arm64") { "aarch64-pc-windows-msvc" } else { "x86_64-pc-windows-msvc" }
    $opensslBuilder = Join-Path (Split-Path $PSScriptRoot -Parent) "..\zmanager\scripts\build-openssl.py"
    if (-not (Test-Path -LiteralPath $opensslBuilder -PathType Leaf)) {
        throw "Pinned ZManager OpenSSL builder is missing: $opensslBuilder. Run scripts/ensure-sibling-repos.ps1 first."
    }
    $opensslBuilder = (Resolve-Path -LiteralPath $opensslBuilder).Path
    $opensslDir = & python $opensslBuilder $opensslTarget
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($opensslDir)) {
        throw "Could not provision patched OpenSSL 3.5.9 for $opensslTarget."
    }
    $opensslNotice = Join-Path $opensslDir "THIRD-PARTY-NOTICES.txt"
    if (-not (Test-Path -LiteralPath $opensslNotice -PathType Leaf) -or
        -not (Select-String -LiteralPath $opensslNotice -Pattern "e08c7ad5e3f31488eb622515da4434a858038873b07fa1f021271c98bed8e2fe" -Quiet)) {
        throw "The OpenSSL installation does not include the expected RSA-PSS provider alias patch: $opensslDir"
    }
    $env:OPENSSL_DIR = $opensslDir.Trim()
    $env:OPENSSL_STATIC = "1"
    $env:OPENSSL_NO_VENDOR = "1"
    if ($env:GITHUB_ENV) {
        @("OPENSSL_DIR=$($env:OPENSSL_DIR)", "OPENSSL_STATIC=1", "OPENSSL_NO_VENDOR=1") | Add-Content -LiteralPath $env:GITHUB_ENV
    }
}

$env:LIB = "$debugLib;$releaseLib;" + $env:LIB
$env:INCLUDE = "$include;" + $env:INCLUDE

if (-not $env:CARGO_TARGET_DIR) {
    $env:CARGO_TARGET_DIR = Join-Path $env:USERPROFILE ".zmbuild"
}
if (-not (Test-Path $env:CARGO_TARGET_DIR)) {
    New-Item -ItemType Directory -Force -Path $env:CARGO_TARGET_DIR | Out-Null
}

# Prepend tool paths to PATH; the MSVC directories are already present
# from Import-MsvcEnvironment above.
$env:PATH = "$resolvedCargoBin;$resolvedPerlBin;$debugBin;$releaseBin;" + $env:PATH

if ($resolvedArchitecture -eq "arm64") {
    $cl = Get-Command "cl.exe" -ErrorAction SilentlyContinue
    $lib = Get-Command "lib.exe" -ErrorAction SilentlyContinue
    if ($cl) {
        $env:CC_aarch64_pc_windows_msvc = "cl.exe"
        ${env:CC_aarch64-pc-windows-msvc} = "cl.exe"
    }
    if ($lib) {
        $env:AR_aarch64_pc_windows_msvc = "lib.exe"
        ${env:AR_aarch64-pc-windows-msvc} = "lib.exe"
    }
}

Write-Host "Configured Windows static native build environment."
Write-Host "Architecture: $resolvedArchitecture"
Write-Host "Triplet: $Triplet"
Write-Host "Perl bin: $resolvedPerlBin"
Write-Host "Cargo bin: $resolvedCargoBin"
Write-Host "VCPKG_ROOT: $env:VCPKG_ROOT"
Write-Host "CMAKE_TOOLCHAIN_FILE: $env:CMAKE_TOOLCHAIN_FILE"

if (-not [string]::IsNullOrWhiteSpace($Run)) {
    Write-Host "Running: $Run"
    powershell -NoProfile -Command $Run
    exit $LASTEXITCODE
}
