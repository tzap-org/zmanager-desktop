#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
export ZMANAGER_TZAP_BUILD_ENV=staging
export ZMANAGER_TZAP_SERVER_BASE_URL=https://staging.tzap.org
export VITE_TZAP_BUILD_ENV=staging

npm run test:frontend
cd src-tauri
cargo fmt --check
cargo clippy --release --all-targets --all-features -- -D warnings
cargo test --release
