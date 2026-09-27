#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
product_version=$(node -p 'require("./package.json").version')

test_root="$(mktemp -d)"
created_node_modules=0
cleanup() {
  rm -rf "$test_root"
  rm -f src-tauri/target/release/bundle/deb/ZManager_test_amd64.deb
  rm -f /tmp/zmanager-desktop-rpm/ZManager_test_x86_64.rpm
  if ((created_node_modules)); then
    rm -rf node_modules
  fi
}
trap cleanup EXIT

bin_dir="$test_root/bin"
log_file="$test_root/commands.log"
stage_dir="$test_root/stage"
mkdir -p "$bin_dir"
if [[ ! -d node_modules ]]; then
  mkdir -p node_modules
  created_node_modules=1
fi

write_stub() {
  local name="$1"
  shift
  cat >"$bin_dir/$name"
  chmod +x "$bin_dir/$name"
}

write_stub sudo <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'sudo %s\n' "$*" >>"${ZMANAGER_PACKAGING_TEST_LOG:?}"
if [[ "${1:-}" == "-n" ]]; then
  echo "sudo -n must not be used by --install-deps" >&2
  exit 92
fi
if [[ "${1:-}" == "-v" ]]; then
  exit 0
fi
if [[ "${1:-}" == "-E" ]]; then
  shift
fi
exec "$@"
EOF

write_stub apt-get <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'apt-get %s\n' "$*" >>"${ZMANAGER_PACKAGING_TEST_LOG:?}"
exit 0
EOF

write_stub node <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "-p" || "${1:-}" == "-e" ]]; then
  echo "${ZMANAGER_TEST_PRODUCT_VERSION:?}"
  exit 0
fi
echo "v24.0.0"
EOF

write_stub npm <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'npm %s\n' "$*" >>"${ZMANAGER_PACKAGING_TEST_LOG:?}"
if [[ "${1:-}" == "ls" ]]; then
  exit 1
fi
if [[ "$*" == "run tauri -- build --bundles deb" ]]; then
  mkdir -p src-tauri/target/release/bundle/deb
  printf 'test deb\n' >src-tauri/target/release/bundle/deb/ZManager_test_amd64.deb
  printf 'stale deb\n' >src-tauri/target/release/bundle/deb/ZManager_0.0.1_amd64.deb
fi
if [[ "$*" == *"run tauri -- build --bundles rpm"* ]]; then
  mkdir -p "${CARGO_TARGET_DIR:?}/release/bundle/rpm"
  printf 'test rpm\n' >"$CARGO_TARGET_DIR/release/bundle/rpm/ZManager_test_x86_64.rpm"
fi
EOF

write_stub rustc <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo "rustc 1.85.0 (test)"
EOF

write_stub cargo <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo "cargo 1.85.0 (test)"
EOF

write_stub pkg-config <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "--exists" ]]; then
  exit 0
fi
echo "pkg-config test stub"
EOF

write_stub cmake <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo "cmake version 3.22.0"
EOF

write_stub dpkg-deb <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "-f" ]]; then
  if [[ "${2:-}" == *"0.0.1"* ]]; then
    echo "0.0.1"
  else
    echo "${ZMANAGER_TEST_PRODUCT_VERSION:?}"
  fi
  exit 0
fi
echo "Debian dpkg-deb test stub"
EOF

write_stub curl <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'curl %s\n' "$*" >>"${ZMANAGER_PACKAGING_TEST_LOG:?}"
exit 1
EOF

write_stub git <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
subcommand="${1:-}"
if [[ "$subcommand" == "-C" ]]; then
  subcommand="${3:-}"
fi
if [[ "$subcommand" == "rev-list" ]]; then
  echo "1"
  exit 0
fi
if [[ "$subcommand" == "diff" ]]; then
  # scripts/ensure-sibling-repos.sh treats any output here as an unresolved
  # merge conflict; the stub has nothing to actually merge, so report none.
  exit 0
fi
echo "git test stub"
EOF

PATH="$bin_dir:$PATH" \
HOME="$test_root/home" \
ZMANAGER_PACKAGING_TEST_LOG="$log_file" \
ZMANAGER_TEST_PRODUCT_VERSION="$product_version" \
ZMANAGER_DEB_STAGE_DIR="$stage_dir" \
  bash scripts/build-linux-ubuntu-deb.sh --install-deps --skip-tests --no-install

if grep -q 'sudo -n' "$log_file"; then
  echo "Expected --install-deps not to use sudo -n." >&2
  exit 1
fi

if ! grep -q 'apt-get install -y .*pkg-config' "$log_file"; then
  echo "Expected --install-deps to install pkg-config explicitly." >&2
  exit 1
fi

