#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "Usage: $0 <artifact-path> <architecture> <product-version> [product-name]"
  exit 1
fi

artifact_path="$1"
architecture="$2"
product_version="$3"
product_name="${4:-ZManager}"

if [[ ! -f "$artifact_path" ]]; then
  echo "Artifact not found: $artifact_path" >&2
  exit 1
fi

sha256=$(sha256sum "$artifact_path" | awk '{print $1}')

case "$artifact_path" in
  *.deb) package_kind=deb; inspector=dpkg-deb; inspector_args=(-c) ;;
  *.rpm) package_kind=rpm; inspector=rpm; inspector_args=(-qlp) ;;
  *) echo "Unsupported package type: $artifact_path" >&2; exit 1 ;;
esac

inspect_contents() {
  # RPM can list file names from the header even with a truncated payload.
  if [[ "$package_kind" == rpm ]]; then
    rpm --checksig --nosignature "$artifact_path" || return
  fi
  "$inspector" "${inspector_args[@]}" "$artifact_path"
}

inspection_status="fail"
if ! command -v "$inspector" >/dev/null 2>&1; then
  inspection_details="$inspector is required to inspect package contents."
elif inspect_contents >/dev/null; then
  inspection_status="pass"
  inspection_details="$inspector successfully read package contents."
else
  inspection_details="$inspector failed to read package contents."
fi

cat <<EOF
{
  "productName": "$product_name",
  "productVersion": "$product_version",
  "os": "linux",
  "packageKind": "$package_kind",
  "architecture": "$architecture",
  "artifacts": [
    {
      "path": "$(realpath "$artifact_path")",
      "sha256": "$sha256"
    }
  ],
  "capabilities": [
    "shell-action-context-menu",
    "file-association",
    "system-file-icon"
  ],
  "inspection": {
    "status": "$inspection_status",
    "details": "$inspection_details"
  },
  "registration": {
    "status": "not-applicable",
    "details": "Registration is checked after installation."
  },
  "installedState": {},
  "exercisedScenarios": [],
  "normalizedFailures": [],
  "testCommand": "inspect-linux-package.sh"
}
EOF

[[ "$inspection_status" == pass ]]
