param(
    [Parameter(Mandatory = $true)]
    [string]$CargoTargetDir,
    [Parameter(Mandatory = $true)]
    [ValidateSet("x64", "arm64")]
    [string]$Architecture,
    [Parameter(Mandatory = $true)]
    [string]$PackageName,
    [Parameter(Mandatory = $true)]
    [string]$Publisher,
    [Parameter(Mandatory = $true)]
    [string]$PublisherDisplayName,
    [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot "windows-package-artifact.ps1")

if ($PackageName -notmatch '^[A-Za-z0-9.-]{3,50}$') {
    throw "PackageName must be the reserved Microsoft Store package identity name (3-50 letters, digits, dots, or hyphens)."
}
if ($Publisher -notmatch '^CN=') {
    throw "Publisher must be the exact Publisher value shown in Partner Center (for example, CN=...)."
}

$tauriConfig = Get-Content (Join-Path $repoRoot "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
$version = [Version]::Parse($tauriConfig.version)
if ($version.Revision -lt 0) {
    $packageVersion = "{0}.{1}.{2}.0" -f $version.Major, $version.Minor, $version.Build
} else {
    $packageVersion = $version.ToString(4)
}
if ($version.Major -gt 65535 -or $version.Minor -gt 65535 -or $version.Build -gt 65535) {
    throw "The app version cannot be represented as a Windows package version: $($tauriConfig.version)"
}

$releaseDirectory = Get-ZManagerWindowsReleaseDirectory -CargoTargetDir $CargoTargetDir -Architecture $Architecture
$executable = Join-Path $releaseDirectory "zmanager-desktop.exe"
$shellExtension = Join-Path $repoRoot "target\windows-shell-extension\zmanager-shell-extension.dll"
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw "Release executable not found: $executable"
}
if (-not (Test-Path -LiteralPath $shellExtension -PathType Leaf)) {
    throw "Windows shell extension not found: $shellExtension. Build the Windows release first."
}

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $repoRoot "target\msix\$Architecture"
}
$stage = Join-Path $OutputDirectory "package"
if (Test-Path -LiteralPath $stage) {
    Remove-Item -LiteralPath $stage -Recurse -Force
}
New-Item -ItemType Directory -Force -Path (Join-Path $stage "Assets") | Out-Null
Copy-Item -LiteralPath $executable -Destination $stage
Copy-Item -LiteralPath $shellExtension -Destination $stage

Add-Type -AssemblyName System.Drawing
$sourceIcon = [System.Drawing.Image]::FromFile((Join-Path $repoRoot "src-tauri\icons\icon.png"))
try {
    foreach ($asset in @(@{ Name = "Square44x44Logo.png"; Size = 44 }, @{ Name = "Square150x150Logo.png"; Size = 150 }, @{ Name = "StoreLogo.png"; Size = 50 })) {
        $bitmap = [System.Drawing.Bitmap]::new($asset.Size, $asset.Size)
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            try {
                $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $graphics.DrawImage($sourceIcon, 0, 0, $asset.Size, $asset.Size)
                $bitmap.Save((Join-Path $stage "Assets\$($asset.Name)"), [System.Drawing.Imaging.ImageFormat]::Png)
            } finally {
                $graphics.Dispose()
            }
        } finally {
            $bitmap.Dispose()
        }
    }
} finally {
    $sourceIcon.Dispose()
}

function ConvertTo-XmlValue([string]$Value) {
    return [System.Security.SecurityElement]::Escape($Value)
}

$archiveTypes = Get-Content (Join-Path $repoRoot "manifests\archive-file-types.json") -Raw | ConvertFrom-Json
$fileTypeExtensions = @($archiveTypes.associationTypes | Where-Object { $_.windows } | ForEach-Object { $_.primaryExtensions } | Sort-Object -Unique)
$fileTypeEntries = ($fileTypeExtensions | ForEach-Object {
    $extension = ".$_"
    "              <uap:FileType>$extension</uap:FileType>"
}) -join "`n"

