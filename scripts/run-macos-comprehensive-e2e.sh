#!/usr/bin/env bash
set -uo pipefail

# MacOS-first cross-repository verification entry point.
#
# The default is the safe, deterministic contract/build lane. Opt into real
# GUI, device, native-package, and staging traffic explicitly. Every selected
# lane records pass/fail/blocked instead of silently treating a missing device
# or credential as a passing test.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mobile_root="${ZMANAGER_MOBILE_DIR:-$repo_root/../zmanager-mobile}"
server_root="${CERT_ROOT_SERVER_DIR:-$HOME/Documents/cert-root-server}"
artifact_dir="${ZMANAGER_MACOS_E2E_ARTIFACT_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/zmanager-macos-e2e.XXXXXX")}" 
summary_file="$artifact_dir/summary.tsv"

mkdir -p "$artifact_dir"
: >"$summary_file"

run_static=1
run_gui=0
run_native=0
run_devices=0
run_staging=0

usage() {
  cat <<'EOF'
Usage: scripts/run-macos-comprehensive-e2e.sh [options]

Options:
  --static       Build, architecture, Rust/Swift, mobile fixture, and server contract checks (default)
  --gui          Run the real macOS Tauri WebDriver suite
  --native       Run installed macOS host/Finder/Quick Look/Spotlight checks
  --devices      Run physical Android <-> iPhone LocalSend and contact-card checks
  --staging      Run staging server and hosted-device lanes (credentials stay in the environment)
  --all          Select every lane
  --help         Show this help

Required device variables for --devices:
  ANDROID_SERIAL, IOS_DEVICE (or IOS_DEVICE_ID), IOS_DEVELOPMENT_TEAM

Required staging variables for --staging:
  STAGING_TEST_USER, STAGING_TEST_PASSWORD (or TZAP_STAGING_EMAIL/TZAP_STAGING_PASSWORD)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --static) run_static=1 ;;
    --gui) run_gui=1 ;;
    --native) run_native=1 ;;
    --devices) run_devices=1 ;;
    --staging) run_staging=1 ;;
    --all) run_static=1; run_gui=1; run_native=1; run_devices=1; run_staging=1 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

record() {
  local name="$1" status="$2" detail="${3:-}"
  printf '%s\t%s\t%s\n' "$name" "$status" "$detail" | tee -a "$summary_file"
}

run_case() {
  local name="$1"
  shift
  echo "==> $name"
  if "$@" >"$artifact_dir/$name.log" 2>&1; then
    record "$name" pass "$artifact_dir/$name.log"
    return 0
  fi
  if rg -qi 'Timed out while enabling automation mode' "$artifact_dir/$name.log"; then
    record "$name" blocked "Apple XCTest UI automation did not initialize; see $artifact_dir/$name.log and its xcresult result bundle"
    tail -n 40 "$artifact_dir/$name.log" >&2 || true
    return 2
  fi
  record "$name" fail "$artifact_dir/$name.log"
  tail -n 80 "$artifact_dir/$name.log" >&2 || true
  return 1
}

block_case() {
  record "$1" blocked "$2"
}

