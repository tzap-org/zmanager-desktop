[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ExecutablePath
)

$ErrorActionPreference = "Stop"
$resolvedPath = (Resolve-Path -LiteralPath $ExecutablePath).Path
$matches = Get-Process -ErrorAction SilentlyContinue | Where-Object {
    try {
        $_.Path -and ((Resolve-Path -LiteralPath $_.Path -ErrorAction SilentlyContinue).Path -ieq $resolvedPath)
    } catch {
        $false
    }
}
foreach ($process in $matches) {
    Stop-Process -Id $process.Id -Force -ErrorAction Stop
}

for ($attempt = 0; $attempt -lt 40; $attempt++) {
    $remaining = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
        try {
            $_.Path -and ((Resolve-Path -LiteralPath $_.Path -ErrorAction SilentlyContinue).Path -ieq $resolvedPath)
        } catch {
            $false
        }
    })
    if ($remaining.Count -eq 0) { exit 0 }
    Start-Sleep -Milliseconds 250
}

throw "Installed application did not stop: $resolvedPath"