ubuntu_install_line="$(grep '^apt-get install -y ' "$log_file")"
ubuntu_libarchive_packages=(
  libacl1-dev
  libbz2-dev
  libexpat1-dev
  liblz4-dev
  liblzma-dev
  libssl-dev
  libxml2-dev
  libzstd-dev
  zlib1g-dev
)
for package_name in "${ubuntu_libarchive_packages[@]}"; do
  if [[ " $ubuntu_install_line " != *" $package_name "* ]]; then
    echo "Expected --install-deps to install Ubuntu libarchive dependency $package_name." >&2
    exit 1
  fi
done

if ! grep -q 'npm install' "$log_file"; then
  echo "Expected incomplete node_modules to be repaired with npm install." >&2
  exit 1
fi

if [[ ! -f "$stage_dir/ZManager_test_amd64.deb" ]]; then
  echo "Expected the test .deb to be staged under the configured stage directory." >&2
  exit 1
fi

if [[ -f "$stage_dir/ZManager_0.0.1_amd64.deb" ]]; then
  echo "Expected the mismatched version .deb (0.0.1) to be skipped from staging." >&2
  exit 1
fi

: >"$log_file"

write_stub dnf <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'dnf %s\n' "$*" >>"${ZMANAGER_PACKAGING_TEST_LOG:?}"
exit 0
EOF

write_stub rpm <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'rpm %s\n' "$*" >>"${ZMANAGER_PACKAGING_TEST_LOG:?}"
if [[ "${1:-}" == "-qp" ]]; then
    echo "${ZMANAGER_TEST_PRODUCT_VERSION:?}"
  exit 0
fi
if [[ "${1:-}" == "-q" ]]; then
  exit 1
fi
exit 0
EOF

write_stub rpmbuild <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo "rpmbuild test stub"
EOF

fedora_target_dir="$test_root/fedora-target"
PATH="$bin_dir:$PATH" \
HOME="$test_root/home" \
CARGO_TARGET_DIR="$fedora_target_dir" \
ZMANAGER_PACKAGING_TEST_LOG="$log_file" \
ZMANAGER_TEST_PRODUCT_VERSION="$product_version" \
  bash scripts/build-linux-fedora-rpm.sh --install-deps --skip-tests --no-install

fedora_install_line="$(grep '^dnf install -y ' "$log_file")"
fedora_libarchive_packages=(
  bzip2-devel
  expat-devel
  libacl-devel
  libzstd-devel
  libxml2-devel
  lz4-devel
  openssl-devel
  xz-devel
  zlib-devel
)
for package_name in "${fedora_libarchive_packages[@]}"; do
  if [[ " $fedora_install_line " != *" $package_name "* ]]; then
    echo "Expected --install-deps to install Fedora libarchive dependency $package_name." >&2
    exit 1
  fi
done

if [[ " $fedora_install_line " == *" nodejs "* ]]; then
  echo "Expected nodejs not to be in default Fedora build package list (handled via NodeSource)." >&2
  exit 1
fi

if [[ ! -f /tmp/zmanager-desktop-rpm/ZManager_test_x86_64.rpm ]]; then
  echo "Expected the test .rpm to be staged under the RPM stage directory." >&2
  exit 1
fi

: >"$log_file"

write_stub node <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "-p" || "${1:-}" == "-e" ]]; then
  echo "${ZMANAGER_TEST_PRODUCT_VERSION:?}"
  exit 0
fi
# Simulate node version before upgrade, then return v24 after upgrade
if [[ -f "${ZMANAGER_TEST_NODE_UPGRADED:-}" ]]; then
  echo "v24.0.0"
else
  echo "v22.0.0"
fi
EOF

write_stub curl <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'curl %s\n' "$*" >>"${ZMANAGER_PACKAGING_TEST_LOG:?}"
if [[ "$*" == *"setup_24.x"* ]]; then
  echo "touch \"${ZMANAGER_TEST_NODE_UPGRADED:?}\""
  exit 0
fi
exit 1
EOF

node_upgrade_marker="$test_root/node-upgraded"
PATH="$bin_dir:$PATH" \
HOME="$test_root/home" \
CARGO_TARGET_DIR="$fedora_target_dir" \
ZMANAGER_PACKAGING_TEST_LOG="$log_file" \
ZMANAGER_TEST_PRODUCT_VERSION="$product_version" \
ZMANAGER_TEST_NODE_UPGRADED="$node_upgrade_marker" \
  bash scripts/build-linux-fedora-rpm.sh --install-deps --skip-tests --no-install

if ! grep -q 'curl -fsSL https://rpm.nodesource.com/setup_24.x' "$log_file"; then
  echo "Expected --install-deps to run NodeSource setup_24.x when Node.js is < 24." >&2
  exit 1
fi

if ! grep -q '^dnf install -y nodejs' "$log_file"; then
  echo "Expected --install-deps to install nodejs after NodeSource setup." >&2
  exit 1
fi

echo "Linux packaging script tests passed."
