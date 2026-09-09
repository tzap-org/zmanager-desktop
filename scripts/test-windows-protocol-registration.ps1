[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ExecutablePath,
    [switch]$ExpectAbsent
)

$ErrorActionPreference = "Stop"
$resolvedExecutable = [IO.Path]::GetFullPath($ExecutablePath)
if (-not $ExpectAbsent -and -not (Test-Path -LiteralPath $resolvedExecutable -PathType Leaf)) {
    throw "Installed executable was not found: $resolvedExecutable"
}
$registryPaths = @(
    "Registry::HKEY_CURRENT_USER\Software\Classes\tzap\shell\open\command",
    "Registry::HKEY_LOCAL_MACHINE\Software\Classes\tzap\shell\open\command",
    "Registry::HKEY_CLASSES_ROOT\tzap\shell\open\command"
)

$commands = foreach ($registryPath in $registryPaths) {
    if (Test-Path -LiteralPath $registryPath) {
        $key = Get-Item -LiteralPath $registryPath
        [string]$key.GetValue("")
    }
}

$matchingCommand = $commands | Where-Object {
    $_ -and $_.IndexOf($resolvedExecutable, [StringComparison]::OrdinalIgnoreCase) -ge 0
} | Select-Object -First 1

if ($ExpectAbsent) {
    if ($matchingCommand) {
        throw "tzap protocol registration still points to the removed executable: $resolvedExecutable"
    }
    Write-Host "tzap protocol registration no longer points to the removed executable."
    exit 0
}

if (-not $matchingCommand) {
    throw "tzap protocol registration does not point to the installed executable: $resolvedExecutable"
}

Write-Host "tzap protocol registration points to the installed executable."
