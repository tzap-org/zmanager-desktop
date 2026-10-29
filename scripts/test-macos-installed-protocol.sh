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
started_at_ms=$(python3 -c 'import time; print(int(time.time() * 1000))')
if ! dispatch_output=$(/usr/bin/open "tzap://auth/callback?state=macos-installed-protocol-test&handoff_code=invalid-test-code" 2>&1); then
  echo "LaunchServices rejected the tzap callback URL." >&2
  exit 1
fi
if printf '%s' "$dispatch_output" | rg -qi 'No application knows how to open URL|application not found|unable to find application'; then
  echo "No LaunchServices handler is registered for the tzap callback URL." >&2
  exit 1
fi
# A successful `open` only proves that LaunchServices found an application.
# Require delivery through the native inbox as well, using the server's real
# callback shape (the result discriminator is optional).
python3 - "${ZMANAGER_MACOS_DIAGNOSTIC_LOG:-$HOME/Library/Logs/org.tzap-org.zmanager/zmanager-diagnostics.log}" "$started_at_ms" <<'PY'
import json
import sys
import time
from pathlib import Path

log = Path(sys.argv[1])
started = int(sys.argv[2])
deadline = time.monotonic() + 15
while time.monotonic() < deadline:
    for line in log.read_text().splitlines() if log.exists() else []:
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if (event.get('timestampUnixMs', 0) >= started
                and event.get('scope') == 'nativeInbound'
                and event.get('name') == 'eventReceived'
                and event.get('fields', {}).get('kind') == 'hostedAuthCallback'):
            print('installed macOS tzap callback reached the native inbox')
            sys.exit(0)
    time.sleep(0.1)
sys.exit('LaunchServices opened the app but the hosted callback did not reach the native inbox.')
PY
echo "installed macOS tzap LaunchServices delivery passed for $app"
