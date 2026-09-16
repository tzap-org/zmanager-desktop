#!/usr/bin/env bash
set -euo pipefail

# Verify that macOS shell integration is registered exactly once.
#
# Duplicate Finder context-menu entries are caused by LaunchServices indexing
# more than one bundle that carries the extensions, not by an extension
# registering itself twice. LaunchServices adds applications from almost any
# accessible location, so intermediate build products can silently become a
# second Finder Sync provider alongside the installed application.
#
# This gate asserts the end state the install step is supposed to produce:
#   * exactly one registered bundle carries the Finder Sync extension, and
#   * that bundle is the installed application, and
#   * PlugInKit has it in its registry.
#
# PlugInKit's registry is derived from the LaunchServices database, and appexes
# are only registered once their parent application has been run on this Mac.
# The enabled/disabled state is a user setting owned by System Settings and is
# deliberately neither read as a pass condition nor modified here.

if [[ $# != 1 ]]; then
  echo "usage: $0 INSTALLED_APPLICATION_BUNDLE" >&2
  exit 2
fi

application=$1
[[ -d "$application" && -f "$application/Contents/Info.plist" ]] || {
  echo "invalid application bundle: $application" >&2
  exit 1
}

lsregister="${ZMANAGER_LSREGISTER:-/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister}"
pluginkit="${ZMANAGER_PLUGINKIT:-/usr/bin/pluginkit}"
finder_bundle_id=$(/usr/bin/python3 -c \
  "import json,sys; print(json.load(open(sys.argv[1]))['finderExtensionBundleIdentifier'])" \
  "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/packaging/macos/product-identity.json")

# Resolve to a physical path so the comparison below is not defeated by a
# symlinked install directory.
canonical_application=$(cd "$application" && pwd -P)

# Every registered bundle that contains a Finder Sync appex. Trailing bundle
# paths are reported by lsregister for the appexes themselves, so reduce each
# hit back to its enclosing .app.
registered_bundles=()
while IFS= read -r bundle; do
  [[ -n "$bundle" ]] || continue
  registered_bundles+=("$bundle")
done < <(
  "$lsregister" -dump 2>/dev/null \
    | grep -oE '/[^[:space:]]*\.app/Contents/PlugIns/ZManagerFinderExtension\.appex' \
    | sed 's#/Contents/PlugIns/ZManagerFinderExtension\.appex##' \
    | sort -u
)

if ((${#registered_bundles[@]} == 0)); then
  echo "No bundle carrying the Finder Sync extension is registered with LaunchServices." >&2
  echo "Expected: $canonical_application" >&2
  exit 1
fi

if ((${#registered_bundles[@]} > 1)); then
  echo "More than one registered bundle carries the Finder Sync extension." >&2
  echo "This is what produces duplicate entries in the Finder context menu." >&2
  printf '  %s\n' "${registered_bundles[@]}" >&2
  echo "Retire the unwanted paths with: $lsregister -u <path>" >&2
  exit 1
fi

if [[ ${registered_bundles[0]} != "$canonical_application" ]]; then
  echo "The registered Finder Sync provider is not the installed application." >&2
  echo "  registered: ${registered_bundles[0]}" >&2
  echo "  installed:  $canonical_application" >&2
  exit 1
fi

# PlugInKit discovery is asynchronous. Poll briefly rather than assuming the
# registry has caught up with the LaunchServices seeding the install triggered.
deadline=$((SECONDS + 10))
until "$pluginkit" -m -A -i "$finder_bundle_id" 2>/dev/null | grep -q .; do
  if ((SECONDS >= deadline)); then
    echo "PlugInKit has not registered $finder_bundle_id within 10s." >&2
    echo "The parent application must be run once before its appexes are registered." >&2
    exit 1
  fi
  sleep 1
done

echo "macOS extension registration verified: exactly one provider at $canonical_application"
