[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ExpectedOrigin,
    [int]$TimeoutSeconds = 30,
    [string]$ReadyFile = ""
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
$root = [System.Windows.Automation.AutomationElement]::RootElement
$windowCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Window
)
$addressCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
    "addressEditBox"
)
$editCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Edit
)
$baselineUrls = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$observedAddressValues = [System.Collections.Concurrent.ConcurrentQueue[string]]::new()
$addressHandlers = @{}

function Register-AddressBar {
    param($AddressBar)

    try {
        $key = [System.Runtime.CompilerServices.RuntimeHelpers]::GetHashCode($AddressBar)
        if ($addressHandlers.ContainsKey($key)) { return }
        $handler = [System.Windows.Automation.AutomationPropertyChangedEventHandler]{
            param($sender, $eventArgs)
            if ($eventArgs.Property -eq [System.Windows.Automation.ValuePattern]::ValueProperty) {
                $value = [string]$eventArgs.NewValue
                if (-not [string]::IsNullOrWhiteSpace($value)) { [void]$observedAddressValues.Enqueue($value) }
            }
        }
        [System.Windows.Automation.Automation]::AddAutomationPropertyChangedEventHandler(
            $AddressBar,
            [System.Windows.Automation.TreeScope]::Element,
            $handler,
            [System.Windows.Automation.ValuePattern]::ValueProperty
        )
        $addressHandlers[$key] = $handler
    } catch {
        # The browser may replace the control while its window is initializing.
    }
}

function Find-AddressBar {
    param($Window)

    $addressBar = $Window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $addressCondition)
    if ($null -ne $addressBar) { return $addressBar }

    # Edge versions/locales do not expose one stable AutomationId. Prefer the
    # semantic accessible name, then fall back to the first edit whose value
    # is an absolute HTTP(S) URL. Page fields are not URL-shaped and therefore
    # cannot be mistaken for the browser address bar by the fallback.
    $edits = $Window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCondition)
    foreach ($edit in $edits) {
        if ($edit.Current.Name -match "Address|search|URL|Omnibox") { return $edit }
    }
    foreach ($edit in $edits) {
        try {
            $valuePattern = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            $candidate = [string]$valuePattern.Current.Value
            $candidateUri = $null
            if ([Uri]::TryCreate($candidate, [UriKind]::Absolute, [ref]$candidateUri) -and $candidateUri.Scheme -in @("http", "https")) {
                return $edit
            }
        } catch {
            # Controls can disappear while the browser updates its tree.
        }
    }
    return $null
}

function Get-BrowserAddressValues {
    $values = @()
    $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $windowCondition)
    foreach ($window in $windows) {
        try {
            if ($window.Current.ClassName -ne "Chrome_WidgetWin_1" -and $window.Current.Name -notmatch "Microsoft Edge|Edge") {
                continue
            }
            $addressBar = Find-AddressBar -Window $window
            if ($null -eq $addressBar) { continue }
            Register-AddressBar -AddressBar $addressBar
            $valuePattern = $addressBar.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            $value = [string]$valuePattern.Current.Value
            if (-not [string]::IsNullOrWhiteSpace($value)) { $values += $value }
        } catch {
            # Windows UI Automation trees change while tabs and windows open.
        }
    }
    return $values
}

foreach ($value in Get-BrowserAddressValues) { [void]$baselineUrls.Add($value) }
if (-not [string]::IsNullOrWhiteSpace($ReadyFile)) {
    Set-Content -LiteralPath $ReadyFile -Value "ready" -NoNewline
}

function Write-Result {
    param(
        [string]$Status,
        [string]$Origin = "",
        [string]$Path = "",
        [string]$QueryKeys = "",
        [string]$Url = "",
        [long]$ObservedAtUnixMs = 0,
        [string]$ErrorCode = ""
    )

    # The full URL is returned only to the short-lived in-memory caller. The
    # caller must not persist or print it; retained evidence contains only the
    # origin/path/query-key boundary.
    [pscustomobject]@{
        status = $Status
        origin = $Origin
        path = $Path
        queryKeys = $QueryKeys
        url = $Url
        observedAtUnixMs = $ObservedAtUnixMs
        errorCode = $ErrorCode
    } | ConvertTo-Json -Compress
}

while ([DateTime]::UtcNow -lt $deadline) {
    $eventValue = $null
    while ($observedAddressValues.TryDequeue([ref]$eventValue)) {
        $eventUri = $null
        if ([Uri]::TryCreate($eventValue, [UriKind]::Absolute, [ref]$eventUri)) {
            if ($eventUri.Host -in @("login.tzap.org", "sign.tzap.org", "account.tzap.org")) {
                Write-Result -Status "production" -Origin $eventUri.GetLeftPart([UriPartial]::Authority) -Path $eventUri.AbsolutePath -ErrorCode "production_host_observed"
                exit 2
            }
            # A UIA value-change event is already proof of a navigation, even
            # when the browser lands on the same final URL as the old tab.
            if ($eventUri.GetLeftPart([UriPartial]::Authority) -eq $ExpectedOrigin) {
                $eventQueryKeys = @(
                    $eventUri.Query.TrimStart("?").Split("&", [StringSplitOptions]::RemoveEmptyEntries) |
                        ForEach-Object { ($_ -split "=", 2)[0] } |
                        Where-Object { $_ }
                ) -join ","
                Write-Result -Status "observed" -Origin $eventUri.GetLeftPart([UriPartial]::Authority) -Path $eventUri.AbsolutePath -QueryKeys $eventQueryKeys -Url $eventValue -ObservedAtUnixMs ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
                exit 0
            }
        }
    }
    $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $windowCondition)
    foreach ($window in $windows) {
        try {
            $className = $window.Current.ClassName
            $name = $window.Current.Name
            if ($className -ne "Chrome_WidgetWin_1" -and $name -notmatch "Microsoft Edge|Edge") {
                continue
            }

            $addressBar = Find-AddressBar -Window $window
            if ($null -eq $addressBar) {
                continue
            }
            Register-AddressBar -AddressBar $addressBar
            $valuePattern = $addressBar.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            $rawValue = [string]$valuePattern.Current.Value
            if ([string]::IsNullOrWhiteSpace($rawValue)) {
                continue
            }
            if ($baselineUrls.Contains($rawValue)) {
                continue
            }

            $url = $null
            if (-not [Uri]::TryCreate($rawValue, [UriKind]::Absolute, [ref]$url)) {
                continue
            }

            if ($url.Host -in @("login.tzap.org", "sign.tzap.org", "account.tzap.org")) {
                Write-Result -Status "production" -Origin $url.GetLeftPart([UriPartial]::Authority) -Path $url.AbsolutePath -ErrorCode "production_host_observed"
                exit 2
            }
            if ($url.GetLeftPart([UriPartial]::Authority) -ne $ExpectedOrigin) {
                continue
            }

            $queryKeys = @(
                $url.Query.TrimStart("?").Split("&", [StringSplitOptions]::RemoveEmptyEntries) |
                    ForEach-Object { ($_ -split "=", 2)[0] } |
                    Where-Object { $_ }
            ) -join ","
            Write-Result -Status "observed" -Origin $url.GetLeftPart([UriPartial]::Authority) -Path $url.AbsolutePath -QueryKeys $queryKeys -Url $rawValue -ObservedAtUnixMs ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
            exit 0
        } catch {
            # Windows UI Automation trees change while tabs and windows open.
            # Retry until the bounded observation window expires.
        }
    }
    Start-Sleep -Milliseconds 250
}

Write-Result -Status "timeout" -ErrorCode "default_browser_navigation_not_observed"
exit 1
