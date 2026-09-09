param(
    [ValidateSet("staging", "prod")]
    [string]$Environment = "staging",
    [string]$VcpkgRoot = "C:\vcpkg",
    [string]$PerlBin = "C:\Strawberry\perl\bin",
    [string]$Triplet = "",
    [string]$NodePath = "",
    [switch]$Install,
    [string]$InstallDir = ""
)

$ErrorActionPreference = "Stop"

& (Join-Path $PSScriptRoot "build-windows-static.ps1") `
    -Environment $Environment `
    -VcpkgRoot $VcpkgRoot `
    -PerlBin $PerlBin `
    -Architecture x64 `
    -Triplet $Triplet `
    -NodePath $NodePath `
    -Install:$Install `
    -InstallDir $InstallDir

exit $LASTEXITCODE
