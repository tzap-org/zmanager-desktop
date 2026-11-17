#!/usr/bin/env bash

# Source this file after ensure-sibling-repos.sh, then call
# zmanager_configure_pinned_openssl with the Rust target being built.
zmanager_configure_pinned_openssl() {
  local target="${1:-}"
  local repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  local builder="$(cd "$repo_root/.." && pwd)/zmanager/scripts/build-openssl.py"

  if [[ -z "$target" ]]; then
    target="$(rustc -vV | sed -n 's/^host: //p')"
  fi
  if [[ ! -f "$builder" ]]; then
    echo "Pinned ZManager OpenSSL builder is missing: $builder. Run scripts/ensure-sibling-repos.sh first." >&2
    return 1
  fi

  local python_bin="${PYTHON:-python3}"
  local openssl_dir
  openssl_dir="$("$python_bin" "$builder" "$target")"
  local notice="$openssl_dir/THIRD-PARTY-NOTICES.txt"
  if [[ ! -f "$notice" ]] || ! grep -Fq "OpenSSL 3.5.9" "$notice" || \
    ! grep -Fq "e08c7ad5e3f31488eb622515da4434a858038873b07fa1f021271c98bed8e2fe" "$notice"; then
    echo "Pinned OpenSSL 3.5.9 build did not produce its patch notice: $openssl_dir" >&2
    return 1
  fi

  export OPENSSL_DIR="$openssl_dir"
  export OPENSSL_STATIC=1
  export OPENSSL_NO_VENDOR=1
  if [[ -n "${GITHUB_ENV:-}" ]]; then
    printf '%s\n' "OPENSSL_DIR=$OPENSSL_DIR" OPENSSL_STATIC=1 OPENSSL_NO_VENDOR=1 >> "$GITHUB_ENV"
  fi
}
