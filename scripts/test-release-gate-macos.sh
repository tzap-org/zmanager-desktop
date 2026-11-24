#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 2 ]]; then
  echo "usage: $0 APPLICATION_BUNDLE arm64|x86_64" >&2
  exit 2
fi
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_app=$1
architecture=$2
case "$architecture" in arm64) other_arch=x86_64 ;; x86_64) other_arch=arm64 ;; *) echo "invalid architecture" >&2; exit 2 ;; esac
work=$(mktemp -d "${TMPDIR:-/tmp}/zmanager-release-gate-negative.XXXXXX")
trap 'rm -rf "$work"' EXIT

expect_failure() {
  local label=$1 expected=$2 app=$3; shift 3
  local output
  if output=$("$repo_root/scripts/release-gate-macos.sh" "$app" "$@" 2>&1); then
    echo "negative release-gate case unexpectedly passed: $label" >&2
    exit 1
  fi
  grep -Fqi "$expected" <<<"$output" || {
    echo "negative release-gate case '$label' missed expected diagnostic '$expected'" >&2
    echo "$output" >&2
    exit 1
  }
  echo "PASS negative case: $label"
}
copy_case() { ditto "$source_app" "$work/$1.app"; printf '%s' "$work/$1.app"; }
resign_app() { codesign --force --sign - "$1" >/dev/null; }

expect_failure "missing architecture slice" "missing slice" "$source_app" --expected-arch "$other_arch"

case_app=$(copy_case identifier)
/usr/libexec/PlistBuddy -c 'Set :CFBundleIdentifier com.example.invalid' "$case_app/Contents/Info.plist"
resign_app "$case_app"
expect_failure "identifier mismatch" "identifier/version mismatch" "$case_app" --expected-arch "$architecture"

case_app=$(copy_case version)
/usr/libexec/PlistBuddy -c 'Set :CFBundleShortVersionString 999.0.0' "$case_app/Contents/Info.plist"
resign_app "$case_app"
expect_failure "version mismatch" "version mismatch" "$case_app" --expected-arch "$architecture"

case_app=$(copy_case app-data-usage)
/usr/libexec/PlistBuddy -c 'Delete :NSAppDataUsageDescription' "$case_app/Contents/Info.plist" 2>/dev/null || true
resign_app "$case_app"
expect_failure "missing app-data usage description" "NSAppDataUsageDescription" "$case_app" --expected-arch "$architecture"

case_app=$(copy_case finder-app-data-usage)
/usr/libexec/PlistBuddy -c 'Delete :NSAppDataUsageDescription' \
  "$case_app/Contents/PlugIns/ZManagerFinderExtension.appex/Contents/Info.plist" 2>/dev/null || true
codesign --force --sign - \
  "$case_app/Contents/PlugIns/ZManagerFinderExtension.appex" >/dev/null
resign_app "$case_app"
expect_failure "missing Finder app-data usage description" "Finder extension NSAppDataUsageDescription" \
  "$case_app" --expected-arch "$architecture"

case_app=$(copy_case unsigned)
codesign --remove-signature "$case_app/Contents/PlugIns/ZManagerFinderExtension.appex/Contents/MacOS/ZManagerFinderExtension"
expect_failure "unsigned nested executable" "unsigned" "$case_app" --expected-arch "$architecture"

case_app=$(copy_case unexpected)
ditto "$case_app/Contents/MacOS/zmanager-desktop" "$case_app/Contents/MacOS/unexpected-helper"
codesign --force --sign - "$case_app/Contents/MacOS/unexpected-helper" >/dev/null
resign_app "$case_app"
expect_failure "unexpected executable" "unexpected executable" "$case_app" --expected-arch "$architecture"

case_app=$(copy_case unexpected-script)
touch "$case_app/Contents/Resources/unexpected-script"
chmod 0755 "$case_app/Contents/Resources/unexpected-script"
resign_app "$case_app"
expect_failure "unexpected non-Mach-O executable" "unexpected executable file" "$case_app" --expected-arch "$architecture"

case_app=$(copy_case entitlements)
bad_entitlements="$work/bad-entitlements.plist"
plutil -create xml1 "$bad_entitlements"
/usr/libexec/PlistBuddy -c 'Add :com.apple.security.app-sandbox bool false' "$bad_entitlements"
codesign --force --sign - --entitlements "$bad_entitlements" \
  "$case_app/Contents/PlugIns/ZManagerFinderExtension.appex" >/dev/null
resign_app "$case_app"
expect_failure "invalid entitlement" "invalid entitlement" "$case_app" --expected-arch "$architecture"

case_app=$(copy_case rpath)
install_name_tool -add_rpath /tmp/zmanager-invalid-rpath "$case_app/Contents/MacOS/zmanager-desktop"
codesign --force --sign - "$case_app/Contents/MacOS/zmanager-desktop" >/dev/null
resign_app "$case_app"
expect_failure "bad rpath" "bad rpath" "$case_app" --expected-arch "$architecture"

notary_output=$work/notary-output.txt
if "$repo_root/scripts/release-gate-macos.sh" "$source_app" --expected-arch "$architecture" \
  --require-developer-id --require-notarization >"$notary_output" 2>&1; then
  echo "ad-hoc bundle unexpectedly passed protected release checks" >&2
  exit 1
fi
grep -Fqi "failed notarization" "$notary_output"
grep -Fqi "missing staple" "$notary_output"
echo "PASS negative cases: failed notarization and missing staple"
echo "all macOS release-gate negative tests passed"
