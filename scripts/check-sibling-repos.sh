#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
lock="$root/release-build-inputs.lock"
fetch=0
strict=0

usage() {
  cat <<'EOF'
Usage: scripts/check-sibling-repos.sh [--fetch] [--strict]

Inspect the product checkout and every sibling listed in
release-build-inputs.lock. --fetch refreshes origin tracking refs.
--strict implies --fetch and fails for any dirty, unpushed, behind, detached,
missing-upstream, or fetch-error state.
EOF
}

while (($#)); do
  case "$1" in
    --fetch) fetch=1 ;;
    --strict) strict=1; fetch=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

[[ -f "$lock" ]] || { echo "Missing sibling inventory: $lock" >&2; exit 1; }
issues=0
normalize_url() { printf '%s' "${1%/}" | sed -E 's/\.git$//' | tr '[:upper:]' '[:lower:]'; }

inspect_repo() {
  local name="$1" dir="$2" expected_url="${3:-}" expected_branch="${4:-}"
  local branch head origin status stashes upstream counts ahead behind
  local repo_issues=0
  if [[ ! -d "$dir" ]] || ! git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    printf '[MISSING] %s (%s)\n' "$name" "$dir"
    ((issues+=1))
    return
  fi

  branch="$(git -C "$dir" branch --show-current 2>/dev/null || true)"
  head="$(git -C "$dir" rev-parse HEAD 2>/dev/null || echo unknown)"
  origin="$(git -C "$dir" remote get-url origin 2>/dev/null || true)"
  if [[ -n "$expected_url" && -n "$origin" && "$(normalize_url "$origin")" != "$(normalize_url "$expected_url")" ]]; then
    printf '  origin mismatch: expected %s, found %s\n' "$expected_url" "$origin"
    repo_issues=1
  elif [[ -n "$expected_url" && -z "$origin" ]]; then
    printf '  origin missing (expected %s)\n' "$expected_url"
    repo_issues=1
  fi
  if [[ -n "$expected_branch" && "$branch" != "$expected_branch" ]]; then
    printf '  branch mismatch: expected %s, found %s\n' "$expected_branch" "${branch:-DETACHED}"
    repo_issues=1
  fi
  if ((fetch)) && [[ -n "$origin" ]]; then
    if ! git -C "$dir" fetch --prune --no-tags origin; then
      printf '  fetch failed\n'
      repo_issues=1
    fi
  fi

  status="$(git -C "$dir" status --porcelain=v1 --untracked-files=all)"
  if [[ -n "$status" ]]; then
    printf '  dirty worktree:\n%s\n' "$status"
    repo_issues=1
  fi
  stashes="$(git -C "$dir" stash list)"
  if [[ -n "$stashes" ]]; then
    printf '  stash entries: %s\n' "$(printf '%s\n' "$stashes" | wc -l | tr -d ' ')"
    repo_issues=1
  fi
  if [[ -z "$branch" ]]; then
    printf '  detached HEAD at %s\n' "$head"
    repo_issues=1
  fi
  while IFS='|' read -r local_branch upstream; do
    [[ -n "$local_branch" ]] || continue
    if [[ -z "$upstream" ]]; then
      if [[ "$local_branch" == "$branch" ]]; then
        printf '  branch %s has no upstream\n' "$local_branch"
        repo_issues=1
      fi
      unpushed="$(git -C "$dir" rev-list --count "$local_branch" --not --remotes 2>/dev/null || echo 0)"
      if (( ${unpushed:-0} > 0 )); then
        printf '  branch %s has %s commit(s) not present on any remote\n' "$local_branch" "$unpushed"
        repo_issues=1
      fi
      continue
    fi
    if ! git -C "$dir" show-ref --verify --quiet "refs/remotes/$upstream"; then
      printf '  branch %s tracks missing remote ref %s\n' "$local_branch" "$upstream"
      repo_issues=1
      continue
    fi
    if [[ "$local_branch" == "$branch" && -n "$expected_branch" && "$upstream" != "origin/$expected_branch" ]]; then
      printf '  branch %s tracks %s; expected origin/%s\n' "$local_branch" "$upstream" "$expected_branch"
      repo_issues=1
    fi
    counts="$(git -C "$dir" rev-list --left-right --count "$local_branch...$upstream" 2>/dev/null || true)"
    ahead=0; behind=0
    read -r ahead behind <<< "$counts" || true
    ahead="${ahead:-0}"; behind="${behind:-0}"
    if ((ahead > 0)); then printf '  %s unpushed commit(s) on %s\n' "$ahead" "$local_branch"; repo_issues=1; fi
    if ((behind > 0)); then printf '  %s commit(s) behind %s on %s\n' "$behind" "$upstream" "$local_branch"; repo_issues=1; fi
  done < <(git -C "$dir" for-each-ref --format='%(refname:short)|%(upstream:short)' refs/heads)

  if ((repo_issues)); then
    printf '[WARN] %s [%s %s] %s\n' "$name" "${branch:-detached}" "${head:0:12}" "$dir"
    ((issues+=1))
  else
    printf '[ OK ] %s [%s %s]\n' "$name" "$branch" "${head:0:12}"
  fi
}

root_name="$(basename "$root")"
inspect_repo "$root_name" "$root"
parent="${ZMANAGER_SIBLING_PARENT_DIR:-$(dirname "$root")}"
while read -r name url branch sha extra; do
  [[ -z "${name:-}" || "$name" == \#* ]] && continue
  if [[ -n "${extra:-}" || ! "$name" =~ ^[a-z0-9][a-z0-9.-]*$ || ! "$url" =~ ^https?:// || ! "$branch" =~ ^[A-Za-z0-9._/-]+$ || ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Invalid release input lock entry: $name $url ${branch:-} ${sha:-}" >&2
    exit 1
  fi
  inspect_repo "$name" "$parent/$name" "$url" "$branch"
done < "$lock"

if ((issues)); then
  printf '\n%d repository/repositories need attention.\n' "$issues"
  ((strict)) && exit 1
else
  echo "All repositories are clean, pushed, and current with their upstreams."
fi
