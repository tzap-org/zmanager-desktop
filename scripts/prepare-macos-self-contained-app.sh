#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "usage: $0 APPLICATION_BUNDLE [arm64|x86_64]" >&2
  exit 2
fi

app=$1
architecture=${2:-$(uname -m)}
case "$architecture" in arm64|x86_64) ;; *) echo "unsupported macOS architecture: $architecture" >&2; exit 2 ;; esac
executable_name=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Contents/Info.plist")
executable="$app/Contents/MacOS/$executable_name"
frameworks="$app/Contents/Frameworks"
finder_appex="$app/Contents/PlugIns/ZManagerFinderExtension.appex"
mkdir -p "$frameworks"
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
canonical_version=$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$repo_root/package.json")
build_number=${ZMANAGER_BUILD_NUMBER:-1}
[[ $build_number =~ ^[1-9][0-9]*$ ]] || { echo "ZMANAGER_BUILD_NUMBER must be a positive integer" >&2; exit 2; }
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $canonical_version" "$app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $build_number" "$app/Contents/Info.plist"

"$repo_root/scripts/build-macos-native-targets.sh" "$app" "$architecture"

minimum_macos="14.0"
/usr/libexec/PlistBuddy -c "Set :LSMinimumSystemVersion $minimum_macos" "$app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Delete :LSRequiresCarbon' "$app/Contents/Info.plist" 2>/dev/null || true
mkdir -p "$app/Contents/Resources"
for localization in "$repo_root/packaging/macos/Main"/*.lproj; do
  ditto "$localization" "$app/Contents/Resources/$(basename "$localization")"
done
/usr/bin/python3 - "$app/Contents/Info.plist" \
  "$repo_root/packaging/macos/main-info.generated.json" <<'PY'
import json
import plistlib
import sys

path = sys.argv[1]
with open(sys.argv[2], "r", encoding="utf-8") as source:
    generated = json.load(source)
with open(path, "rb") as source:
    info = plistlib.load(source)
info["NSRequiresAquaSystemAppearance"] = False
info["NSAppDataUsageDescription"] = (
    "ZManager uses its private shared container to receive Finder actions "
    "without exposing selected file paths in URLs."
)
info["CFBundleURLTypes"] = [{
    "CFBundleTypeRole": "Viewer",
    "CFBundleURLName": "org.tzap-org.zmanager.shell-request",
    "CFBundleURLSchemes": ["zmanager", "tzap"],
}]
info["CFBundleDocumentTypes"] = [{
    "CFBundleTypeName": group["displayKey"],
    "CFBundleTypeExtensions": group["extensions"],
    "CFBundleTypeRole": group["role"],
    "LSHandlerRank": group["rank"],
    **({"LSItemContentTypes": ["org.tzap-org.zmanager.tzap"]}
       if group["id"] == "tzap" else {}),
} for group in generated["documentGroups"]]
info["UTExportedTypeDeclarations"] = [{
    "UTTypeIdentifier": item["identifier"],
    "UTTypeDescription": item["descriptionKey"],
    "UTTypeConformsTo": item["conformsTo"],
    "UTTypeTagSpecification": {
        "public.filename-extension": item["extensions"],
        "public.mime-type": item["mimeTypes"],
    },
} for item in generated["exportedTypes"]]
info["NSServices"] = [{
    "NSMenuItem": {"default": service["title"]},
    "NSMessage": "performZManagerService",
    "NSPortName": "ZManager",
    "NSSendTypes": ["NSFilenamesPboardType"],
    "NSUserData": service["id"],
} for service in sorted(generated["services"], key=lambda item: item["order"])]
with open(path, "wb") as destination:
    plistlib.dump(info, destination, sort_keys=True)
PY

dependencies=()
while IFS= read -r dependency; do dependencies+=("$dependency"); done < <(otool -L "$executable" | awk 'NR > 1 {print $1}' | grep -E '^/(opt/homebrew|usr/local)/' | sort -u)
if (( ${#dependencies[@]} > 0 )); then
  for dependency in "${dependencies[@]}"; do
    name=$(basename "$dependency")
    ditto "$dependency" "$frameworks/$name"
    chmod 0755 "$frameworks/$name"
    install_name_tool -id "@rpath/$name" "$frameworks/$name"
    install_name_tool -change "$dependency" "@rpath/$name" "$executable"
  done
fi

if ! otool -l "$executable" | grep -q '@executable_path/../Frameworks'; then
  install_name_tool -add_rpath '@executable_path/../Frameworks' "$executable"
fi

identity=${ZMANAGER_CODESIGN_IDENTITY:--}
identity_label=${ZMANAGER_CODESIGN_IDENTITY_LABEL:-$identity}
options=()
main_entitlements="$repo_root/packaging/macos/ZManager.entitlements"
finder_entitlements="$repo_root/packaging/macos/FinderExtension/ZManagerFinderExtension.entitlements"
signing_work=""
if [[ $identity != - ]]; then
  options=(--options runtime --generate-entitlement-der)
  if [[ $identity_label == Developer\ ID\ Application:* ]]; then
    options+=(--timestamp)
  else
    options+=(--timestamp=none)
  fi
fi
if [[ $identity_label == Developer\ ID\ Application:* ||
  $identity_label == Apple\ Development:* ]]; then
  main_profile=${ZMANAGER_MAIN_PROVISIONING_PROFILE:-}
  finder_profile=${ZMANAGER_FINDER_PROVISIONING_PROFILE:-}
  [[ -f $main_profile ]] || { echo "App Group signing requires ZMANAGER_MAIN_PROVISIONING_PROFILE" >&2; exit 1; }
  [[ -f $finder_profile ]] || { echo "App Group signing requires ZMANAGER_FINDER_PROVISIONING_PROFILE" >&2; exit 1; }
  ditto "$main_profile" "$app/Contents/embedded.provisionprofile"
  ditto "$finder_profile" "$finder_appex/Contents/embedded.provisionprofile"
  signing_work=$(mktemp -d "${TMPDIR:-/tmp}/zmanager-signing-entitlements.XXXXXX")
  trap '[[ -z ${signing_work:-} ]] || rm -rf "$signing_work"' EXIT
  security cms -D -i "$main_profile" > "$signing_work/main-profile.plist"
  security cms -D -i "$finder_profile" > "$signing_work/finder-profile.plist"
  /usr/bin/python3 - \
    "$identity_label" \
    "$main_entitlements" "$signing_work/main.plist" \
    "$signing_work/main-profile.plist" org.tzap-org.zmanager \
    "$finder_entitlements" "$signing_work/finder.plist" \
    "$signing_work/finder-profile.plist" org.tzap-org.zmanager.finder-extension <<'PY'
import datetime, plistlib, sys

identity_label = sys.argv[1]
targets = [sys.argv[2:6], sys.argv[6:10]]
now = datetime.datetime.now(datetime.timezone.utc)
for source_path, output_path, profile_path, bundle_id in targets:
    with open(source_path, "rb") as source:
        entitlements = plistlib.load(source)
    with open(profile_path, "rb") as source:
        profile = plistlib.load(source)
    profile_entitlements = profile.get("Entitlements", {})
    application_identifier = (
        profile_entitlements.get("com.apple.application-identifier")
        or profile_entitlements.get("application-identifier")
    )
    team_identifier = profile_entitlements.get("com.apple.developer.team-identifier")
    expiration = profile.get("ExpirationDate")
    if expiration is None or expiration.replace(tzinfo=datetime.timezone.utc) <= now:
        raise SystemExit(f"Provisioning profile is expired for {bundle_id}")
    if application_identifier != f"{team_identifier}.{bundle_id}":
        raise SystemExit(f"Provisioning profile application identifier mismatch for {bundle_id}")
    if "group.org.tzap-org.zmanager" not in profile_entitlements.get(
        "com.apple.security.application-groups", []
    ):
        raise SystemExit(f"Provisioning profile App Group mismatch for {bundle_id}")
    entitlements["com.apple.application-identifier"] = application_identifier
    entitlements["com.apple.developer.team-identifier"] = team_identifier
    if identity_label.startswith("Apple Development:"):
        entitlements["com.apple.security.get-task-allow"] = True
    else:
        entitlements.pop("com.apple.security.get-task-allow", None)
    with open(output_path, "wb") as destination:
        plistlib.dump(entitlements, destination)
PY
  main_entitlements="$signing_work/main.plist"
  finder_entitlements="$signing_work/finder.plist"
fi
while IFS= read -r -d '' nested; do codesign --force ${options[@]+"${options[@]}"} --sign "$identity" "$nested"; done < <(find "$frameworks" -type f -print0)
while IFS= read -r -d '' extension; do
  case $(basename "$extension") in
    ZManagerFinderExtension.appex)
      entitlements="$finder_entitlements"
      ;;
    ZManagerQuickLookPreview.appex|ZManagerQuickLookThumbnail.appex)
      entitlements="$repo_root/packaging/macos/QuickLook/ZManagerQuickLook.entitlements"
      ;;
    *)
      echo "Unknown macOS extension bundle: $extension" >&2
      exit 1
      ;;
  esac
  codesign --force ${options[@]+"${options[@]}"} \
    --entitlements "$entitlements" \
    --sign "$identity" "$extension"
done < <(find "$app/Contents/PlugIns" -maxdepth 1 -type d -name '*.appex' -print0 2>/dev/null)
while IFS= read -r -d '' importer; do
  codesign --force ${options[@]+"${options[@]}"} --sign "$identity" "$importer"
done < <(find "$app/Contents/Library/Spotlight" -maxdepth 1 -type d -name '*.mdimporter' -print0 2>/dev/null)
codesign --force ${options[@]+"${options[@]}"} --sign "$identity" "$executable"
codesign --force ${options[@]+"${options[@]}"} \
  --entitlements "$main_entitlements" \
  --sign "$identity" "$app"
codesign --verify --deep --strict "$app"

bundle_name=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleName' "$app/Contents/Info.plist")
bundle_identifier=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist")
[[ $bundle_name == ZManager ]] || { echo "Unexpected macOS bundle name: $bundle_name" >&2; exit 1; }
[[ $bundle_identifier == org.tzap-org.zmanager ]] || { echo "Unexpected macOS bundle identifier: $bundle_identifier" >&2; exit 1; }
[[ $(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$app/Contents/Info.plist") == "$minimum_macos" ]] || {
  echo "Unexpected macOS deployment target" >&2
  exit 1
}
[[ $(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist") == "$canonical_version" ]]
[[ $(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$app/Contents/Info.plist") == "$build_number" ]]

if otool -L "$executable" | grep -Eq '^\s+/(opt/homebrew|usr/local)/'; then
  echo "Application still contains build-machine library paths" >&2
  exit 1
fi

# Launch Services, pluginkit, Quick Look, and Spotlight registration is deferred
# to the install step in build-macos.sh. Registering this ephemeral build output
# would leave stale extension paths behind after it is copied or removed.

echo "Prepared self-contained signed application: $app"
