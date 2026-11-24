#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

install_deps=0
skip_tests=0
install_application=1
bundle_kind="all"
build_profile="local"
install_dir="${ZMANAGER_MACOS_INSTALL_DIR:-/Applications}"
lsregister="${ZMANAGER_LSREGISTER:-/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister}"
architecture="$(uname -m)"
export LZMA_API_STATIC=1

usage() {
  cat <<'EOF'
Usage: scripts/build-macos.sh [--install-deps] [--skip-tests] [--no-install] [--install-dir PATH] [--bundle app|dmg|all] [--arch arm64|x86_64] [--profile local|online]

Builds and stages the unified macOS Tauri Release Bundle under
/tmp/zmanager-desktop-macos-local or /tmp/zmanager-desktop-macos-online
(override with ZMANAGER_MACOS_STAGE_DIR).

By default the script builds the host architecture and produces both a .app
bundle and a .dmg, then installs ZManager.app into /Applications. Local builds
embed build-machine codec libraries and rewrite their load paths. When an
Apple Development or Apple Distribution identity is available in Keychain, the
script uses it for inside-out signing and derives the App Group from its team.
Otherwise --no-install builds may use ad-hoc signing. Set
ZMANAGER_CODESIGN_IDENTITY to "-" to force ad-hoc signing, or to a Developer ID
Application identity and set ZMANAGER_NOTARY_PROFILE to a validated notarytool
keychain profile to sign, notarize, staple, and Gatekeeper-check the same output.

macOS prerequisites:
  xcode-select --install
  brew install cmake node lz4 xz
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

Options:
  --install-deps  Install missing CMake/Node dependencies with Homebrew and
                  install or update Rust with rustup.
  --skip-tests    Skip frontend and Rust tests before bundling.
  --no-install    Build and stage artifacts without installing the application.
  --install-dir   Install into PATH instead of /Applications. This can also be
                  set with ZMANAGER_MACOS_INSTALL_DIR.
  --bundle VALUE  Build app, dmg, or all bundles. Default: all.
  --arch VALUE    Build a separate arm64 or x86_64 artifact. Default: host architecture.
  --profile VALUE Build the local (offline) or online profile. Default: local.
  -h, --help      Show this help.
EOF
}

while (($#)); do
  case "$1" in
    --install-deps)
      install_deps=1
      ;;
    --skip-tests)
      skip_tests=1
      ;;
    --no-install)
      install_application=0
      ;;
    --install-dir)
      if (($# < 2)); then
        echo "--install-dir requires a destination directory." >&2
        exit 2
      fi
      install_dir="$2"
      install_application=1
      shift
      ;;
    --bundle)
      if (($# < 2)); then
        echo "--bundle requires app, dmg, or all." >&2
        exit 2
      fi
      bundle_kind="$2"
      shift
      ;;
    --arch)
      if (($# < 2)); then
        echo "--arch requires arm64 or x86_64." >&2
        exit 2
      fi
      architecture="$2"
      shift
      ;;
    --profile)
      if (($# < 2)); then
        echo "--profile requires local or online." >&2
        exit 2
      fi
      build_profile="$2"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

case "$bundle_kind" in
  app|dmg|all)
    ;;
  *)
    echo "Unsupported bundle value: $bundle_kind (expected app, dmg, or all)." >&2
    exit 2
    ;;
esac

case "$build_profile" in
  local|online)
    ;;
  *)
    echo "Unsupported profile: $build_profile (expected local or online)." >&2
    exit 2
    ;;
esac

case "$architecture" in
  arm64) rust_triple="aarch64-apple-darwin" ;;
  x86_64) rust_triple="x86_64-apple-darwin" ;;
  *) echo "Unsupported macOS architecture: $architecture" >&2; exit 2 ;;
esac

if [[ -z "$install_dir" ]]; then
  echo "The macOS application install directory must not be empty." >&2
  exit 2
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS bundles must be built on macOS." >&2
  exit 1
fi

codesign_identity="${ZMANAGER_CODESIGN_IDENTITY:-}"
codesign_identities="$(security find-identity -v -p codesigning 2>/dev/null || true)"
official_team_id=$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["teamIdentifier"])' \
  "$repo_root/packaging/macos/product-identity.json")