$escapedName = ConvertTo-XmlValue $PackageName
$escapedPublisher = ConvertTo-XmlValue $Publisher
$escapedPublisherDisplayName = ConvertTo-XmlValue $PublisherDisplayName
$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
         xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
         xmlns:uap10="http://schemas.microsoft.com/appx/manifest/uap/windows10/10"
         xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
         xmlns:com="http://schemas.microsoft.com/appx/manifest/com/windows10"
         xmlns:desktop4="http://schemas.microsoft.com/appx/manifest/desktop/windows10/4"
         xmlns:desktop5="http://schemas.microsoft.com/appx/manifest/desktop/windows10/5"
         IgnorableNamespaces="uap uap10 rescap com desktop4 desktop5">
  <Identity Name="$escapedName" Publisher="$escapedPublisher" Version="$packageVersion" ProcessorArchitecture="$Architecture" />
  <Properties>
    <DisplayName>ZManager</DisplayName>
    <PublisherDisplayName>$escapedPublisherDisplayName</PublisherDisplayName>
    <Logo>Assets\StoreLogo.png</Logo>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Resources><Resource Language="en-us" /></Resources>
  <Applications>
    <Application Id="ZManager" Executable="zmanager-desktop.exe" uap10:RuntimeBehavior="packagedClassicApp" uap10:TrustLevel="mediumIL">
      <uap:VisualElements DisplayName="ZManager" Description="Safe archive manager" Square150x150Logo="Assets\Square150x150Logo.png" Square44x44Logo="Assets\Square44x44Logo.png" BackgroundColor="transparent" />
      <Extensions>
        <com:Extension Category="windows.comServer">
          <com:ComServer>
            <com:SurrogateServer DisplayName="ZManager File Explorer commands">
              <com:Class Id="5AF01874-4485-4FCF-B31A-37918614B6C5" Path="zmanager-shell-extension.dll" ThreadingModel="STA" />
            </com:SurrogateServer>
          </com:ComServer>
        </com:Extension>
        <desktop4:Extension Category="windows.fileExplorerContextMenus">
          <desktop4:FileExplorerContextMenus>
            <desktop5:ItemType Type="*"><desktop5:Verb Id="ZManagerFiles" Clsid="5AF01874-4485-4FCF-B31A-37918614B6C5" /></desktop5:ItemType>
            <desktop5:ItemType Type="Directory"><desktop5:Verb Id="ZManagerFolders" Clsid="5AF01874-4485-4FCF-B31A-37918614B6C5" /></desktop5:ItemType>
            <desktop5:ItemType Type="Directory\Background"><desktop5:Verb Id="ZManagerFolderBackground" Clsid="5AF01874-4485-4FCF-B31A-37918614B6C5" /></desktop5:ItemType>
          </desktop4:FileExplorerContextMenus>
        </desktop4:Extension>
        <uap:Extension Category="windows.fileTypeAssociation">
          <uap:FileTypeAssociation Name="zmanager-archives">
            <uap:DisplayName>ZManager archives</uap:DisplayName>
            <uap:Logo>Assets\Square44x44Logo.png</uap:Logo>
            <uap:SupportedFileTypes>
$fileTypeEntries
            </uap:SupportedFileTypes>
          </uap:FileTypeAssociation>
        </uap:Extension>
        <uap:Extension Category="windows.protocol">
          <uap:Protocol Name="zmanager"><uap:DisplayName>ZManager link</uap:DisplayName></uap:Protocol>
        </uap:Extension>
        <uap:Extension Category="windows.protocol">
          <uap:Protocol Name="tzap"><uap:DisplayName>TZAP link</uap:DisplayName></uap:Protocol>
        </uap:Extension>
      </Extensions>
    </Application>
  </Applications>
  <Capabilities><rescap:Capability Name="runFullTrust" /></Capabilities>
</Package>
"@
$manifestPath = Join-Path $stage "AppxManifest.xml"
Set-Content -LiteralPath $manifestPath -Value $manifest -Encoding UTF8
[xml]$null = Get-Content -LiteralPath $manifestPath -Raw

$makeAppx = Get-ChildItem -Path "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\makeappx.exe" -ErrorAction SilentlyContinue |
    Sort-Object { [Version]($_.Directory.Parent.Name) } -Descending |
    Select-Object -First 1
if (-not $makeAppx) {
    throw "MakeAppx.exe was not found in the Windows SDK. Install the Windows 10/11 SDK and retry."
}

$packagePath = Join-Path $OutputDirectory "zmanager-desktop-$($tauriConfig.version)-windows-$Architecture.msix"
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
& $makeAppx.FullName pack /d $stage /p $packagePath /o
if ($LASTEXITCODE -ne 0) {
    throw "MakeAppx failed with exit code $LASTEXITCODE."
}
Write-Host "Created unsigned Store submission package: $packagePath"