run_shell_case() {
  local name="$1" command="$2"
  run_case "$name" bash -lc "$command"
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This runner is macOS-first and requires Darwin." >&2
  exit 2
fi

if [[ "${TZAP_E2E_ENV:-staging}" != "staging" ]]; then
  echo "TZAP_E2E_ENV must be staging; production and local E2E are forbidden." >&2
  exit 2
fi

# Force the compiled desktop binary and frontend build into staging as well as
# the test process. A runner-only TZAP_E2E_ENV check is insufficient because
# the Rust transport uses compile-time environment policy.
export TZAP_E2E_ENV=staging
export VITE_TZAP_BUILD_ENV=staging
export ZMANAGER_TZAP_BUILD_ENV=staging
export ZMANAGER_TZAP_SERVER_BASE_URL=https://staging.tzap.org

if [[ -n "${TZAP_SERVER_BASE_URL:-}" && "${TZAP_SERVER_BASE_URL}" != "https://staging.tzap.org" ]]; then
  echo "TZAP_SERVER_BASE_URL must be https://staging.tzap.org when set." >&2
  exit 2
fi

if [[ ! -d "$mobile_root" ]]; then
  echo "Missing sibling repository: $mobile_root" >&2
  exit 2
fi
if [[ ! -d "$server_root" ]]; then
  echo "Missing server repository: $server_root" >&2
  exit 2
fi

# Load only the staging test aliases needed by the cross-repository checks.
# Keep secret values in memory and never echo or pass them on a command line.
read_env_value() {
  local key="$1" file="$2"
  awk -v wanted="$key" '
    $0 ~ "^[[:space:]]*(export[[:space:]]+)?" wanted "=" {
      value = substr($0, index($0, "=") + 1)
      sub(/^[[:space:]]*/, "", value)
      sub(/[[:space:]]+#.*$/, "", value)
      if ((substr(value, 1, 1) == "\"" && substr(value, length(value), 1) == "\"") || (substr(value, 1, 1) == "\x27" && substr(value, length(value), 1) == "\x27")) {
        value = substr(value, 2, length(value) - 2)
      }
      print value
      exit
    }
  ' "$file"
}

staging_env_file="${TZAP_E2E_ENV_FILE:-}"
if [[ -z "$staging_env_file" || ! -f "$staging_env_file" ]]; then
  for candidate in "$server_root/.env.staging" "$server_root/staging.env"; do
    if [[ -f "$candidate" ]]; then staging_env_file="$candidate"; break; fi
  done
fi
if [[ -n "$staging_env_file" && -f "$staging_env_file" ]]; then
  if [[ -z "${STAGING_TEST_USER:-}" ]]; then
    STAGING_TEST_USER="$(read_env_value STAGING_TEST_USER "$staging_env_file")"
    [[ -n "$STAGING_TEST_USER" ]] || STAGING_TEST_USER="$(read_env_value STAGING_TEST_USER_1 "$staging_env_file")"
    export STAGING_TEST_USER
  fi
  if [[ -z "${STAGING_TEST_PASSWORD:-}" ]]; then
    STAGING_TEST_PASSWORD="$(read_env_value STAGING_TEST_PASSWORD "$staging_env_file")"
    [[ -n "$STAGING_TEST_PASSWORD" ]] || STAGING_TEST_PASSWORD="$(read_env_value STAGING_TEST_USER_PASSWORD "$staging_env_file")"
    export STAGING_TEST_PASSWORD
  fi
fi

if (( run_static )); then
  run_case desktop-build npm run build || true
  run_case desktop-architecture npm run test:architecture || true
  run_shell_case desktop-cargo-check "cd '$repo_root/src-tauri' && cargo check" || true
  run_shell_case desktop-cargo-test "cd '$repo_root/src-tauri' && cargo test" || true
  run_shell_case macos-swift-build "cd '$repo_root/native/macos' && swift build" || true
  run_case mobile-maestro-selectors bash "$mobile_root/scripts/check-maestro-selectors.sh" || true
  run_case server-contract bash -lc "cd '$server_root' && npm test" || true
fi

if (( run_gui )); then
  run_case desktop-macos-gui bash "$repo_root/scripts/test-macos-gui.sh" || true
fi

if (( run_native )); then
  installed_app="${ZMANAGER_MACOS_APP_PATH:-/Applications/ZManager.app}"
  if [[ -d "$installed_app" ]]; then
    run_case macos-embedded-extension-contract bash "$repo_root/scripts/test-macos-embedded-extensions.sh" "$installed_app" || true
    run_case macos-installed-protocol bash "$repo_root/scripts/test-macos-installed-protocol.sh" "$installed_app" || true
    run_case macos-finder-installed-characterization bash "$repo_root/scripts/characterize-macos-finder-action.sh" "$installed_app" || true
    run_case macos-installed-host-smoke bash "$repo_root/scripts/run-macos-installed-host-smoke.sh" "$installed_app" || true

    fixture="${ZMANAGER_MACOS_TZAP_FIXTURE:-$repo_root/../zmanager/fixtures/archives/basic.tzap}"
    if [[ -f "$fixture" ]]; then
      run_case macos-spotlight-importer bash "$repo_root/scripts/run-macos-spotlight-importer-smoke.sh" "$installed_app/Contents/Library/Spotlight/ZManagerSpotlight.mdimporter" "$fixture" || true
      screenshot="$artifact_dir/quicklook.png"
      run_case macos-quicklook-ui osascript "$repo_root/scripts/macos-quicklook-installed-ui-smoke.applescript" "$fixture" "$screenshot" || true
    else
      block_case macos-spotlight-and-quicklook "TZAP fixture missing: $fixture"
    fi
  else
    block_case macos-installed-native "Set ZMANAGER_MACOS_APP_PATH to a built/installed ZManager.app"
  fi
fi

if (( run_devices )); then
  android_serial="${ANDROID_SERIAL:-}"
  ios_device="${IOS_DEVICE:-${IOS_DEVICE_ID:-}}"
  # Keep one canonical variable for downstream staging and XCTest helpers.
  # The physical-device lane historically accepted IOS_DEVICE while the
  # staging lane required IOS_DEVICE_ID, which could silently skip iOS
  # enrollment when only the documented device variable was supplied.
  if [[ -n "$ios_device" && -z "${IOS_DEVICE_ID:-}" ]]; then
    export IOS_DEVICE_ID="$ios_device"
  fi
  if [[ -z "$android_serial" || -z "$ios_device" || -z "${IOS_DEVELOPMENT_TEAM:-}" ]]; then
    block_case physical-device-localsend "Set ANDROID_SERIAL, IOS_DEVICE/IOS_DEVICE_ID, and IOS_DEVELOPMENT_TEAM"
    block_case physical-device-contact-card "Set ANDROID_SERIAL, IOS_DEVICE/IOS_DEVICE_ID, and IOS_DEVELOPMENT_TEAM; run with --staging for enrolled identities"
  else
    run_case android-device-present adb -s "$android_serial" get-state || true
    run_case ios-device-present xcrun devicectl list devices || true
    run_case android-debug-build bash -lc "cd '$mobile_root' && scripts/check-android.sh" || true
    run_case android-maestro-matrix bash -lc "cd '$mobile_root' && adb -s '$android_serial' install -r android/app/build/outputs/apk/debug/app-debug.apk >/dev/null && MAESTRO_PLATFORM=android MAESTRO_DEVICE_ID='$android_serial' scripts/check-maestro.sh" || true
    run_case localsend-android-to-ios bash -lc "cd '$mobile_root' && ANDROID_SERIAL='$android_serial' IOS_DEVICE='$ios_device' IOS_DEVELOPMENT_TEAM='$IOS_DEVELOPMENT_TEAM' LOCALSEND_DIRECTION=android-to-ios scripts/check-localsend-mobile-archive.sh" || true
    run_case localsend-ios-to-android bash -lc "cd '$mobile_root' && ANDROID_SERIAL='$android_serial' IOS_DEVICE='$ios_device' IOS_DEVELOPMENT_TEAM='$IOS_DEVELOPMENT_TEAM' LOCALSEND_DIRECTION=ios-to-android scripts/check-localsend-mobile-archive.sh" || true
    if (( ! run_staging )); then
      block_case physical-device-contact-card "Contact-card exchange requires enrolled staging identities; run --staging --devices"
    fi
    if [[ -n "${IOS_SHARE_EXTENSION_DRIVER:-}" ]]; then
      run_case physical-external-intents bash -lc "cd '$mobile_root' && ANDROID_SERIAL='$android_serial' IOS_DEVICE_ID='$ios_device' IOS_SHARE_EXTENSION_DRIVER='$IOS_SHARE_EXTENSION_DRIVER' scripts/check-external-intents.sh" || true
    else
      block_case physical-external-intents "IOS_SHARE_EXTENSION_DRIVER is not configured for the physical Files/Photos provider path"
    fi
  fi
fi

if (( run_staging )); then
  staging_email="${TZAP_STAGING_EMAIL:-${STAGING_TEST_USER:-}}"
  staging_password="${TZAP_STAGING_PASSWORD:-${STAGING_TEST_PASSWORD:-}}"
  if [[ -z "$staging_email" || -z "$staging_password" ]]; then
    block_case server-staging-e2e "Set staging credentials in the process environment; values are never printed"
  else
    run_case server-staging-e2e bash -lc "cd '$server_root' && TZAP_STAGING_EMAIL=\"\${TZAP_STAGING_EMAIL:-\${STAGING_TEST_USER}}\" TZAP_STAGING_PASSWORD=\"\${TZAP_STAGING_PASSWORD:-\${STAGING_TEST_PASSWORD}}\" scripts/test-e2e-staging.sh" || true
  fi
  if [[ -n "${STAGING_TEST_USER:-}" && -n "${STAGING_TEST_PASSWORD:-}" ]]; then
    android_staging_identity_passed=0
    if run_case android-staging-identity bash -lc "cd '$mobile_root' && scripts/check-android-identity-staging.sh"; then
      android_staging_identity_passed=1
    fi
    if (( android_staging_identity_passed )) && [[ -n "${ANDROID_SERIAL:-}" ]]; then
      export MAESTRO_ARCHIVE_TEST_PASSWORD="${MAESTRO_ARCHIVE_TEST_PASSWORD:-ZmanagerE2EArchivePass-2026}"
      export MAESTRO_WRONG_PASSWORD="${MAESTRO_WRONG_PASSWORD:-definitely-wrong-password}"
      run_case android-staging-contact-alias bash -lc "cd '$mobile_root' && maestro --platform android --device '${ANDROID_SERIAL}' test maestro/android/contact-alias-remove.yaml" || true
      run_case android-staging-contact-bare-key bash -lc "cd '$mobile_root' && maestro --platform android --device '${ANDROID_SERIAL}' test maestro/android/contact-bare-key.yaml" || true
      run_case android-staging-contact-export bash -lc "cd '$mobile_root' && maestro --platform android --device '${ANDROID_SERIAL}' test maestro/android/contact-card-export-two-device.yaml" || true
      run_case android-staging-contact-manifest bash -lc "cd '$mobile_root' && maestro --platform android --device '${ANDROID_SERIAL}' test maestro/android/contact-manifest-export.yaml" || true
      run_case android-staging-contact-archive bash -lc "cd '$mobile_root' && maestro --platform android --device '${ANDROID_SERIAL}' test maestro/android/contact-archive-workflow.yaml" || true
      run_case android-staging-creation-no-password bash -lc "cd '$mobile_root' && maestro --platform android --device '${ANDROID_SERIAL}' test maestro/android/creation-staging-no-password.yaml" || true
      run_case android-staging-creation-password bash -lc "cd '$mobile_root' && maestro --platform android --device '${ANDROID_SERIAL}' test maestro/android/creation-staging-password.yaml" || true
      run_case android-staging-creation-count-password bash -lc "cd '$mobile_root' && maestro --platform android --device '${ANDROID_SERIAL}' test maestro/android/creation-staging-count-password.yaml" || true
    elif [[ -n "${ANDROID_SERIAL:-}" ]]; then
      block_case android-staging-archive-matrix "Android staging identity did not complete; archive staging flows were not attempted"
    fi
    ios_staging_identity_passed=0
    if [[ -n "${IOS_DEVICE_ID:-}" && -n "${IOS_DEVELOPMENT_TEAM:-}" ]]; then
      if run_case ios-staging-identity bash -lc "cd '$mobile_root' && scripts/check-ios-identity-staging-physical.sh"; then
        ios_staging_identity_passed=1
      fi
      if (( run_devices && android_staging_identity_passed && ios_staging_identity_passed )); then
        run_case contact-card-android-ios bash -lc "cd '$mobile_root' && ANDROID_SERIAL='${ANDROID_SERIAL}' IOS_DEVICE='${IOS_DEVICE_ID}' IOS_DEVELOPMENT_TEAM='${IOS_DEVELOPMENT_TEAM}' scripts/check-contact-card-two-device.sh" || true
        run_case c8-contact-ios-to-android bash -lc "cd '$mobile_root' && ANDROID_SERIAL='${ANDROID_SERIAL}' IOS_DEVICE='${IOS_DEVICE_ID}' IOS_DEVELOPMENT_TEAM='${IOS_DEVELOPMENT_TEAM}' CONTACT_E2E_SOURCE=ios scripts/check-contact-card-two-device.sh" || true
        run_case c8-android-backup-mutation bash -lc "cd '$mobile_root' && maestro --platform android --device '${ANDROID_SERIAL}' test maestro/android/backup-mutation-upload.yaml" || true
        run_case c8-ios-backup-mutation-restore bash -lc "cd '$mobile_root' && xcodebuild -project ios/ZManagerMobile/ZManagerMobile.xcodeproj -scheme ZManagerMobile -configuration Debug -destination 'id=${IOS_DEVICE_ID}' DEVELOPMENT_TEAM='${IOS_DEVELOPMENT_TEAM}' -allowProvisioningUpdates -only-testing:ZManagerMobileUITests/ZManagerMobileUITests/testPhysicalBackupMutationRestore test" || true
      elif (( run_devices )); then
        block_case physical-contact-card-and-c8 "Both Android and iOS staging identities are required; downstream cross-device flows were not attempted"
      fi
    else
      block_case ios-staging-identity "Set IOS_DEVICE_ID and IOS_DEVELOPMENT_TEAM for the physical iPhone staging lane"
    fi
  else
    block_case mobile-staging-identity "Set STAGING_TEST_USER and STAGING_TEST_PASSWORD in the process environment"
  fi
fi

failures="$(awk -F '\t' '$2 == "fail" { count++ } END { print count + 0 }' "$summary_file")"
blocked="$(awk -F '\t' '$2 == "blocked" { count++ } END { print count + 0 }' "$summary_file")"
echo "Summary: failures=$failures blocked=$blocked artifacts=$artifact_dir"
if [[ "$failures" != 0 ]]; then
  exit 1
fi
