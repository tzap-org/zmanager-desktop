[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing

$root = [System.Windows.Automation.AutomationElement]::RootElement
$windowCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Window
)
$window = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $windowCondition) |
    Where-Object { $_.Current.Name -match "ZManager" } |
    Select-Object -First 1
if ($null -eq $window) { exit 1 }

$rect = $window.Current.BoundingRectangle
$left = [Math]::Max(0, [int]$rect.Left)
$top = [Math]::Max(0, [int]$rect.Top)
$width = [int][Math]::Max(1, $rect.Width)
$height = [int][Math]::Max(1, $rect.Height)
$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
    $graphics.CopyFromScreen($left, $top, 0, 0, $bitmap.Size)
    $parent = Split-Path -Parent $OutputPath
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
    $graphics.Dispose()
    $bitmap.Dispose()
}
