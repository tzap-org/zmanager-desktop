#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
parent="${ZMANAGER_SIBLING_PARENT_DIR:-$(dirname "$root")}"
mode="${1:-verify}"
lock="$root/release-build-inputs.lock"
check="$root/scripts/check-sibling-repos.sh"
update="$root/scripts/update-release-build-inputs.sh"

usage() { echo "Usage: scripts/release-gate.sh prepare|verify|verify-build"; }
case "$mode" in prepare|verify|verify-build) ;; -h|--help) usage; exit 0 ;; *) usage >&2; exit 2 ;; esac

lock_entry() {
  awk -v wanted="$1" '$1 == wanted { print $2 " " $4; found=1 } END { if (!found) exit 1 }' "$lock"
}

require_tagged_commit() {
  local name="$1" dir="$parent/$1" url sha tags
  read -r url sha <<< "$(lock_entry "$name")" || { echo "Release lock is missing $name" >&2; return 1; }
  git -C "$dir" fetch --tags --no-recurse-submodules origin
  tags="$(git -C "$dir" tag --points-at "$sha" --list 'v*')"
  [[ -n "$tags" ]] || { echo "$name commit $sha has no v* release tag" >&2; return 1; }
  printf '%s release tag(s): %s (%s)\n' "$name" "$(printf '%s' "$tags" | tr '\n' ' ')" "$sha"
}

verify_release_order() {
  require_tagged_commit tzap
  require_tagged_commit zmanager
}
package_lock_version() {
  awk -v wanted="$1" '$0 == "[[package]]" { in_package=0 } $0 == "name = \"" wanted "\"" { in_package=1; next } in_package && /^version = / { gsub(/"/, "", $3); print $3; exit }' "$2"
}
verify_controlled_release_versions() {
  local tzap_sha zmanager_sha tzap_tag zmanager_tag tzap_version zmanager_version resolved
  read -r _ tzap_sha <<< "$(lock_entry tzap)"
  read -r _ zmanager_sha <<< "$(lock_entry zmanager)"
  tzap_version="$(package_lock_version tzap-core "$root/src-tauri/Cargo.lock")"
  zmanager_version="$(package_lock_version zmanager-core "$root/src-tauri/Cargo.lock")"
  [[ -n "$tzap_version" && -n "$zmanager_version" ]] || { echo "Cargo.lock is missing a controlled TZAP or ZManager package" >&2; return 1; }
  tzap_tag="v$tzap_version"; zmanager_tag="v$zmanager_version"
  [[ "$(git -C "$parent/tzap" rev-parse -q --verify "refs/tags/$tzap_tag^{commit}" 2>/dev/null || true)" == "$tzap_sha" ]] || { echo "TZAP lock commit $tzap_sha must have release tag $tzap_tag" >&2; return 1; }
  [[ "$(git -C "$parent/zmanager" rev-parse -q --verify "refs/tags/$zmanager_tag^{commit}" 2>/dev/null || true)" == "$zmanager_sha" ]] || { echo "ZManager lock commit $zmanager_sha must have release tag $zmanager_tag" >&2; return 1; }
  for package in tzap-core tzap-plugin-keywrap tzap-plugin-signing; do
    resolved="$(package_lock_version "$package" "$root/src-tauri/Cargo.lock")"
    [[ "$resolved" == "$tzap_version" ]] || { echo "$package resolves to ${resolved:-<missing>}; expected released TZAP $tzap_tag" >&2; return 1; }
  done
  for package in zmanager-core zmanager-tzap-hosted zmanager-localsend; do
    resolved="$(package_lock_version "$package" "$root/src-tauri/Cargo.lock")"
    [[ "$resolved" == "$zmanager_version" ]] || { echo "$package resolves to ${resolved:-<missing>}; expected released ZManager $zmanager_tag" >&2; return 1; }
  done
  echo "Cargo.lock matches released TZAP $tzap_tag and ZManager $zmanager_tag."
}
verify_product_release_tag() {
  local tag="${ZMANAGER_RELEASE_TAG:-}" tag_commit product_commit expected_version product_version
  [[ -n "$tag" ]] || return 0
  tag_commit="$(git -C "$root" rev-parse -q --verify "refs/tags/$tag^{commit}" 2>/dev/null || true)"
  product_commit="$(git -C "$root" rev-parse HEAD)"
  [[ -n "$tag_commit" && "$tag_commit" == "$product_commit" ]] || { echo "Product checkout $product_commit does not match release tag $tag" >&2; return 1; }
  expected_version="${tag#v}"
  product_version="$(node -e 'console.log(require(process.argv[1]).version)' "$root/package.json")"
  [[ "$product_version" == "$expected_version" ]] || { echo "package.json version $product_version does not match release tag $tag" >&2; return 1; }
  echo "Desktop checkout and package version match release tag $tag."
}

case "$mode" in
  prepare)
    bash "$check" --strict
    bash "$update" --write
    verify_release_order
    verify_controlled_release_versions
    echo "Review, commit, and push release-build-inputs.lock, then run scripts/release-gate.sh verify before tagging desktop."
    ;;
  verify)
    bash "$check" --strict
    bash "$update" --check
    git -C "$root" diff --quiet HEAD -- release-build-inputs.lock || { echo "release-build-inputs.lock must be committed and pushed before tagging" >&2; exit 1; }
    verify_release_order
    verify_controlled_release_versions
    echo "Release inputs are clean, current, pushed, tagged, and ready for the desktop release tag."
    ;;
  verify-build)
    root_dirty="$(git -C "$root" status --porcelain=v1 --untracked-files=all)"
    [[ -z "$root_dirty" ]] || { printf 'Product checkout is dirty:\n%s\n' "$root_dirty" >&2; exit 1; }
    while read -r name url branch sha extra; do
      [[ -z "${name:-}" || "$name" == \#* ]] && continue
      dir="$parent/$name"
      actual="$(git -C "$dir" rev-parse HEAD)"
      origin="$(git -C "$dir" remote get-url origin)"
      [[ "$actual" == "$sha" ]] || { echo "$name is at $actual, expected locked commit $sha" >&2; exit 1; }
      [[ "${origin%.git}" == "${url%.git}" ]] || { echo "$name origin differs from the release lock" >&2; exit 1; }
      [[ -z "$(git -C "$dir" status --porcelain=v1 --untracked-files=all)" ]] || { echo "$name checkout is dirty" >&2; exit 1; }
    done < "$lock"
    verify_release_order
    verify_controlled_release_versions
    verify_product_release_tag
    echo "Tagged desktop build inputs match the committed release lock."
    ;;
esac
