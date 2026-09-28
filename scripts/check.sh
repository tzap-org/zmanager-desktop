#!/usr/bin/env bash
set -uo pipefail

# check.sh — report uncommitted or unpushed work in zmanager-desktop and its
# sibling repositories (macOS/Linux counterpart of check.bat). Read-only.
#
# Checks zmanager-desktop, tzap, zmanager, localsend-rs, forensic-vfs-engine
# and iso9660-forensic for:
#   - uncommitted changes (staged, unstaged or untracked files)
#   - stash entries
#   - local branches with commits not pushed to their upstream
#   - local branches with no upstream
#   - a detached HEAD with commits not on any remote branch
#
# Sibling locations honour the same ZMANAGER_*_DIR overrides as
# ensure-sibling-repos.sh.
#
# Exits 0 when every repository is clean and pushed, 1 otherwise.

usage() {
  cat <<'EOF'
Usage: scripts/check.sh [fetch]

  check.sh          use local remote-tracking refs (fast, offline)
  check.sh fetch    fetch origin first so "behind" is also accurate
EOF
}

fetch=0
case "${1:-}" in
  "") ;;
  fetch|--fetch) fetch=1 ;;
  -h|--help) usage; exit 0 ;;
  *)
    echo "Error: Unexpected argument \"$1\"." >&2
    usage >&2
    exit 2
    ;;
esac
if (($# > 1)); then
  usage >&2
  exit 2
fi

if ! command -v git >/dev/null 2>&1; then
  echo "Git was not found. Install Git, or put git on PATH." >&2
  exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
parent_dir="$(cd "$repo_root/.." && pwd)"

repo_names=(zmanager-desktop tzap zmanager localsend-rs forensic-vfs-engine iso9660-forensic)
repo_dirs=(
  "$repo_root"
  "${ZMANAGER_TZAP_DIR:-$parent_dir/tzap}"
  "${ZMANAGER_ZMANAGER_DIR:-$parent_dir/zmanager}"
  "${ZMANAGER_LOCALSEND_DIR:-$parent_dir/localsend-rs}"
  "${ZMANAGER_FORENSIC_VFS_ENGINE_DIR:-$parent_dir/forensic-vfs-engine}"
  "${ZMANAGER_ISO9660_FORENSIC_DIR:-$parent_dir/iso9660-forensic}"
)

if [[ -t 1 ]]; then
  green=$'\033[32m'
  yellow=$'\033[33m'
  reset=$'\033[0m'
else
  green=""
  yellow=""
  reset=""
fi

max_listed_changes=15
issues=()

add_issue() {
  issues+=("$1")
}

# Collects problems for one repository into the global issues array.
collect_repo_issues() {
  local dir="$1"
  issues=()

  if [[ ! -e "$dir" ]]; then
    add_issue "missing: $dir"
    return
  fi
  if ! git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    add_issue "not a Git worktree: $dir"
    return
  fi

  if ((fetch)); then
    if ! git -C "$dir" fetch --prune --no-tags --quiet origin >/dev/null 2>&1; then
      add_issue "fetch from origin failed; remote state may be stale"
    fi
  fi

  local status count line
  status="$(git -C "$dir" status --porcelain=v1 --untracked-files=normal 2>/dev/null)" ||
    { add_issue "check failed: git status"; return; }
  if [[ -n "$status" ]]; then
    count="$(printf '%s\n' "$status" | wc -l | tr -d ' ')"
    add_issue "$count uncommitted change(s):"
    while IFS= read -r line; do
      add_issue "    $line"
    done < <(printf '%s\n' "$status" | head -n "$max_listed_changes")
    if ((count > max_listed_changes)); then
      add_issue "    ... and $((count - max_listed_changes)) more"
    fi
  fi

  local stashes
  stashes="$(git -C "$dir" stash list 2>/dev/null)"
  if [[ -n "$stashes" ]]; then
    count="$(printf '%s\n' "$stashes" | wc -l | tr -d ' ')"
    if ((count == 1)); then
      add_issue "1 stash entry"
    else
      add_issue "$count stash entries"
    fi
  fi

  local branch upstream track unpushed ahead behind
  while IFS='|' read -r branch upstream track; do
    [[ -z "$branch" ]] && continue
    if [[ -z "$upstream" ]]; then
      unpushed="$(git -C "$dir" rev-list --count "$branch" --not --remotes 2>/dev/null || echo 0)"
      if ((unpushed > 0)); then
        add_issue "branch '$branch' has no upstream ($unpushed commit(s) not on any remote)"
      fi
      continue
    fi
    if [[ "$track" == "[gone]" ]]; then
      add_issue "branch '$branch' tracks '$upstream', which no longer exists on the remote"
      continue
    fi
    read -r ahead behind < <(git -C "$dir" rev-list --left-right --count "$branch...$upstream" 2>/dev/null || echo "0 0")
    if ((ahead > 0)); then
      add_issue "branch '$branch' is $ahead commit(s) ahead of '$upstream' (not pushed)"
    fi
    if ((behind > 0)); then
      add_issue "branch '$branch' is $behind commit(s) behind '$upstream'"
    fi
  done < <(git -C "$dir" for-each-ref --format='%(refname:short)|%(upstream:short)|%(upstream:track)' refs/heads 2>/dev/null)

  if ! git -C "$dir" symbolic-ref -q HEAD >/dev/null 2>&1; then
    unpushed="$(git -C "$dir" rev-list --count HEAD --not --remotes 2>/dev/null || echo 0)"
    if ((unpushed > 0)); then
      add_issue "detached HEAD has $unpushed commit(s) not on any remote"
    fi
  fi
}

dirty_count=0
for i in "${!repo_names[@]}"; do
  name="${repo_names[$i]}"
  dir="${repo_dirs[$i]}"
  collect_repo_issues "$dir"

  head=""
  if [[ -e "$dir" ]]; then
    head="$(git -C "$dir" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    [[ -n "$head" ]] && head=" [$head]"
  fi

  if ((${#issues[@]} == 0)); then
    printf '%s[ OK ] %s%s%s\n' "$green" "$name" "$head" "$reset"
  else
    dirty_count=$((dirty_count + 1))
    printf '%s[WARN] %s%s  %s%s\n' "$yellow" "$name" "$head" "$dir" "$reset"
    for issue in "${issues[@]}"; do
      printf '       %s\n' "$issue"
    done
  fi
done

echo
if ((dirty_count == 0)); then
  printf '%sAll %d repositories are clean and pushed.%s\n' "$green" "${#repo_names[@]}" "$reset"
  exit 0
fi
printf '%s%d of %d repositories need attention.%s\n' "$yellow" "$dirty_count" "${#repo_names[@]}" "$reset"
exit 1
