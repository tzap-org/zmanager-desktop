#!/usr/bin/env sh
set -eu

TAG="${1:-v2.1.7}"
REPO="${2:-https://github.com/tzap-org/zmanager}"
CARGO_FILE="${3:-src-tauri/Cargo.toml}"

pattern='s|zmanager-core\\s*=\\s*\\{\\s*path\\s*=\\s*"[^"]*"\\s*\\}|zmanager-core = { git = "'"$REPO"'", tag = "'"$TAG"'", package = "zmanager-core" }|'

if ! grep -qE 'zmanager-core\s*=\s*\{\s*path\s*=\s*"[^"]*"\s*\}' "$CARGO_FILE"; then
  echo "No path-based zmanager-core dependency found in $CARGO_FILE"
  exit 1
fi

perl -0pi -e "$pattern" "$CARGO_FILE"
echo "Pinned zmanager-core to $REPO with tag $TAG in $CARGO_FILE"
