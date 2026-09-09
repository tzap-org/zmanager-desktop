#!/usr/bin/env bash
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
app=""
expected_arch="$(uname -m)"
require_developer_id=0
require_provisioned_app_group=0
require_notarization=0
report=""
dmg=""
zip=""

usage() {
  cat <<'EOF'
Usage: scripts/release-gate-macos.sh APPLICATION [options]

Options:
  --expected-arch arm64|x86_64  Require an exact, thin architecture slice.
  --require-developer-id        Require the frozen Developer ID team and hardened runtime.
  --require-provisioned-app-group
                                Require valid main/Finder profiles and authorized App Group entitlements.
  --require-notarization        Require Gatekeeper acceptance and a stapled ticket.
  --report PATH                 Write a machine-readable JSON inspection report.
  --dmg PATH                    Inspect the matching DMG signature and ticket.
  --zip PATH                    Inspect the matching ZIP application payload.
EOF
}

[[ $# -gt 0 ]] || { usage >&2; exit 2; }
app=$1
shift
while (($#)); do
  case "$1" in
    --expected-arch) [[ $# -ge 2 ]] || { echo "--expected-arch requires a value" >&2; exit 2; }; expected_arch=$2; shift ;;
    --require-developer-id) require_developer_id=1 ;;
    --require-provisioned-app-group) require_provisioned_app_group=1 ;;
    --require-notarization) require_notarization=1 ;;
    --report) [[ $# -ge 2 ]] || { echo "--report requires a path" >&2; exit 2; }; report=$2; shift ;;
    --dmg) [[ $# -ge 2 ]] || { echo "--dmg requires a path" >&2; exit 2; }; dmg=$2; shift ;;
    --zip) [[ $# -ge 2 ]] || { echo "--zip requires a path" >&2; exit 2; }; zip=$2; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done
case "$expected_arch" in arm64|x86_64) ;; *) echo "Unsupported architecture: $expected_arch" >&2; exit 2 ;; esac
((require_notarization == 0 || require_developer_id == 1)) || {
  echo "--require-notarization also requires --require-developer-id" >&2
  exit 2
}

failures=()
failure_count=0
checks=0
pass() { checks=$((checks + 1)); }
fail() {
  checks=$((checks + 1))
  failures[$failure_count]=$1
  failure_count=$((failure_count + 1))
  echo "FAIL: $1" >&2
}
check() { local message=$1; shift; if "$@" >/dev/null 2>&1; then pass; else fail "$message"; fi; }

if [[ ! -d "$app" || ${app##*.} != app || ! -f "$app/Contents/Info.plist" ]]; then
  echo "FAIL: application bundle is missing or invalid: $app" >&2
  exit 1
fi

version=$(node -p 'require(process.argv[1]).version' "$repo_root/package.json")
build=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$app/Contents/Info.plist" 2>/dev/null || true)
[[ $build =~ ^[1-9][0-9]*$ ]] && pass || fail "version mismatch: CFBundleVersion must be a positive integer"

metadata_error=$(/usr/bin/python3 - "$app/Contents/Info.plist" "$repo_root/packaging/macos/main-info.generated.json" "$version" <<'PY'
import json, plistlib, sys

with open(sys.argv[1], "rb") as source:
    info = plistlib.load(source)
with open(sys.argv[2], encoding="utf-8") as source:
    generated = json.load(source)
expected = {
    "CFBundleIdentifier": "org.tzap-org.zmanager",
    "CFBundleName": "ZManager",
    "CFBundleShortVersionString": sys.argv[3],
    "LSMinimumSystemVersion": "14.0",
}
errors = [f"{key}={info.get(key)!r}, expected {value!r}" for key, value in expected.items() if info.get(key) != value]
if not str(info.get("NSAppDataUsageDescription", "")).strip():
    errors.append("NSAppDataUsageDescription is missing")
if info.get("CFBundleURLTypes") != [{
    "CFBundleTypeRole": "Viewer",
    "CFBundleURLName": "org.tzap-org.zmanager.shell-request",
    "CFBundleURLSchemes": ["zmanager", "tzap"],
}]:
    errors.append("URL scheme declarations differ from the canonical identity")
expected_documents = [{
    "CFBundleTypeName": group["displayKey"],
    "CFBundleTypeExtensions": group["extensions"],
    "CFBundleTypeRole": group["role"],
    "LSHandlerRank": group["rank"],
    **({"LSItemContentTypes": ["org.tzap-org.zmanager.tzap"]} if group["id"] == "tzap" else {}),
} for group in generated["documentGroups"]]
if info.get("CFBundleDocumentTypes") != expected_documents:
    errors.append("document type declarations differ from the generated manifest")
expected_exported = [{
    "UTTypeIdentifier": item["identifier"],
    "UTTypeDescription": item["descriptionKey"],
    "UTTypeConformsTo": item["conformsTo"],
    "UTTypeTagSpecification": {
        "public.filename-extension": item["extensions"],
        "public.mime-type": item["mimeTypes"],
    },
} for item in generated["exportedTypes"]]
if info.get("UTExportedTypeDeclarations") != expected_exported:
    errors.append("exported UTI declarations differ from the generated manifest")
expected_services = [{
    "NSMenuItem": {"default": service["title"]},
    "NSMessage": "performZManagerService",
    "NSPortName": "ZManager",
    "NSSendTypes": ["NSFilenamesPboardType"],
    "NSUserData": service["id"],
} for service in sorted(generated["services"], key=lambda item: item["order"])]
if info.get("NSServices") != expected_services:
    errors.append("Services declarations differ from the generated manifest")
print("; ".join(errors))
PY
)
[[ -z $metadata_error ]] && pass || fail "identifier/version mismatch or generated metadata mismatch: $metadata_error"
for locale in en zh-Hans; do
  for resource in InfoPlist.strings ServicesMenu.strings; do
    expected_resource="$repo_root/packaging/macos/Main/$locale.lproj/$resource"
    packaged_resource="$app/Contents/Resources/$locale.lproj/$resource"
    check "missing or stale main localization: $locale.lproj/$resource" cmp -s "$expected_resource" "$packaged_resource"
  done
done
for locale in en zh-Hans; do
  for resource in FinderActions.strings InfoPlist.strings; do
    expected_resource="$repo_root/packaging/macos/FinderExtension/$locale.lproj/$resource"
    packaged_resource="$app/Contents/PlugIns/ZManagerFinderExtension.appex/Contents/Resources/$locale.lproj/$resource"
    check "missing or stale Finder localization: $locale.lproj/$resource" \
      cmp -s "$expected_resource" "$packaged_resource"
  done
done

bundle_paths=(
  "Contents/PlugIns/ZManagerFinderExtension.appex"
  "Contents/PlugIns/ZManagerQuickLookPreview.appex"
  "Contents/PlugIns/ZManagerQuickLookThumbnail.appex"
  "Contents/Library/Spotlight/ZManagerSpotlight.mdimporter"
)
bundle_identifiers=(
  "org.tzap-org.zmanager.finder-extension"
  "org.tzap-org.zmanager.quicklook-preview"
  "org.tzap-org.zmanager.quicklook-thumbnail"
  "org.tzap-org.zmanager.spotlight-importer"
)
for index in "${!bundle_paths[@]}"; do
  relative=${bundle_paths[$index]}
  nested="$app/$relative"
  if [[ ! -f "$nested/Contents/Info.plist" ]]; then fail "missing nested bundle: $relative"; continue; fi
  actual_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$nested/Contents/Info.plist" 2>/dev/null || true)
  nested_version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$nested/Contents/Info.plist" 2>/dev/null || true)
  nested_build=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$nested/Contents/Info.plist" 2>/dev/null || true)
  nested_min=$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$nested/Contents/Info.plist" 2>/dev/null || true)
  [[ $actual_id == "${bundle_identifiers[$index]}" ]] && pass || fail "identifier mismatch for $relative: $actual_id"
  [[ $nested_version == "$version" && $nested_build == "$build" && $nested_min == 14.0 ]] && pass || \
    fail "version mismatch for $relative (version=$nested_version build=$nested_build minimum=$nested_min)"
  if [[ $relative == "Contents/PlugIns/ZManagerFinderExtension.appex" ]]; then
    app_data_usage=$(/usr/libexec/PlistBuddy -c 'Print :NSAppDataUsageDescription' "$nested/Contents/Info.plist" 2>/dev/null || true)
    [[ -n $app_data_usage ]] && pass || fail "Finder extension NSAppDataUsageDescription is missing"
  fi
done

main_executable=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Contents/Info.plist" 2>/dev/null || true)
expected_macho=(
  "Contents/MacOS/$main_executable"
  "Contents/PlugIns/ZManagerFinderExtension.appex/Contents/MacOS/ZManagerFinderExtension"
  "Contents/PlugIns/ZManagerQuickLookPreview.appex/Contents/MacOS/ZManagerQuickLookPreview"
  "Contents/PlugIns/ZManagerQuickLookThumbnail.appex/Contents/MacOS/ZManagerQuickLookThumbnail"
  "Contents/Library/Spotlight/ZManagerSpotlight.mdimporter/Contents/MacOS/ZManagerSpotlight"
)
actual_macho=()
actual_executable=()
while IFS= read -r -d '' candidate; do
  if file -b "$candidate" | grep -q 'Mach-O'; then actual_macho+=("${candidate#"$app/"}"); fi
done < <(find "$app/Contents" -type f -print0)
while IFS= read -r -d '' candidate; do
  actual_executable+=("${candidate#"$app/"}")
done < <(find "$app/Contents" -type f -perm -0111 -print0)
for relative in "${expected_macho[@]}"; do
  executable="$app/$relative"
  if [[ ! -f "$executable" ]]; then fail "missing expected executable: $relative"; continue; fi
  arches=$(lipo -archs "$executable" 2>/dev/null || true)
  [[ $arches == "$expected_arch" ]] && pass || fail "missing slice or unexpected architecture for $relative: '$arches', expected '$expected_arch'"
done
for relative in "${actual_macho[@]}"; do
  expected=0
  for expected_relative in "${expected_macho[@]}"; do
    [[ $relative != "$expected_relative" ]] || expected=1
  done
  ((expected == 1)) && pass || fail "unexpected executable in bundle: $relative"
done
for relative in "${actual_executable[@]}"; do
  expected=0
  for expected_relative in "${expected_macho[@]}"; do
    [[ $relative != "$expected_relative" ]] || expected=1
  done
  ((expected == 1)) && pass || fail "unexpected executable file in bundle: $relative"
done

check "unsigned or tampered nested executable" codesign --verify --deep --strict "$app"
for relative in "${expected_macho[@]}"; do
  check "unsigned executable: $relative" codesign --verify --strict "$app/$relative"
done
for relative in "${bundle_paths[@]}"; do
  check "unsigned nested bundle: $relative" codesign --verify --strict "$app/$relative"
done

entitlements_dir=$(mktemp -d "${TMPDIR:-/tmp}/zmanager-entitlements.XXXXXX")
trap 'rm -rf "$entitlements_dir"' EXIT
entitlement_error=$(/usr/bin/python3 - "$app" "$require_developer_id" "$require_provisioned_app_group" <<'PY'
import plistlib, subprocess, sys
from pathlib import Path

app = Path(sys.argv[1])
require_developer_id = sys.argv[2] == "1"
require_provisioned_app_group = sys.argv[3] == "1"
targets = {
    ".": {"com.apple.security.application-groups": ["group.org.tzap-org.zmanager"]},
    "Contents/PlugIns/ZManagerFinderExtension.appex": {
        "com.apple.security.app-sandbox": True,
        "com.apple.security.application-groups": ["group.org.tzap-org.zmanager"],
        "com.apple.security.files.user-selected.read-only": True,
    },
    "Contents/PlugIns/ZManagerQuickLookPreview.appex": {
        "com.apple.security.app-sandbox": True,
        "com.apple.security.files.user-selected.read-only": True,
    },
    "Contents/PlugIns/ZManagerQuickLookThumbnail.appex": {
        "com.apple.security.app-sandbox": True,
        "com.apple.security.files.user-selected.read-only": True,
    },
    "Contents/Library/Spotlight/ZManagerSpotlight.mdimporter": {},
}
errors = []
for relative, expected in targets.items():
    result = subprocess.run(["codesign", "-d", "--entitlements", ":-", str(app / relative)], capture_output=True)
    data = result.stdout.strip()
    actual = plistlib.loads(data) if data else {}
    if (require_developer_id or require_provisioned_app_group) and relative in {
        ".", "Contents/PlugIns/ZManagerFinderExtension.appex"
    }:
        bundle_id = "org.tzap-org.zmanager" if relative == "." else "org.tzap-org.zmanager.finder-extension"
        expected = {**expected,
            "com.apple.application-identifier": "9PMA523YY4." + bundle_id,
            "com.apple.developer.team-identifier": "9PMA523YY4",
        }
        if require_provisioned_app_group and not require_developer_id:
            expected["com.apple.security.get-task-allow"] = True
    if actual != expected:
        errors.append(f"{relative}: {actual!r}, expected {expected!r}")
print("; ".join(errors))
PY
)
[[ -z $entitlement_error ]] && pass || fail "invalid entitlement: $entitlement_error"

for relative in "${expected_macho[@]}"; do
  executable="$app/$relative"
  [[ -f $executable ]] || continue
  linkage=$(otool -L "$executable" 2>/dev/null || true)
  if grep -Eq '[[:space:]]+/(opt/homebrew|usr/local|Users|private/tmp|tmp)/' <<<"$linkage"; then
    fail "bad rpath or build-machine dependency in $relative"
  else
    pass
  fi
  rpaths=$(otool -l "$executable" 2>/dev/null | awk '$1 == "cmd" && $2 == "LC_RPATH" {want=1; next} want && $1 == "path" {print $2; want=0}')
  bad_rpath=0
  while IFS= read -r path; do
    [[ -z $path || $path == @* || $path == /usr/lib/swift ]] || bad_rpath=1
  done <<<"$rpaths"
  ((bad_rpath == 0)) && pass || fail "bad rpath in $relative: $rpaths"
done

# Verify UniFFI symbols in targets that use them (preview and spotlight; thumbnail renders only the app icon)
for executable in \
  "$app/Contents/PlugIns/ZManagerQuickLookPreview.appex/Contents/MacOS/ZManagerQuickLookPreview" \
  "$app/Contents/Library/Spotlight/ZManagerSpotlight.mdimporter/Contents/MacOS/ZManagerSpotlight"; do
  for symbol in _ffi_zmanager_ffi_rustbuffer_alloc _ffi_zmanager_ffi_rustbuffer_free _uniffi_zmanager_ffi_fn_func_tzappublicmetadatadisplaysummary; do
    nm -m "$executable" 2>/dev/null | awk -v symbol="$symbol" '$NF == symbol { found = 1 } END { exit !found }' && pass || fail "missing UniFFI symbol $symbol in ${executable#"$app/"}"
  done
done
preview="$app/Contents/PlugIns/ZManagerQuickLookPreview.appex/Contents/MacOS/ZManagerQuickLookPreview"
otool -ov "$preview" 2>/dev/null | grep -F 'providePreviewForFileRequest:completionHandler:' >/dev/null && pass || \
  fail "Quick Look packaged selector is missing"

if [[ -n $dmg ]]; then
  if [[ ! -f $dmg ]]; then
    fail "matching DMG is missing: $dmg"
  else
    mountpoint="$entitlements_dir/dmg"
    mkdir -p "$mountpoint"
    if hdiutil attach -readonly -nobrowse -mountpoint "$mountpoint" "$dmg" >/dev/null 2>&1; then
      mounted_app="$mountpoint/ZManager.app"
      source_hash=$(codesign -d --verbose=4 "$app" 2>&1 | awk -F= '$1 == "CDHash" {print $2; exit}')
      mounted_hash=$(codesign -d --verbose=4 "$mounted_app" 2>&1 | awk -F= '$1 == "CDHash" {print $2; exit}')
      [[ -n $source_hash && $source_hash == "$mounted_hash" ]] && pass || \
        fail "DMG does not contain the inspected application build"
      check "DMG application is unsigned or tampered" codesign --verify --deep --strict "$mounted_app"
      hdiutil detach "$mountpoint" >/dev/null 2>&1 || fail "unable to detach inspected DMG"
    else
      fail "DMG cannot be mounted for inspection: $dmg"
    fi
  fi
fi
if [[ -n $zip ]]; then
  if [[ ! -f $zip ]]; then
    fail "matching ZIP is missing: $zip"
  else
    zip_root="$entitlements_dir/zip"
    mkdir -p "$zip_root"
    if ditto -x -k "$zip" "$zip_root" >/dev/null 2>&1; then
      zipped_app="$zip_root/$(basename "$app")"
      source_hash=$(codesign -d --verbose=4 "$app" 2>&1 | awk -F= '$1 == "CDHash" {print $2; exit}')
      zipped_hash=$(codesign -d --verbose=4 "$zipped_app" 2>&1 | awk -F= '$1 == "CDHash" {print $2; exit}')
      [[ -n $source_hash && $source_hash == "$zipped_hash" ]] && pass || \
        fail "ZIP does not contain the inspected application build"
      check "ZIP application is unsigned or tampered" codesign --verify --deep --strict "$zipped_app"
    else
      fail "ZIP cannot be extracted for inspection: $zip"
    fi
  fi
fi

if ((require_developer_id || require_provisioned_app_group)); then
  profile_error=$(/usr/bin/python3 - "$app" "$entitlements_dir" <<'PY'
import datetime, plistlib, subprocess, sys
from pathlib import Path

app = Path(sys.argv[1])
profiles = {
    "Contents/embedded.provisionprofile": "org.tzap-org.zmanager",
    "Contents/PlugIns/ZManagerFinderExtension.appex/Contents/embedded.provisionprofile": "org.tzap-org.zmanager.finder-extension",
}
errors = []
now = datetime.datetime.now(datetime.timezone.utc)
for relative, bundle_id in profiles.items():
    path = app / relative
    if not path.is_file():
        errors.append(f"missing {relative}")
        continue
    result = subprocess.run(["security", "cms", "-D", "-i", str(path)], capture_output=True)
    try:
        profile = plistlib.loads(result.stdout)
    except Exception:
        errors.append(f"invalid {relative}")
        continue
    expiration = profile.get("ExpirationDate")
    if expiration is None or expiration.replace(tzinfo=datetime.timezone.utc) <= now:
        errors.append(f"expired {relative}")
    if "9PMA523YY4" not in profile.get("TeamIdentifier", []):
        errors.append(f"TeamIdentifier mismatch in {relative}")
    entitlements = profile.get("Entitlements", {})
    application_identifier = (
        entitlements.get("com.apple.application-identifier")
        or entitlements.get("application-identifier")
    )
    if application_identifier != "9PMA523YY4." + bundle_id:
        errors.append(f"application identifier mismatch in {relative}")
    if "group.org.tzap-org.zmanager" not in entitlements.get("com.apple.security.application-groups", []):
        errors.append(f"App Group mismatch in {relative}")
print("; ".join(errors))
PY
)
  [[ -z $profile_error ]] && pass || fail "invalid App Group provisioning profile: $profile_error"
fi

if ((require_developer_id)); then
  developer_id_targets=("$app")
  for relative in "${expected_macho[@]}"; do developer_id_targets+=("$app/$relative"); done
  for target in "${developer_id_targets[@]}"; do
    details=$(codesign -d --verbose=4 "$target" 2>&1 || true)
    grep -q '^Authority=Developer ID Application:' <<<"$details" || fail "Developer ID signature missing: ${target#"$app/"}"
    grep -q '^TeamIdentifier=9PMA523YY4$' <<<"$details" || fail "Developer ID TeamIdentifier mismatch: ${target#"$app/"}"
    grep -Eq 'flags=.*runtime' <<<"$details" || fail "hardened runtime missing: ${target#"$app/"}"
    grep -q '^Timestamp=' <<<"$details" || fail "secure timestamp missing: ${target#"$app/"}"
    requirement=$(codesign -d -r- "$target" 2>&1 || true)
    grep -q 'designated => ' <<<"$requirement" && grep -q 'anchor apple generic' <<<"$requirement" || \
      fail "Developer ID designated requirement mismatch: ${target#"$app/"}"
    pass
  done
fi

if ((require_notarization)); then
  check "failed notarization or Gatekeeper assessment" spctl --assess --type execute --verbose=4 "$app"
  check "missing staple on application" xcrun stapler validate "$app"
  if [[ -n $dmg ]]; then
    check "unsigned or tampered DMG" codesign --verify --verbose=2 "$dmg"
    check "failed DMG notarization or Gatekeeper assessment" spctl --assess --type open --context context:primary-signature --verbose=4 "$dmg"
    check "missing staple on DMG" xcrun stapler validate "$dmg"
  fi
fi

status=passed
((failure_count == 0)) || status=failed
if [[ -n $report ]]; then
  mkdir -p "$(dirname "$report")"
  failures_file="$entitlements_dir/failures.txt"
  if ((failure_count)); then printf '%s\n' "${failures[@]}" > "$failures_file"; else : > "$failures_file"; fi
  /usr/bin/python3 - "$report" "$status" "$app" "$expected_arch" "$version" "$build" "$checks" "$failures_file" <<'PY'
import datetime, json, sys
failures = [line.rstrip("\n") for line in open(sys.argv[8], encoding="utf-8") if line.rstrip("\n")]
report = {
    "schemaVersion": 1,
    "status": sys.argv[2],
    "inspectedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "application": sys.argv[3],
    "architecture": sys.argv[4],
    "version": sys.argv[5],
    "buildNumber": sys.argv[6],
    "checksRun": int(sys.argv[7]),
    "failures": failures,
}
with open(sys.argv[1], "w", encoding="utf-8") as destination:
    json.dump(report, destination, indent=2)
    destination.write("\n")
PY
fi

if [[ $status == failed ]]; then
  echo "macOS release gate failed with $failure_count issue(s) across $checks checks." >&2
  exit 1
fi
echo "macOS release gate passed $checks checks: $app ($expected_arch, version $version, build $build)"
