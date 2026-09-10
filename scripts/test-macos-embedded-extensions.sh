#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 1 ]]; then
  echo "usage: $0 APPLICATION_BUNDLE" >&2
  exit 2
fi

app=$1
[[ -d "$app" && -f "$app/Contents/Info.plist" ]] || {
  echo "invalid application bundle: $app" >&2
  exit 1
}

plist_value() {
  /usr/libexec/PlistBuddy -c "Print :$2" "$1/Contents/Info.plist"
}

assert_bundle_id() {
  local bundle=$1 expected=$2 actual
  [[ -f "$bundle/Contents/Info.plist" ]] || {
    echo "missing embedded bundle: $bundle" >&2
    exit 1
  }
  actual=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$bundle/Contents/Info.plist")
  [[ $actual == "$expected" ]] || {
    echo "unexpected bundle identifier $actual at $bundle (expected $expected)" >&2
    exit 1
  }
}

[[ $(plist_value "$app" CFBundleIdentifier) == org.tzap-org.zmanager ]] || {
  echo "unexpected ZManager application identifier" >&2
  exit 1
}

assert_bundle_id "$app/Contents/PlugIns/ZManagerFinderExtension.appex" org.tzap-org.zmanager.finder-extension
assert_bundle_id "$app/Contents/PlugIns/ZManagerQuickLookPreview.appex" org.tzap-org.zmanager.quicklook-preview
assert_bundle_id "$app/Contents/PlugIns/ZManagerQuickLookThumbnail.appex" org.tzap-org.zmanager.quicklook-thumbnail
assert_bundle_id "$app/Contents/Library/Spotlight/ZManagerSpotlight.mdimporter" org.tzap-org.zmanager.spotlight-importer

codesign --verify --deep --strict "$app"
echo "macOS embedded extension bundle contract passed: $app"
