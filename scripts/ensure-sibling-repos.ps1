[CmdletBinding(PositionalBinding = $false)]
param(
    [ValidateSet("", "local", "snapshot", "release")]
    [string]$Mode = "",
    [string]$LockFile = "",
    [string]$ParentDir = ""
)

$ErrorActionPreference = "Stop"
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
if (-not $Mode) { $Mode = if ($env:ZMANAGER_BUILD_MODE) { $env:ZMANAGER_BUILD_MODE } else { "local" } }
if (-not $LockFile -and $env:ZMANAGER_BUILD_INPUTS_LOCK) { $LockFile = $env:ZMANAGER_BUILD_INPUTS_LOCK }
if ($ParentDir) {
    $env:ZMANAGER_SIBLING_PARENT_DIR = [System.IO.Path]::GetFullPath($ParentDir)
}

$bashCommand = Get-Command bash.exe -ErrorAction SilentlyContinue
if (-not $bashCommand) { $bashCommand = Get-Command bash -ErrorAction SilentlyContinue }
if (-not $bashCommand) {
    foreach ($candidate in @("C:\Program Files\Git\bin\bash.exe", "C:\Program Files\Git\usr\bin\bash.exe")) {
        if (Test-Path $candidate) { $bashCommand = [pscustomobject]@{ Source = $candidate }; break }
    }
}
if (-not $bashCommand) { throw "Git Bash is required to prepare sibling inputs. Install Git for Windows and ensure bash.exe is available." }

$script = Join-Path $PSScriptRoot "ensure-sibling-repos.sh"
$arguments = @($script, "--mode", $Mode)
if ($LockFile) { $arguments += @("--lockfile", [System.IO.Path]::GetFullPath($LockFile)) }
& $bashCommand.Source @arguments
if ($LASTEXITCODE -ne 0) { throw "Sibling input preparation failed with exit code $LASTEXITCODE." }
