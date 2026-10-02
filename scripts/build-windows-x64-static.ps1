param(
    [ValidateSet("staging", "prod")]
    [string]$Environment = "staging",
    [ValidateSet("local", "online")]
    [string]$Profile = "local",
    [string]$VcpkgRoot = "C:\vcpkg",
    [string]$PerlBin = "C:\Strawberry\perl\bin",
    [string]$Triplet = "",
    [string]$NodePath = "",
    [switch]$Install,
    [switch]$BuildStoreMsix,
    [string]$StorePackageName = "",
    [string]$StorePublisher = "",
    [string]$StorePublisherDisplayName = "",
    [string]$InstallDir = ""
)

$ErrorActionPreference = "Stop"

& (Join-Path $PSScriptRoot "build-windows-static.ps1") `
    -Environment $Environment `
    -Profile $Profile `
    -VcpkgRoot $VcpkgRoot `
    -PerlBin $PerlBin `
    -Architecture x64 `
    -Triplet $Triplet `
    -NodePath $NodePath `
    -Install:$Install `
    -BuildStoreMsix:$BuildStoreMsix `
    -StorePackageName $StorePackageName `
    -StorePublisher $StorePublisher `
    -StorePublisherDisplayName $StorePublisherDisplayName `
    -InstallDir $InstallDir

exit $LASTEXITCODE
