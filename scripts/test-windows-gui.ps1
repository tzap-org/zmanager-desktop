[CmdletBinding(PositionalBinding = $false)]
param(
    [string]$VcpkgRoot = "C:\vcpkg",
    [string]$PerlBin = "C:\Strawberry\perl\bin",
    [ValidateSet("Auto", "x64", "arm64")]
    [string]$Architecture = "Auto",
    [string]$Triplet = ""
)

# Keep the existing entry point used by CI and local documentation, but route
# Windows hosted-account tests through the installed staging artifact. The
# implementation lives in a separately named script so the standalone lane is
# explicit and cannot accidentally be confused with a debug-only GUI smoke.
& (Join-Path $PSScriptRoot "test-windows-standalone-staging.ps1") `
    -VcpkgRoot $VcpkgRoot `
    -PerlBin $PerlBin `
    -Architecture $Architecture `
    -Triplet $Triplet

exit $LASTEXITCODE
