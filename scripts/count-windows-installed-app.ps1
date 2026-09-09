[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ExecutablePath
)

$ErrorActionPreference = "Stop"
$resolvedPath = (Resolve-Path -LiteralPath $ExecutablePath).Path
$count = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
    try {
        $_.Path -and ((Resolve-Path -LiteralPath $_.Path -ErrorAction SilentlyContinue).Path -ieq $resolvedPath)
    } catch {
        $false
    }
}).Count
Write-Output $count
