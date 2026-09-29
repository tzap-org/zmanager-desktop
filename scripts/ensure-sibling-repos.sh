#!/usr/bin/env bash
set -euo pipefail

# ensure-sibling-repos.sh — clone/update sibling repositories so that Cargo
# path dependencies resolve.
#
# Sibling repositories:
#   - tzap (https://github.com/tzap-org/tzap)
#   - zmanager (https://github.com/tzap-org/zmanager)
#   - localsend-rs (https://github.com/frankmanzhu/localsend-rs)
#   - forensic-vfs-engine (https://github.com/frankmanzhu/forensic-vfs-engine)
#   - iso9660-forensic (https://github.com/frankmanzhu/iso9660-forensic)
#
# Override defaults via environment variables:
#   ZMANAGER_TZAP_REPO                 – tzap repository URL
#   ZMANAGER_TZAP_REF                  – branch or tag to check out (default: main)
#   ZMANAGER_ZMANAGER_REPO             – zmanager repository URL
#   ZMANAGER_ZMANAGER_REF              – branch or tag to check out (default: main)
#   ZMANAGER_LOCALSEND_REPO            – localsend-rs repository URL
#   ZMANAGER_LOCALSEND_REF             – branch or tag to check out (default: main)
#   ZMANAGER_LOCALSEND_DIR             – absolute path for localsend-rs clone
#   ZMANAGER_FORENSIC_VFS_ENGINE_REPO  – forensic-vfs-engine repository URL
#   ZMANAGER_FORENSIC_VFS_ENGINE_REF   – branch or tag to check out (default: main)
#   ZMANAGER_ISO9660_FORENSIC_REPO     – iso9660-forensic repository URL
#   ZMANAGER_ISO9660_FORENSIC_REF      – branch or tag to check out (default: PR branch)
#   ZMANAGER_ISO9660_FORENSIC_DIR      – absolute path for iso9660-forensic clone
#
# Pass --skip-zmanager to skip cloning the zmanager sibling entirely.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
parent_dir="$(cd "$repo_root/.." && pwd)"

tzap_repo="${ZMANAGER_TZAP_REPO:-https://github.com/tzap-org/tzap}"
tzap_ref="${ZMANAGER_TZAP_REF:-main}"
tzap_dir="${ZMANAGER_TZAP_DIR:-$parent_dir/tzap}"

zmanager_repo="${ZMANAGER_ZMANAGER_REPO:-https://github.com/tzap-org/zmanager}"
zmanager_ref="${ZMANAGER_ZMANAGER_REF:-main}"
zmanager_dir="${ZMANAGER_ZMANAGER_DIR:-$parent_dir/zmanager}"

localsend_repo="${ZMANAGER_LOCALSEND_REPO:-https://github.com/frankmanzhu/localsend-rs}"
localsend_ref="${ZMANAGER_LOCALSEND_REF:-main}"
localsend_dir="${ZMANAGER_LOCALSEND_DIR:-$parent_dir/localsend-rs}"

forensic_vfs_engine_repo="${ZMANAGER_FORENSIC_VFS_ENGINE_REPO:-https://github.com/frankmanzhu/forensic-vfs-engine}"
forensic_vfs_engine_ref="${ZMANAGER_FORENSIC_VFS_ENGINE_REF:-main}"
forensic_vfs_engine_dir="${ZMANAGER_FORENSIC_VFS_ENGINE_DIR:-$parent_dir/forensic-vfs-engine}"

iso9660_forensic_repo="${ZMANAGER_ISO9660_FORENSIC_REPO:-https://github.com/frankmanzhu/iso9660-forensic}"
iso9660_forensic_ref="${ZMANAGER_ISO9660_FORENSIC_REF:-macos/fix-hybrid-session-selection}"
iso9660_forensic_dir="${ZMANAGER_ISO9660_FORENSIC_DIR:-$parent_dir/iso9660-forensic}"

skip_zmanager=0

usage() {
  cat <<'EOF'
Usage: scripts/ensure-sibling-repos.sh [--skip-zmanager]

Ensure all required sibling repositories exist and are updated to the latest
so that Cargo path dependencies in src-tauri/Cargo.toml and vendored crates resolve.

Options:
  --skip-zmanager  Skip zmanager sibling repository.
  -h, --help       Show this help.
EOF
}

