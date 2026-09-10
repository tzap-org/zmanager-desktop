#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

# GUI/E2E tests are staging-only. Keep the compile-time Rust policy and the
# frontend build mode aligned with the runner's runtime environment guard.
export TZAP_E2E_ENV=staging
export VITE_TZAP_BUILD_ENV=staging
export ZMANAGER_TZAP_BUILD_ENV=staging
export ZMANAGER_TZAP_SERVER_BASE_URL=https://staging.tzap.org

target_dir="${CARGO_TARGET_DIR:-src-tauri/target}"
gui_config="src-tauri/tauri.gui.conf.json"
gui_binary="$target_dir/debug/zmanager-desktop"

echo "Building Linux GUI test binary..."
npm run tauri build -- --debug --no-bundle --config "$gui_config"

if [[ ! -f "$gui_binary" ]]; then
  echo "Error: Debug GUI binary was not created at $gui_binary" >&2
  exit 1
fi

export ZMANAGER_GUI_APP_PATH="$(cd "$(dirname "$gui_binary")" && pwd)/$(basename "$gui_binary")"
echo "Running native Linux GUI tests against $ZMANAGER_GUI_APP_PATH"
npm run test:gui:run
