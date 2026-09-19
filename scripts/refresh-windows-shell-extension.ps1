# Makes a freshly installed shell extension take effect on this machine.
#
# Explorer keeps a context menu handler DLL mapped for the lifetime of the
# process. The installer can replace the file on disk (it renames a locked copy
# aside), but a running Explorer keeps serving the previous image, so a rebuild
# appears to change nothing. Restarting Explorer is the only reliable way to
# drop the stale image.
#
# This is deliberately a developer-loop step invoked by build-windows-static.ps1
# after -Install. The shipped NSIS installer does not do it, because killing an
# end user's Explorer closes all of their open windows.

param(
    [switch]$SkipRestart,
    [switch]$Quiet
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent

function Write-Step([string]$Message) {
    if (-not $Quiet) { Write-Host $Message }
}

# The CLSIDs are generated, so read them rather than duplicating them here.
$generated = Get-Content -Raw (Join-Path $repoRoot "packaging\windows\nsis-shell-actions.generated.nsh")
$rootClsids = @{}
foreach ($match in [regex]::Matches($generated, '!define (ZM_(?:ARCHIVE|CREATE)_ROOT_CLSID) "(\{[0-9A-Fa-f-]+\})"')) {
    $rootClsids[$match.Groups[1].Value] = $match.Groups[2].Value
}
if ($rootClsids.Count -ne 2) {
    throw "Expected 2 root CLSIDs in nsis-shell-actions.generated.nsh, found $($rootClsids.Count)."
}
$createRootClsid = $rootClsids["ZM_CREATE_ROOT_CLSID"]

# ---------------------------------------------------------------- registration
$installedDll = $null
foreach ($clsid in $rootClsids.Values) {
    $inproc = "HKCU:\Software\Classes\CLSID\$clsid\InprocServer32"
    if (-not (Test-Path -LiteralPath $inproc)) {
        throw "CLSID $clsid is not registered. Re-run the installer before refreshing."
    }
    $properties = Get-ItemProperty -LiteralPath $inproc
    $path = $properties.'(default)'
    if (-not $path -or -not (Test-Path -LiteralPath $path)) {
        throw "CLSID $clsid points at a missing handler DLL: '$path'"
    }
    if ($properties.ThreadingModel -ne "Apartment") {
        throw "CLSID $clsid has ThreadingModel '$($properties.ThreadingModel)', expected 'Apartment'."
    }
    if ($installedDll -and $installedDll -ne $path) {
        throw "Root CLSIDs resolve to different DLLs: '$installedDll' and '$path'"
    }
    $installedDll = $path
}
Write-Step "Registered handler DLL: $installedDll"

# The `*` key must be matched literally; PowerShell would treat it as a wildcard.
foreach ($shellKey in @("*", "Directory", "Folder")) {
    $handler = "HKCU:\Software\Classes\$shellKey\shellex\ContextMenuHandlers\ZManager"
    if (-not (Test-Path -LiteralPath $handler)) {
        throw "Classic context menu handler is not registered for '$shellKey'."
    }
    $value = (Get-ItemProperty -LiteralPath $handler).'(default)'
    if ($value -ne $createRootClsid) {
        throw "Handler for '$shellKey' points at '$value', expected '$createRootClsid'."
    }
}
Write-Step "Classic handlers registered for *, Directory and Folder."

# ---------------------------------------------------------------- freshness
# Advisory only: the MSVC linker stamps a timestamp and a PDB signature into the
# PE, so two builds of identical source are never byte-identical. Compare what
# is meaningful instead, and let the interface check below be the real gate.
$builtDll = Join-Path $repoRoot "target\windows-shell-extension\zmanager-shell-extension.dll"
if (Test-Path -LiteralPath $builtDll) {
    $built = Get-Item -LiteralPath $builtDll
    $installed = Get-Item -LiteralPath $installedDll
    if ($installed.LastWriteTime -lt $built.LastWriteTime -or $installed.Length -ne $built.Length) {
        Write-Warning ("The installed handler predates this working tree's build " +
            "(installed $($installed.LastWriteTime), $($installed.Length) bytes; built $($built.LastWriteTime), $($built.Length) bytes). " +
            "Re-run the installer if you expected this build to be live.")
    } else {
        Write-Step "Installed handler is at least as new as this tree's build artifact."
    }
} else {
    Write-Step "No build artifact to compare against; skipping the freshness check."
}

# ---------------------------------------------------------------- stale image
# The installer renames a handler it could not delete to "<dll>.old". Whether
# that file can now be deleted is the authoritative staleness signal: a file
# that is still locked means some process has the previous image mapped.
#
# Timestamps cannot be used here. Both NSIS `File` and Copy-Item preserve the
# source file's mtime, so a freshly installed DLL carries its *build* time and
# can legitimately look older than a shell that started after it was installed.
$stalePath = "$installedDll.old"

function Test-PreviousImageReleased {
    if (-not (Test-Path -LiteralPath $stalePath)) { return $true }
    Remove-Item -LiteralPath $stalePath -Force -ErrorAction SilentlyContinue
    return -not (Test-Path -LiteralPath $stalePath)
}

$currentSession = (Get-Process -Id $PID).SessionId
if (Test-PreviousImageReleased) {
    Write-Step "No previous handler image is still mapped; no Explorer restart needed."
} elseif ($SkipRestart) {
    Write-Warning "A previous handler image is still mapped ('$stalePath'). Restart Explorer before testing the context menu."
} else {
    # Only this session's Explorer: on a multi-session host, another user's
    # shell must never be torn down by a build.
    $explorers = @(Get-Process explorer -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq $currentSession })
    Write-Step "A previous handler image is still mapped; restarting Explorer (session $currentSession, PID $($explorers.Id -join ', '))..."
    $explorers | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3

    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
        $running = @(Get-Process explorer -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq $currentSession })
        if ($running.Count -gt 0) { break }
        Start-Process explorer.exe | Out-Null
        Start-Sleep -Seconds 3
    }

    $running = @(Get-Process explorer -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq $currentSession })
    if ($running.Count -eq 0) {
        Write-Warning "Explorer did not come back automatically. Start it manually before testing the context menu."
    } else {
        Write-Step "Explorer restarted (PID $($running.Id -join ', '))."
    }

    # Deleting the file now proves the previous image was actually released.
    if (Test-PreviousImageReleased) {
        Write-Step "Previous handler image released and removed."
    } else {
        Write-Warning "'$stalePath' is still locked by another process; Windows will remove it on the next reboot."
    }
}

