#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
project="$repo_root/packaging/macos/DevelopmentProvisioning/ZManagerDevelopmentProvisioning.xcodeproj"
identity_json="$repo_root/packaging/macos/product-identity.json"
team_id=$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["teamIdentifier"])' "$identity_json")
main_bundle_id=$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["mainBundleIdentifier"])' "$identity_json")
finder_bundle_id=$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["finderExtensionBundleIdentifier"])' "$identity_json")
work=$(mktemp -d "${TMPDIR:-/tmp}/zmanager-development-profiles.XXXXXX")
trap 'rm -rf "$work"' EXIT

refresh_profile() {
  local label=$1
  local bundle_id=$2
  local entitlements=$3
  local sandbox=$4
  local user_selected_files=$5
  local derived_data="$work/$label"
  xcodebuild \
    -project "$project" \
    -scheme ZManagerDevelopmentProvisioning \
    -configuration Debug \
    -destination 'platform=macOS' \
    -derivedDataPath "$derived_data" \
    -allowProvisioningUpdates \
    -allowProvisioningDeviceRegistration \
    DEVELOPMENT_TEAM="$team_id" \
    CODE_SIGN_STYLE=Automatic \
    CODE_SIGN_IDENTITY="Apple Development" \
    PRODUCT_BUNDLE_IDENTIFIER="$bundle_id" \
    CODE_SIGN_ENTITLEMENTS="$entitlements" \
    ENABLE_APP_SANDBOX="$sandbox" \
    ENABLE_USER_SELECTED_FILES="$user_selected_files" \
    REGISTER_APP_GROUPS=YES \
    build

  local built_app="$derived_data/Build/Products/Debug/ZManagerDevelopmentProvisioning.app"
  [[ -f "$built_app/Contents/embedded.provisionprofile" ]] || {
    echo "Xcode did not embed the expected $label development profile." >&2
    exit 1
  }
}

refresh_profile \
  main \
  "$main_bundle_id" \
  "$repo_root/packaging/macos/ZManager.entitlements" \
  NO \
  NO
refresh_profile \
  finder \
  "$finder_bundle_id" \
  "$repo_root/packaging/macos/FinderExtension/ZManagerFinderExtension.entitlements" \
  YES \
  readonly

echo "Refreshed ZManager Personal Team macOS development profiles."
