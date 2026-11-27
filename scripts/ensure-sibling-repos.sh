#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mode="${ZMANAGER_BUILD_MODE:-local}"
lockfile=""
while (($#)); do
  case "$1" in
    --mode) mode="${2:?missing mode}"; shift ;;
    --lockfile) lockfile="${2:?missing lockfile}"; shift ;;
    -h|--help) echo "Usage: scripts/ensure-sibling-repos.sh [--mode local|snapshot|release] [--lockfile PATH]"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

args=(--mode "$mode")
[[ -n "$lockfile" ]] && args+=(--lockfile "$lockfile")
bash "$root/scripts/prepare-sibling-inputs.sh" "${args[@]}"
if [[ "$mode" == release ]]; then
  bash "$root/scripts/release-gate.sh" verify-build
fi

# Local builds use the current sibling manifests and may need to refresh the
# desktop lockfile. Keep that resolution offline so the local build does not
# silently select new registry releases. CI snapshots and releases must use
# their committed lockfiles without rewriting them.
if [[ -f "$root/src-tauri/Cargo.toml" ]]; then
  if [[ "$mode" == local ]]; then
    cargo tree --offline --all-features --target all --depth 0 --manifest-path "$root/src-tauri/Cargo.toml"
  else
    cargo tree --locked --all-features --target all --depth 0 --manifest-path "$root/src-tauri/Cargo.toml"
  fi
  sibling_zmanager="$(dirname "$root")/zmanager"
  if [[ -f "$sibling_zmanager/Cargo.lock" ]]; then
    node "$root/scripts/check-shared-dependency-locks.mjs" "$sibling_zmanager/Cargo.lock" "$root/src-tauri/Cargo.lock"
  fi
fi
