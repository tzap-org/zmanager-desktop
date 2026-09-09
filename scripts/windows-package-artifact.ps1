function Get-ZManagerWindowsTargetTriple {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet("x64", "arm64")]
        [string]$Architecture
    )

    if ($Architecture -eq "arm64") {
        return "aarch64-pc-windows-msvc"
    }
    return "x86_64-pc-windows-msvc"
}

function Get-ZManagerWindowsReleaseDirectory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CargoTargetDir,
        [Parameter(Mandatory = $true)]
        [ValidateSet("x64", "arm64")]
        [string]$Architecture
    )

    return Get-ZManagerWindowsBuildDirectory `
        -CargoTargetDir $CargoTargetDir `
        -Architecture $Architecture `
        -Configuration "release"
}

function Get-ZManagerWindowsBuildDirectory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CargoTargetDir,
        [Parameter(Mandatory = $true)]
        [ValidateSet("debug", "release")]
        [string]$Configuration,
        [Parameter(Mandatory = $true)]
        [ValidateSet("x64", "arm64")]
        [string]$Architecture
    )

    $targetTriple = Get-ZManagerWindowsTargetTriple -Architecture $Architecture
    return Join-Path $CargoTargetDir "$targetTriple\$Configuration"
}

function Get-ZManagerReleaseExecutablePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CargoTargetDir,
        [Parameter(Mandatory = $true)]
        [ValidateSet("x64", "arm64")]
        [string]$Architecture
    )

    $releaseDir = Get-ZManagerWindowsReleaseDirectory `
        -CargoTargetDir $CargoTargetDir `
        -Architecture $Architecture
    return Join-Path $releaseDir "zmanager-desktop.exe"
}

function Get-ZManagerNsisInstallerPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CargoTargetDir,
        [Parameter(Mandatory = $true)]
        [ValidateSet("x64", "arm64")]
        [string]$Architecture,
        [Parameter(Mandatory = $true)]
        [string]$ProductName,
        [Parameter(Mandatory = $true)]
        [string]$ProductVersion,
        [ValidateSet("debug", "release")]
        [string]$Configuration = "release"
    )

    $buildDir = Get-ZManagerWindowsBuildDirectory `
        -CargoTargetDir $CargoTargetDir `
        -Architecture $Architecture `
        -Configuration $Configuration
    $installerName = "$ProductName`_$ProductVersion`_$Architecture-setup.exe"
    return Join-Path $buildDir "bundle\nsis\$installerName"
}

function Resolve-ZManagerNsisInstaller {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CargoTargetDir,
        [Parameter(Mandatory = $true)]
        [ValidateSet("x64", "arm64")]
        [string]$Architecture,
        [Parameter(Mandatory = $true)]
        [string]$ProductName,
        [Parameter(Mandatory = $true)]
        [string]$ProductVersion,
        [ValidateSet("debug", "release")]
        [string]$Configuration = "release"
    )

    $installerPath = Get-ZManagerNsisInstallerPath `
        -CargoTargetDir $CargoTargetDir `
        -Architecture $Architecture `
        -ProductName $ProductName `
        -ProductVersion $ProductVersion `
        -Configuration $Configuration
    if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) {
        throw "Current NSIS installer was not found: $installerPath"
    }
    return $installerPath
}
