#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 1 ]]; then
  echo "usage: $0 APPLICATION_BUNDLE" >&2
  exit 2
fi

app="$1"
[[ -d "$app" && -f "$app/Contents/Info.plist" ]] || {
  echo "invalid application bundle: $app" >&2
  exit 1
}

# This intentionally uses LaunchServices' default handler resolution. The
# callback is syntactically valid but carries no usable session secret, so it
# can only exercise registration and native launch delivery.
if ! dispatch_output=$(/usr/bin/open "tzap://auth/callback?state=macos-installed-protocol-test&result=completed&handoff_code=invalid-test-code" 2>&1); then
  echo "LaunchServices rejected the tzap callback URL." >&2
  exit 1
fi
if printf '%s' "$dispatch_output" | rg -qi 'No application knows how to open URL|application not found|unable to find application'; then
  echo "No LaunchServices handler is registered for the tzap callback URL." >&2
  exit 1
fi
echo "installed macOS tzap LaunchServices dispatch passed for $app"