while (($#)); do
  case "$1" in
    --skip-zmanager)
      skip_zmanager=1
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

ensure_sibling_repo() {
  local name="$1"
  local dir="$2"
  local repo="$3"
  local ref="$4"

  if [[ -d "$dir" ]]; then
    echo "$name sibling found at: $dir"
    if ! git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      echo "The existing $name path is not a Git worktree: $dir" >&2
      return 1
    fi
    echo "Updating $name repository at: $dir"
    if ! (
      # Sibling builds track branches by default. Do not fetch every release
      # tag: tags may be intentionally recreated upstream, and Git rejects
      # overwriting an existing local tag by default.
      git -C "$dir" fetch --prune --no-tags origin &&
      if git -C "$dir" show-ref --verify --quiet "refs/remotes/origin/$ref"; then
        if git -C "$dir" show-ref --verify --quiet "refs/heads/$ref"; then
          git -C "$dir" checkout "$ref"
        else
          git -C "$dir" checkout -b "$ref" --track "origin/$ref"
        fi &&
        # Rebase local commits onto the remote and temporarily stash tracked
        # edits so local development changes survive when Git can reapply them.
        git -C "$dir" pull --rebase --autostash --no-tags origin "$ref" &&
        ensure_no_unmerged_conflicts "$dir" "$name"
      else
        git -C "$dir" checkout "$ref"
      fi
    ); then
      echo "Unable to update $name at $dir; refusing to build." >&2
      return 1
    fi
  else
    echo "Cloning $name ($ref) into: $dir"
    git clone --depth 1 --branch "$ref" "$repo" "$dir"
    echo "$name clone complete."
  fi
}

ensure_no_unmerged_conflicts() {
  local dir="$1"
  local name="$2"
  local conflicts
  conflicts="$(git -C "$dir" diff --name-only --diff-filter=U)"
  if [[ -n "$conflicts" ]]; then
    echo "Git update left unresolved conflicts for $name at $dir:" >&2
    printf '%s\n' "$conflicts" >&2
    return 1
  fi
}

# ── zmanager-desktop ───────────────────────────────────────────────────

zmanager_desktop_dir="${ZMANAGER_DESKTOP_DIR:-$parent_dir/zmanager-desktop}"

if ! git -C "$repo_root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  :
elif ! git -C "$repo_root" symbolic-ref -q HEAD >/dev/null; then
  # Release/tag builds check out a detached HEAD; build exactly that commit.
  echo "zmanager-desktop is on a detached HEAD at $repo_root; skipping self-update."
else
  echo "Updating zmanager-desktop repository at: $repo_root"
  if ! git -C "$repo_root" pull --rebase --autostash ||
    ! ensure_no_unmerged_conflicts "$repo_root" "zmanager-desktop"; then
    echo "Unable to update zmanager-desktop at $repo_root; refusing to build." >&2
    exit 1
  fi
fi

if [[ "$zmanager_desktop_dir" != "$repo_root" ]] &&
  git -C "$zmanager_desktop_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Updating sibling zmanager-desktop at: $zmanager_desktop_dir"
  if ! git -C "$zmanager_desktop_dir" pull --rebase --autostash ||
    ! ensure_no_unmerged_conflicts "$zmanager_desktop_dir" "sibling zmanager-desktop"; then
    echo "Unable to update sibling zmanager-desktop at $zmanager_desktop_dir; refusing to build." >&2
    exit 1
  fi
fi

# ── tzap ───────────────────────────────────────────────────────────────
ensure_sibling_repo "tzap" "$tzap_dir" "$tzap_repo" "$tzap_ref"

# ── zmanager ───────────────────────────────────────────────────────────
if ((skip_zmanager)); then
  echo "Skipping zmanager sibling (--skip-zmanager)."
else
  ensure_sibling_repo "zmanager" "$zmanager_dir" "$zmanager_repo" "$zmanager_ref"
fi

# ── localsend-rs ────────────────────────────────────────────────────────
ensure_sibling_repo "localsend-rs" "$localsend_dir" "$localsend_repo" "$localsend_ref"

# ── forensic-vfs-engine ────────────────────────────────────────────────
ensure_sibling_repo "forensic-vfs-engine" "$forensic_vfs_engine_dir" "$forensic_vfs_engine_repo" "$forensic_vfs_engine_ref"

# ── iso9660-forensic ────────────────────────────────────────────────────
ensure_sibling_repo "iso9660-forensic" "$iso9660_forensic_dir" "$iso9660_forensic_repo" "$iso9660_forensic_ref"
