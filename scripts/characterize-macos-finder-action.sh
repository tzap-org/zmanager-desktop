#!/usr/bin/env bash
set -euo pipefail

app_path="${1:-/Applications/ZManager.app}"
lookback="${2:-2h}"
bundle_id="org.tzap-org.zmanager.finder-extension"

if [[ ! -d "$app_path" ]]; then
  printf 'error=installed_app_missing\n' >&2
  exit 1
fi

extension_path="$app_path/Contents/PlugIns/ZManagerFinderExtension.appex"
info_plist="$app_path/Contents/Info.plist"
user_home="$(dscl . -read "/Users/$(id -un)" NFSHomeDirectory | awk '{print $2}')"
extension_team="$(codesign -d --verbose=4 "$extension_path" 2>&1 | sed -n 's/^TeamIdentifier=//p' | sed -n '1p')"
app_group_name="$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["appGroupName"])' "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/packaging/macos/product-identity.json")"
app_group_id="$extension_team.$app_group_name"
request_directory="$user_home/Library/Group Containers/$app_group_id/ShellActionRequests"

app_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$info_plist")"
app_build="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$info_plist")"
plugin_lines="$(pluginkit -m -A -D -i "$bundle_id" 2>/dev/null || true)"
plugin_count="$(printf '%s\n' "$plugin_lines" | rg -c "$bundle_id" || true)"
enabled_count="$(printf '%s\n' "$plugin_lines" | rg -c "^[[:space:]]*\\+[[:space:]]+$bundle_id" || true)"
app_entitlements="$(codesign -d --entitlements :- "$app_path" 2>/dev/null || true)"
extension_entitlements="$(codesign -d --entitlements :- "$extension_path" 2>/dev/null || true)"
app_group_in_app="$(printf '%s\n' "$app_entitlements" | rg -c "$app_group_id" || true)"
app_group_in_extension="$(printf '%s\n' "$extension_entitlements" | rg -c "$app_group_id" || true)"

request_count=0
if [[ -d "$request_directory" ]]; then
  request_count="$(find "$request_directory" -maxdepth 1 -type f -name '*.json' -print | wc -l | tr -d ' ')"
fi

rejection_count="$(/usr/bin/log show --last "$lookback" --style compact \
  --predicate "process == \"containermanagerd\" AND eventMessage CONTAINS \"$bundle_id\" AND eventMessage CONTAINS \"REJECTED\"" \
  2>/dev/null | rg -c 'REJECTED' || true)"

printf 'schema_version=1\n'
printf 'app_version=%s\n' "$app_version"
printf 'app_build=%s\n' "$app_build"
printf 'finder_extension_present=%s\n' "$([[ -d "$extension_path" ]] && printf true || printf false)"
printf 'finder_extension_registration_count=%s\n' "$plugin_count"
printf 'finder_extension_enabled_count=%s\n' "$enabled_count"
printf 'app_group_entitlement_app=%s\n' "$([[ "$app_group_in_app" -gt 0 ]] && printf true || printf false)"
printf 'app_group_entitlement_extension=%s\n' "$([[ "$app_group_in_extension" -gt 0 ]] && printf true || printf false)"
printf 'pending_request_file_count=%s\n' "$request_count"
printf 'app_group_rejection_count=%s\n' "$rejection_count"

if [[ "$rejection_count" -gt 0 ]]; then
  printf 'first_failing_stage=appGroupAvailable\n'
  printf 'failure_code=appGroupSignatureRejected\n'
else
  printf 'first_failing_stage=notObserved\n'
  printf 'failure_code=noneObserved\n'
fi
