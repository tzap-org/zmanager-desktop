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
$treeCondition = [System.Windows.Automation.Condition]::TrueCondition
$baselineUrls = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$observedAddressValues = [System.Collections.Concurrent.ConcurrentQueue[string]]::new()
$addressHandlers = @{}
$script:lastBrowserProcessCount = 0
$script:lastBrowserWindowCount = 0
$script:lastAddressBarCount = 0
$script:lastAddressValueCount = 0
$script:lastExpectedOriginSeen = $false

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

    $elements = $Window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $treeCondition)
    $candidates = @()
    foreach ($element in $elements) {
        if ($element.Current.AutomationId -eq "addressEditBox") { $candidates += $element }
    }

    # Edge versions/locales do not expose one stable AutomationId. Prefer the
    # semantic accessible name, then fall back to the first edit whose value
    # is an absolute HTTP(S) URL. Page fields are not URL-shaped and therefore
    # cannot be mistaken for the browser address bar by the fallback.
    foreach ($element in $elements) {
        if ($element.Current.AutomationId -ne "addressEditBox" -and
            $element.Current.ControlType -in @(
                [System.Windows.Automation.ControlType]::Edit,
                [System.Windows.Automation.ControlType]::ComboBox
            ) -and $element.Current.Name -match "Address|search|URL|Omnibox") {
            $candidates += $element
        }
    }
    foreach ($element in $elements) {
        if ($element.Current.ControlType -notin @(
                [System.Windows.Automation.ControlType]::Edit,
                [System.Windows.Automation.ControlType]::ComboBox
            ) -or $element.Current.AutomationId -eq "addressEditBox" -or
            $element.Current.Name -match "Address|search|URL|Omnibox") { continue }
        try {
            $valuePattern = $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            $candidate = [string]$valuePattern.Current.Value
            $candidateUri = $null
            if ([Uri]::TryCreate($candidate, [UriKind]::Absolute, [ref]$candidateUri) -and $candidateUri.Scheme -in @("http", "https")) {
                $candidates += $element
            }
        } catch {
            # Controls can disappear while the browser updates its tree.
        }
    }

    # The address bar can be present in the accessibility tree but temporarily
    # lack a ValuePattern while Chromium replaces controls during navigation.
    # Keep trying candidates instead of returning the first named edit and
    # losing the entire browser window when that transient control is stale.
    foreach ($candidate in $candidates) {
        try {
            [void]$candidate.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            return $candidate
        } catch {
            # Try the next address-bar candidate in the current tree.
        }
    }
    return $null
}

function Get-BrowserWindows {
    $windowsByHandle = @{}
    $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $windowCondition)
    foreach ($window in $windows) {
        try {
            $handle = [long]$window.Current.NativeWindowHandle
            if ($handle -ne 0) { $windowsByHandle[$handle] = $window }
        } catch {
            # A top-level window may close while the desktop tree is read.
        }
    }

    # Some hosted Windows desktops expose Chromium's top-level windows through
    # the process handle before they appear in RootElement's child collection.
    # Resolve those handles as well so the observer can see a freshly launched
    # default browser on the first navigation after app startup.
    $browserProcesses = @(Get-Process -Name msedge, chrome -ErrorAction SilentlyContinue)
    $script:lastBrowserProcessCount = $browserProcesses.Count
    foreach ($browserProcess in $browserProcesses) {
        try {
            $handle = [long]$browserProcess.MainWindowHandle
            if ($handle -ne 0 -and -not $windowsByHandle.ContainsKey($handle)) {
                $windowsByHandle[$handle] = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$handle)
            }
        } catch {
            # The browser may be starting or closing while handles are resolved.
        }
    }
    return @($windowsByHandle.Values)
}

function Get-BrowserAddressValues {
    $values = @()
    $script:lastBrowserWindowCount = 0
    $script:lastAddressBarCount = 0
    $script:lastAddressValueCount = 0
    $windows = Get-BrowserWindows
    foreach ($window in $windows) {
        try {
            if ($window.Current.ClassName -ne "Chrome_WidgetWin_1" -and $window.Current.Name -notmatch "Microsoft Edge|Edge") {
                continue
            }
            $script:lastBrowserWindowCount++
            $addressBar = Find-AddressBar -Window $window
            if ($null -eq $addressBar) { continue }
            $script:lastAddressBarCount++
            Register-AddressBar -AddressBar $addressBar
            $valuePattern = $addressBar.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            $value = [string]$valuePattern.Current.Value
            if (-not [string]::IsNullOrWhiteSpace($value)) {
                $script:lastAddressValueCount++
                $values += $value
            }
        } catch {
            # Windows UI Automation trees change while tabs and windows open.
        }
    }
    return $values
}

# Establish the baseline and register address-bar event handlers before
# allowing the caller to dispatch the navigation. If readiness is signalled
# first, a fast browser can finish its navigation while this scan is still
# running; the new URL can then be mistaken for baseline state or its address
# bar can miss the event handler entirely.
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
    $script:lastBrowserWindowCount = 0
    $script:lastAddressBarCount = 0
    $script:lastAddressValueCount = 0
    $script:lastExpectedOriginSeen = $false
    $windows = Get-BrowserWindows
    foreach ($window in $windows) {
        try {
            $className = $window.Current.ClassName
            $name = $window.Current.Name
            if ($className -ne "Chrome_WidgetWin_1" -and $name -notmatch "Microsoft Edge|Edge") {
                continue
            }
            $script:lastBrowserWindowCount++

            $addressBar = Find-AddressBar -Window $window
            if ($null -eq $addressBar) {
                continue
            }
            $script:lastAddressBarCount++
            Register-AddressBar -AddressBar $addressBar
            $valuePattern = $addressBar.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            $rawValue = [string]$valuePattern.Current.Value
            if ([string]::IsNullOrWhiteSpace($rawValue)) {
                continue
            }
            $script:lastAddressValueCount++

            $url = $null
            if (-not [Uri]::TryCreate($rawValue, [UriKind]::Absolute, [ref]$url)) {
                continue
            }

            if ($url.Host -in @("login.tzap.org", "sign.tzap.org", "account.tzap.org")) {
                Write-Result -Status "production" -Origin $url.GetLeftPart([UriPartial]::Authority) -Path $url.AbsolutePath -ErrorCode "production_host_observed"
                exit 2
            }
            if ($url.GetLeftPart([UriPartial]::Authority) -eq $ExpectedOrigin) {
                $script:lastExpectedOriginSeen = $true
            }
            if ($baselineUrls.Contains($rawValue)) {
                continue
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

$diagnosticCode = "default_browser_navigation_not_observed;processes=$script:lastBrowserProcessCount;windows=$script:lastBrowserWindowCount;addressBars=$script:lastAddressBarCount;values=$script:lastAddressValueCount;expectedOriginSeen=$script:lastExpectedOriginSeen"
Write-Result -Status "timeout" -ErrorCode $diagnosticCode
exit 1
