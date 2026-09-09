[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("OpenAccount", "SignIn", "Enroll", "OpenDevice", "Retire", "ConfirmRetire", "ConfirmNative", "OpenCertificates", "AssertIdentityPresent", "AssertIdentityAbsent", "AssertSignedIn", "SignOut", "DeleteIdentity", "ConfirmDelete", "AssertSignedOut", "EnsureSignedOut")]
    [string]$Action,
    [int]$TimeoutSeconds = 30
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::RootElement
$buttonCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Button
)
$tabItemCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::TabItem
)
$windowCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Window
)
$deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)

function Find-Button {
    param([string]$Pattern)

    $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $windowCondition)
    foreach ($window in $windows) {
        if ($window.Current.Name -notmatch "ZManager") { continue }
        foreach ($condition in @($buttonCondition, $tabItemCondition)) {
            $controls = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
            foreach ($control in $controls) {
                try {
                    if (-not $control.Current.IsOffscreen -and $control.Current.IsEnabled -and $control.Current.Name -match $Pattern) {
                        return $control
                    }
                } catch {
                    # The WebView2 accessibility tree can change while React renders.
                }
            }
        }
    }
    return $null
}

function Invoke-Button {
    param([string]$Pattern)

    while ([DateTime]::UtcNow -lt $deadline) {
        $button = Find-Button -Pattern $Pattern
        if ($null -ne $button) {
            try {
                $invoke = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
                $invoke.Invoke()
            } catch {
                $selection = $button.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
                $selection.Select()
            }
            return
        }
        Start-Sleep -Milliseconds 250
    }
    throw "Timed out waiting for the installed Account UI button."
}

function Invoke-FirstMatchingButton {
    param([string]$Pattern)
    while ([DateTime]::UtcNow -lt $deadline) {
        $button = Find-Button -Pattern $Pattern
        if ($null -ne $button) {
            try {
                $invoke = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
                $invoke.Invoke()
            } catch {
                $selection = $button.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
                $selection.Select()
            }
            return
        }
        Start-Sleep -Milliseconds 250
    }
    throw "Timed out waiting for the native Account UI confirmation button."
}

function Invoke-NativeConfirmation {
    while ([DateTime]::UtcNow -lt $deadline) {
        $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $windowCondition)
        foreach ($window in $windows) {
            foreach ($condition in @($buttonCondition, $tabItemCondition)) {
                $controls = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
                foreach ($control in $controls) {
                    try {
                        if ($control.Current.IsOffscreen -or -not $control.Current.IsEnabled -or $control.Current.Name -notmatch "^(OK|Yes|Confirm)$") { continue }
                        try {
                            $invoke = $control.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
                            $invoke.Invoke()
                        } catch {
                            $selection = $control.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
                            $selection.Select()
                        }
                        return
                    } catch {
                        # Native confirmation windows may be replaced while the response is invoked.
                    }
                }
            }
        }
        Start-Sleep -Milliseconds 250
    }
    throw "Timed out waiting for the native Account UI confirmation button."
}

function Assert-Button {
    param([string]$Pattern, [string]$FailureMessage)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($null -ne (Find-Button -Pattern $Pattern)) { return }
        Start-Sleep -Milliseconds 250
    }
    throw $FailureMessage
}

function Assert-NoButton {
    param([string]$Pattern, [string]$FailureMessage)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($null -eq (Find-Button -Pattern $Pattern)) { return }
        Start-Sleep -Milliseconds 250
    }
    throw $FailureMessage
}

switch ($Action) {
    "OpenAccount" { Invoke-Button -Pattern "^TZAP Account$" }
    "SignIn" { Invoke-Button -Pattern "^Sign in to (enroll|manage)$" }
    "Enroll" { Invoke-Button -Pattern "^Enroll this device$" }
    "OpenDevice" { Invoke-Button -Pattern "^Device$" }
    "Retire" { Invoke-Button -Pattern "^Retire Hosted Device$" }
    "ConfirmRetire" { Invoke-Button -Pattern "^Confirm Retire$" }
    "ConfirmNative" { Invoke-NativeConfirmation }
    "OpenCertificates" { Invoke-Button -Pattern "^Certificates$" }
    "AssertIdentityPresent" {
        Assert-Button -Pattern "^Delete identity$" -FailureMessage "Installed Account UI did not expose the persisted certificate identity."
    }
    "AssertIdentityAbsent" {
        Assert-NoButton -Pattern "^Delete identity$" -FailureMessage "Installed Account UI still exposes a certificate identity after cleanup."
    }
    "AssertSignedIn" {
        Assert-Button -Pattern "^Sign Out$" -FailureMessage "Installed Account UI did not expose the persisted signed-in state."
    }
    "SignOut" { Invoke-Button -Pattern "^Sign Out$" }
    "DeleteIdentity" { Invoke-Button -Pattern "^Delete identity$" }
    "ConfirmDelete" { Invoke-Button -Pattern "^Confirm Delete$" }
    "AssertSignedOut" {
        Assert-Button -Pattern "^Sign in to (enroll|manage)$" -FailureMessage "Installed Account UI did not expose the signed-out state."
    }
    "EnsureSignedOut" {
        while ([DateTime]::UtcNow -lt $deadline) {
            if ($null -ne (Find-Button -Pattern "^Sign in to (enroll|manage)$")) { return }
            if ($null -ne (Find-Button -Pattern "^Sign Out$")) {
                Invoke-Button -Pattern "^Sign Out$"
            }
            Start-Sleep -Milliseconds 250
        }
        throw "Installed Account UI did not reach the signed-out state."
    }
}

Write-Output "uia-account-action-passed:$Action"