# ---------------------------------------------------------------- activation
# The real gate, and the exact sequence Explorer performs: create the registered
# class, then ask it for the classic shell-extension interfaces. A handler left
# over from before the IContextMenu rewrite creates successfully but fails this
# QueryInterface, which is precisely how a stale DLL shows up as a missing menu.
$marshal = [Runtime.InteropServices.Marshal]
$interfaces = [ordered]@{
    IShellExtInit = [Guid]"000214E8-0000-0000-C000-000000000046"
    IContextMenu  = [Guid]"000214E4-0000-0000-C000-000000000046"
}

$comObject = $null
$unknown = [IntPtr]::Zero
try {
    $comObject = [Activator]::CreateInstance([Type]::GetTypeFromCLSID([Guid]$createRootClsid))
    $unknown = $marshal::GetIUnknownForObject($comObject)
    Write-Step "CoCreateInstance on $createRootClsid succeeded."

    foreach ($name in $interfaces.Keys) {
        $iid = $interfaces[$name]
        $interfacePointer = [IntPtr]::Zero
        $hr = $marshal::QueryInterface($unknown, [ref]$iid, [ref]$interfacePointer)
        if ($hr -ne 0) {
            throw ("The installed handler does not implement $name (QueryInterface returned 0x{0:X8}). " -f $hr) +
                  "This is a handler from before the classic context menu rewrite; re-run the installer."
        }
        [void]$marshal::Release($interfacePointer)
        Write-Step "  QueryInterface $name -> ok"
    }
} catch {
    throw "The registered handler failed verification: $($_.Exception.Message)"
} finally {
    if ($unknown -ne [IntPtr]::Zero) { [void]$marshal::Release($unknown) }
    if ($comObject) { [void]$marshal::ReleaseComObject($comObject) }
}

Write-Host "Windows shell extension refreshed; the ZManager context menu is serving this build."
if (-not $Quiet) {
    Write-Host "On Windows 11 the entry appears under 'Show more options' (Shift+F10), not the first-level menu."
}
