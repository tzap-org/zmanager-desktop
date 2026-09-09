[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ExecutablePath
)

$ErrorActionPreference = "Stop"
Start-Process -FilePath (Resolve-Path -LiteralPath $ExecutablePath).Path -WindowStyle Hidden | Out-Null