if [[ -z "$codesign_identity" ]]; then
  git_identity_email=$(git config user.email 2>/dev/null || true)
  if [[ -n "$git_identity_email" ]]; then
    team_identity_record=$(grep -F "Apple Development: $git_identity_email" <<<"$codesign_identities" | sed -n '1p')
  fi
  [[ -n ${team_identity_record:-} ]] || team_identity_record=$(grep -F 'Apple Development:' <<<"$codesign_identities" | sed -n '1p')
  [[ -n "$team_identity_record" ]] || team_identity_record=$(grep -F 'Apple Distribution:' <<<"$codesign_identities" | sed -n '1p')
  codesign_identity=$(awk '{print $2}' <<<"$team_identity_record")
  codesign_identity="${codesign_identity:--}"
fi
if [[ "$codesign_identity" != "-" ]] &&
  ! grep -F "$codesign_identity" <<<"$codesign_identities" >/dev/null; then
  echo "The configured macOS code-signing identity is not available in Keychain." >&2
  exit 1
fi
team_id="${ZMANAGER_TEAM_ID:-}"
app_group_name=$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["appGroupName"])' \
  "$repo_root/packaging/macos/product-identity.json")
export ZMANAGER_CODESIGN_IDENTITY="$codesign_identity"
if [[ "$codesign_identity" == "-" ]]; then
  codesign_identity_label="ad-hoc"
  codesign_identity_sha1=""
  echo "Code signing: ad-hoc"
else
  identity_record=$(grep -F "$codesign_identity" <<<"$codesign_identities" | sed -n '1p')
  codesign_identity_label=$(sed -E 's/^[^"]*"([^"]+)".*/\1/' <<<"$identity_record")
  export ZMANAGER_CODESIGN_IDENTITY_LABEL="$codesign_identity_label"
  echo "Code signing: Apple team identity from Keychain"
fi

source_cargo_env() {
  if [[ -f "$HOME/.cargo/env" ]]; then
    # shellcheck disable=SC1091
    . "$HOME/.cargo/env"
  fi
}

version_major() {
  "$1" --version | sed -E 's/^[^0-9]*([0-9]+).*/\1/'
}

version_minor() {
  "$1" --version | sed -E 's/^[^0-9]*[0-9]+\.([0-9]+).*/\1/'
}

node_install_required() {
  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    return 0
  fi
  local node_major
  node_major="$(version_major node)"
  [[ -z "$node_major" || "$node_major" -lt 24 ]]
}

rust_install_required() {
  if ! command -v cargo >/dev/null 2>&1 || ! command -v rustc >/dev/null 2>&1; then
    return 0
  fi
  local rust_major rust_minor
  rust_major="$(version_major rustc)"
  rust_minor="$(version_minor rustc)"
  [[ -z "$rust_major" || -z "$rust_minor" || "$rust_major" -lt 1 || ("$rust_major" -eq 1 && "$rust_minor" -lt 85) ]]
}

ensure_homebrew() {
  if command -v brew >/dev/null 2>&1; then
    return
  fi
  echo "Homebrew is required for --install-deps." >&2
  echo "Install it from https://brew.sh, then rerun this script." >&2
  exit 1
}

if ! xcode-select -p >/dev/null 2>&1; then
  if ((install_deps)); then
    echo "Requesting installation of the Xcode Command Line Tools."
    xcode-select --install || true
  fi
  echo "Xcode Command Line Tools are required. Complete 'xcode-select --install', then rerun." >&2
  exit 1
fi

source_cargo_env

if ((install_deps)); then
  ensure_homebrew
  brew install cmake lz4 xz
  if node_install_required; then
    brew install node
  fi
  if rust_install_required; then
    if command -v rustup >/dev/null 2>&1; then
      rustup update stable
    else
      curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
      source_cargo_env
    fi
  fi
fi

missing_commands=()
for command_name in node npm cargo rustc cmake xcrun security codesign ditto; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    missing_commands+=("$command_name")
  fi
