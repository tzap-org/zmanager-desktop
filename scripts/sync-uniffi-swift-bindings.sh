#!/usr/bin/env bash
set -euo pipefail

# sync-uniffi-swift-bindings.sh — copy the generated UniFFI Swift bindings from
# the sibling zmanager checkout into the native/macos Swift package.
#
# The generated bindings live in the zmanager repo
# (crates/zmanager-ffi/bindings/swift) and are copied here at build time so the
# extensions always consume the committed, CI-verified bindings; nothing
# generated is committed in this repo (see .gitignore). Run this before
# `swift build` / `swift test --package-path native/macos`.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
zmanager="${ZMANAGER_ZMANAGER_DIR:-$(cd "$repo_root/.." && pwd)/zmanager}"
source_dir="$zmanager/crates/zmanager-ffi/bindings/swift"
package="$repo_root/native/macos"

test -d "$source_dir" || {
  echo "UniFFI Swift bindings not found at $source_dir (clone the sibling zmanager repo)" >&2
  exit 1
}

mkdir -p "$package/Sources/ZManagerUniFFI" "$package/Sources/zmanagerFFI/include"
cp "$source_dir/zmanager.swift" "$package/Sources/ZManagerUniFFI/zmanager.swift"
cp "$source_dir/zmanagerFFI.h" "$package/Sources/zmanagerFFI/include/zmanagerFFI.h"

# Xcode 27's build system requires every C target to produce an object file.
# zmanagerFFI is header-only (the implementation is linked from
# libzmanager_ffi.a), so without a translation unit libtool fails with
# "Build input file cannot be found: .../zmanagerFFI.o". Emit an empty .c so
# the target always compiles to something.
printf '// Intentionally empty: zmanagerFFI is a header-only module whose\n// implementation is linked statically from libzmanager_ffi.a.\n' \
  > "$package/Sources/zmanagerFFI/zmanagerFFI.c"
echo "Synced UniFFI Swift bindings from $source_dir"
