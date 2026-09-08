#!/usr/bin/env bash
set -euo pipefail

: "${DESKTOP_STAGING_E2E:?Set DESKTOP_STAGING_E2E=1 to run staging contact-sync E2E}"
: "${DESKTOP_STAGING_USER:?Set DESKTOP_STAGING_USER in the process environment}"
: "${DESKTOP_STAGING_PASSWORD:?Set DESKTOP_STAGING_PASSWORD in the process environment}"
: "${TZAP_DESKTOP_STAGING_CLIENT_ID:?Set the registered desktop staging OAuth client ID in the process environment}"
: "${DESKTOP_STAGING_EXPECTED_CONTACTS:?Set a redacted phone contact manifest path}"

npm run tauri build -- --debug --no-bundle --features hosted-online --config src-tauri/tauri.gui.conf.json
ZMANAGER_GUI_APP_PATH="$(pwd)/src-tauri/target/debug/zmanager-desktop" npm run test:gui:run -- --spec e2e/tauri/staging-contact-sync.spec.ts
