[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Url
)

$ErrorActionPreference = "Stop"
if ($Url -notmatch '^tzap://[^\s]+$' -or $Url.Contains('"')) {
    throw "Only tzap protocol URLs are allowed by this test helper."
}

# Keep the scheme check broad enough for the security cases: malformed paths,
# wrong hosts, and invalid handoff codes must still reach the registered
# application so that its callback validator—not this harness—rejects them.
# Start-Process asks Windows ShellExecute to resolve the registered protocol
# and returns immediately; cmd.exe `start` can remain attached to a custom
# protocol handler until the receiving singleton exits.
Start-Process -FilePath $Url -WindowStyle Hidden | Out-Null