done
if ((${#missing_commands[@]})); then
  echo "Missing required command(s): ${missing_commands[*]}" >&2
  echo "Install the macOS prerequisites, or rerun with --install-deps." >&2
  exit 1
fi

if ! xcrun --find clang >/dev/null 2>&1; then
  echo "The active Xcode toolchain does not provide clang." >&2
  echo "Select a valid toolchain with xcode-select, then rerun." >&2
  exit 1
fi

if ((install_application)) && [[ "$codesign_identity" == "-" ]]; then
  echo "A team-matched macOS signing identity is required to install ZManager." >&2
  echo "Finder Sync needs a team-authorized App Group; an ad-hoc build can register the menu but cannot deliver its requests." >&2
  echo "Install a valid Apple Development or Apple Distribution identity in Keychain, or pass --no-install for an ad-hoc build." >&2
  exit 1
fi

if [[ ! -f src-tauri/icons/icon.icns ]]; then
  echo "Missing macOS application icon: src-tauri/icons/icon.icns" >&2
  echo "Generate and commit an ICNS asset before building macOS bundles." >&2
  exit 1
fi

rust_major="$(version_major rustc)"
rust_minor="$(version_minor rustc)"
if ((rust_major < 1 || (rust_major == 1 && rust_minor < 93))); then
  echo "Rust 1.93 or newer is required by the pinned ZManager core. Current rustc: $(rustc --version)" >&2
  echo "Update the stable toolchain with: rustup update stable" >&2
  exit 1
fi

node_major="$(version_major node)"
if ((node_major < 24)); then
  echo "Node.js 24 is required. Current node: $(node --version)" >&2
  echo "Install a current Node.js release, or rerun with --install-deps." >&2
  exit 1
fi

if [[ ! -d node_modules ]] || ! npm ls --depth=0 @tauri-apps/cli typescript vite vitest >/dev/null 2>&1; then
  npm install
fi

scripts/ensure-sibling-repos.sh
scripts/sync-uniffi-swift-bindings.sh
source scripts/pinned-openssl.sh
zmanager_configure_pinned_openssl "$rust_triple"

if ((!skip_tests)); then
  npm run test:frontend
  # Keep packaging validation in the same profile as the artifact build. GUI
  # tests remain explicitly debug-only in scripts/test-macos-gui.sh.
  (cd src-tauri && cargo test --release)
fi

cargo_target_dir="${CARGO_TARGET_DIR:-$repo_root/src-tauri/target}"
bundle_root="$cargo_target_dir/$rust_triple/release/bundle"
rm -rf "$bundle_root/macos"

build_number="${ZMANAGER_BUILD_NUMBER:-$(git rev-list --count HEAD)}"
os_label="MacOS"
build_id="${os_label}-${architecture}-${build_profile}-${build_number}"
export ZMANAGER_BUILD_NUMBER="$build_number"
export ZMANAGER_BUILD_ID="$build_id"
export ZMANAGER_TZAP_BUILD_ENV="${ZMANAGER_TZAP_BUILD_ENV:-prod}"
export VITE_TZAP_BUILD_ENV="$ZMANAGER_TZAP_BUILD_ENV"
export VITE_ZMANAGER_PROFILE="$build_profile"
export VITE_ENABLE_HOSTED_CAPABILITIES="$( [[ "$build_profile" == online ]] && echo true || echo false )"
echo "Build: ${build_id}"

tauri_args=(build --bundles app --no-sign --target "$rust_triple")
if [[ "$build_profile" == online ]]; then
  tauri_args+=(-- --no-default-features --features online-profile)
else
  tauri_args+=(-- --no-default-features)
fi
npm run tauri -- "${tauri_args[@]}"

applications=()
while IFS= read -r candidate; do applications+=("$candidate"); done < <(
  find "$bundle_root/macos" -maxdepth 1 -type d -name '*.app' -print 2>/dev/null | sort
)
if ((${#applications[@]} != 1)); then
  echo "Expected exactly one Tauri application under $bundle_root/macos." >&2
  exit 1
fi
application="${applications[0]}"

version=$(node -p 'require("./package.json").version')
artifact_product="ZManager"
if [[ "$build_profile" == online ]]; then
  artifact_product="ZManager-full"
fi
artifact_base="${artifact_product}-${version}-macos-${architecture}"
stage_dir="${ZMANAGER_MACOS_STAGE_DIR:-/tmp/zmanager-desktop-macos-${build_profile}}"
install -d -m 0755 "$stage_dir"
staged_app="$stage_dir/$artifact_base.app"
zip_artifact="$stage_dir/$artifact_base.zip"
dmg_artifact="$stage_dir/$artifact_base.dmg"
rm -rf "$staged_app"
rm -f "$zip_artifact" "$dmg_artifact"

report_packaging_state() {
  echo "macOS packaging diagnostics:" >&2
  df -h "$stage_dir" "$bundle_root" 2>/dev/null || true
  for path in "$application" "$staged_app" "$zip_artifact" "$dmg_artifact"; do
    if [[ -e "$path" ]]; then
      du -sh "$path" 2>/dev/null || true
    fi
  done
}

run_packaging_step() {
  local name="$1"
  shift
  echo "macOS packaging: ${name}"
  if "$@"; then
    echo "macOS packaging complete: ${name}"
  else
    local status=$?
    echo "macOS packaging failed: ${name} (exit ${status})" >&2
    report_packaging_state
    return "$status"
  fi
}

run_packaging_step "stage application" ditto "$application" "$staged_app"
[[ -d "$staged_app/Contents" && -f "$staged_app/Contents/Info.plist" ]] || {
  echo "Staged macOS application is incomplete: $staged_app" >&2
  report_packaging_state
  exit 1
}

# Build the native extension suite and finalize metadata only in the staged
# release bundle. The Tauri target directory remains an uninstalled build
# product and is never made into a second Finder Sync provider.
if [[ "$codesign_identity" != "-" ]]; then
  main_executable=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$staged_app/Contents/Info.plist")
  team_probe_dir=$(mktemp -d "${TMPDIR:-/tmp}/zmanager-signing-team.XXXXXX")
  team_probe="$team_probe_dir/$main_executable"
  ditto "$staged_app/Contents/MacOS/$main_executable" "$team_probe"
  codesign --force --sign "$codesign_identity" "$team_probe" >/dev/null
  signing_team_id=$(codesign -d --verbose=4 "$team_probe" 2>&1 | sed -n 's/^TeamIdentifier=//p' | sed -n '1p')
  rm -rf "$team_probe_dir"
  if [[ -z "$signing_team_id" || "$signing_team_id" == "not set" ]]; then
    echo "The selected signing identity does not provide a Team ID for App Group access." >&2
    exit 1
  fi
  if [[ -n "$team_id" && "$team_id" != "$signing_team_id" ]]; then
    echo "ZMANAGER_TEAM_ID does not match the selected signing identity." >&2
    exit 1
  fi
  team_id="${team_id:-$signing_team_id}"
else
  team_id="${team_id:-$official_team_id}"
fi
export ZMANAGER_TEAM_ID="$team_id"
export ZMANAGER_APP_GROUP_IDENTIFIER="$team_id.$app_group_name"
scripts/prepare-macos-self-contained-app.sh "$staged_app" "$architecture"

create_zip() {
  rm -f "$zip_artifact"
  run_packaging_step "create ZIP" ditto -c -k --sequesterRsrc --keepParent "$staged_app" "$zip_artifact"
  [[ -s "$zip_artifact" ]] || {
    echo "macOS ZIP was not created: $zip_artifact" >&2
    report_packaging_state
    exit 1
  }
}

create_dmg() {
  local image_root="$stage_dir/.$artifact_base-dmg-root"
  rm -rf "$image_root"
  mkdir -p "$image_root"
  run_packaging_step "stage application for DMG" ditto "$staged_app" "$image_root/ZManager.app"
  ln -s /Applications "$image_root/Applications"
  run_packaging_step "create DMG" hdiutil create -volname "ZManager" -srcfolder "$image_root" \
    -ov -format UDZO "$dmg_artifact"
  rm -rf "$image_root"
  [[ -s "$dmg_artifact" ]] || {
    echo "macOS DMG was not created: $dmg_artifact" >&2
    report_packaging_state
    exit 1
  }
  if [[ ${ZMANAGER_CODESIGN_IDENTITY:--} != - ]]; then
    codesign --force --timestamp --sign "$ZMANAGER_CODESIGN_IDENTITY" "$dmg_artifact"
  fi
}

create_zip
notary_profile=${ZMANAGER_NOTARY_PROFILE:-}
if [[ -n "$notary_profile" ]]; then
  [[ ${ZMANAGER_CODESIGN_IDENTITY:--} == Developer\ ID\ Application:* ]] || {
    echo "Notarization requires a Developer ID Application identity." >&2
    exit 1
  }
  xcrun notarytool submit "$zip_artifact" --keychain-profile "$notary_profile" --wait
  xcrun stapler staple "$staged_app"
  create_zip
fi

if [[ $bundle_kind != app ]]; then
  create_dmg
  if [[ -n "$notary_profile" ]]; then
    xcrun notarytool submit "$dmg_artifact" --keychain-profile "$notary_profile" --wait
    xcrun stapler staple "$dmg_artifact"
  fi
fi

gate_args=("$staged_app" --expected-arch "$architecture")
gate_args+=(--zip "$zip_artifact")
[[ ! -f $dmg_artifact ]] || gate_args+=(--dmg "$dmg_artifact")
if [[ -n "$notary_profile" ]]; then
  gate_args+=(--require-developer-id --require-notarization)
fi
scripts/release-gate-macos.sh "${gate_args[@]}"

if ((install_application)); then
  destination="$install_dir/ZManager.app"
  temporary="$install_dir/.ZManager.app.zmanager-install-$$"
  backup="$install_dir/.ZManager.app.zmanager-backup-$$"
  use_sudo=0
  [[ -d "$install_dir" && -w "$install_dir" ]] || use_sudo=1
  run_install() { if ((use_sudo)); then sudo "$@"; else "$@"; fi; }
  run_install mkdir -p "$install_dir"
  run_install rm -rf "$temporary" "$backup"
  run_install ditto "$staged_app" "$temporary"
  [[ ! -e "$destination" ]] || run_install mv "$destination" "$backup"
  if run_install mv "$temporary" "$destination"; then
    run_install rm -rf "$backup"
  else
    [[ ! -e "$backup" ]] || run_install mv "$backup" "$destination"
    echo "Unable to install the application at $destination." >&2
    exit 1
  fi
  echo "Installed application: $destination"
  codesign --verify --deep --strict "$destination"

  # Extension registration. PlugInKit derives its registry from the
  # LaunchServices database, so LaunchServices is the only lever worth pulling
  # here -- `pluginkit -a` / `-e use` edits are reverted by the next discovery
  # pass and must never be used to register a shipping build.
  #
  # Duplicate context-menu entries come from LaunchServices indexing MORE THAN
  # ONE bundle that carries the extensions. LaunchServices adds apps from almost
  # any accessible location, so the build's intermediate bundles have to be
  # retired explicitly; only the installed bundle may remain registered.
  installed_physical_path=$(cd "$destination" && pwd -P)
  unregister_launch_services_path() {
    local bundle_path="$1"
    local registration_count
    while :; do
      registration_count=$("$lsregister" -dump 2>/dev/null | awk -v target="$bundle_path" '
        $1 == "path:" {
          path = $0
          sub(/^[^:]+:[[:space:]]*/, "", path)
          sub(/[[:space:]]+\(0x[[:xdigit:]]+\)$/, "", path)
          if (path == target) count++
        }
        END { print count + 0 }
      ')
      ((registration_count > 0)) || break
      "$lsregister" -u "$bundle_path" 2>/dev/null || break
    done
  }
  for stale_bundle in \
    "$application" \
    "$staged_app" \
    "$stage_dir"/ZManager-*-"$architecture".app; do
    [[ -d "$stale_bundle" ]] || continue
    [[ $(cd "$stale_bundle" && pwd -P) != "$installed_physical_path" ]] || continue
    unregister_launch_services_path "$stale_bundle"
  done

  # A downloaded release DMG can leave its app and NSServices entry in the
  # LaunchServices database after the user copies ZManager.app to Applications
  # and ejects the image. That stale registration adds a second ZManager group
  # to Finder's context menu even though PlugInKit reports only one Finder Sync
  # provider. Remove every registration for the standard release-image path.
  stale_release_image_app="/Volumes/ZManager/ZManager.app"
  unregister_launch_services_path "$stale_release_image_app"
  "$lsregister" -f "$destination"

  # PlugInKit registers an appex only once its parent app has been run on this
  # Mac; installing the bundle is not sufficient. This headless launch performs
  # that first run, provisions the App Group container the Finder Sync extension
  # delivers requests through, and exits without showing UI.
  # -n forces a fresh instance so this never waits on an app the user already
  # has open; the --postinstall branch exits before any window is created.
  echo "Running postinstall registration for $destination"
  if ! open -n -W -a "$destination" --args --postinstall; then
    echo "Postinstall registration failed for $destination" >&2
    exit 1
  fi
  # The unsigned Tauri bundle is only a staging source. Keeping it under the
  # indexed project tree lets LaunchServices rediscover it after an unregister
  # and adds a second ZManager app registration. The prepared copy is already
  # installed, so retire the intermediate bundle before the final registry gate.
  rm -rf "$application"
  unregister_launch_services_path "$application"
  # The postinstall launch can trigger LaunchServices discovery again. Prune
  # intermediate bundles a second time before asserting the final registry.
  for stale_bundle in \
    "$application" \
    "$staged_app" \
    "$stage_dir"/ZManager-*-"$architecture".app; do
    [[ -d "$stale_bundle" ]] || continue
    [[ $(cd "$stale_bundle" && pwd -P) != "$installed_physical_path" ]] || continue
    unregister_launch_services_path "$stale_bundle"
  done
  unregister_launch_services_path "$stale_release_image_app"
  scripts/verify-macos-extension-registration.sh "$destination"
  echo "Postinstall completed for $destination"
else
  echo "Skipping application install because --no-install was set."
fi

echo "macOS $architecture artifacts are ready under: $stage_dir"
