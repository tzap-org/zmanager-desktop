#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

install_deps=0
skip_tests=0
allow_non_baseline=0
install_package=1
build_profile="local"

usage() {
  cat <<'EOF'
Usage: scripts/build-linux-fedora-rpm.sh [--install-deps] [--skip-tests] [--allow-non-baseline] [--no-install] [--profile local|online]

Builds the Fedora .rpm distribution package with Tauri, stages it under
/tmp/zmanager-desktop-rpm, and installs or reinstalls the staged package through
dnf.

Release baseline:
  Build release .rpm artifacts on Fedora. The RPM metadata uses Fedora package
  names, including nautilus-python for the GNOME Files extension host.

Fedora prerequisites:
  sudo dnf install ca-certificates cmake curl file gcc gcc-c++ make pkgconf-pkg-config openssl-devel webkit2gtk4.1-devel libsoup3-devel gtk3-devel libappindicator-gtk3-devel librsvg2-devel libxdo-devel bzip2-devel expat-devel libacl-devel lz4-devel xz-devel libzstd-devel zlib-devel libxml2-devel rpm-build patchelf nautilus-python perl-IPC-Cmd
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo -E bash -
  sudo dnf install nodejs

Options:
  --install-deps  Install required Fedora build packages, Node.js, and Rust.
  --skip-tests    Skip frontend and Rust tests before packaging.
  --allow-non-baseline
                  Allow local/test builds outside Fedora (retained for compatibility).
  --no-install    Build and stage the .rpm without reinstalling it.
  --profile VALUE Build the local (offline) or online profile. Default: local.
  -h, --help      Show this help.
EOF
}

while (($#)); do
  case "$1" in
    --install-deps)
      install_deps=1
      ;;
    --skip-tests)
      skip_tests=1
      ;;
    --allow-non-baseline)
      allow_non_baseline=1
      ;;
    --no-install)
      install_package=0
      ;;
    --profile)
      if (($# < 2)); then
        echo "--profile requires local or online." >&2
        exit 2
      fi
      build_profile="$2"
      shift
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

case "$build_profile" in
  local|online)
    ;;
  *)
    echo "Unsupported profile: $build_profile (expected local or online)." >&2
    exit 2
    ;;
esac

check_release_baseline() {
  local os_id="" pretty_name=""
  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    os_id="${ID:-}"
    pretty_name="${PRETTY_NAME:-}"
  fi

  if [[ "$os_id" == "fedora" ]]; then
    return
  fi

  echo "Warning: building outside the Fedora RPM release baseline: ${pretty_name:-unknown OS}" >&2
  echo "Use this package for local testing only; build release .rpm artifacts on Fedora." >&2
}

check_release_baseline

fedora_packages=(
  git
  ripgrep
  ca-certificates
  clang
  clang-devel
  cmake
  curl
  file
  gcc
  gcc-c++
  make
  pkgconf-pkg-config
  openssl-devel
  webkit2gtk4.1-devel
  libsoup3-devel
  gtk3-devel
  libappindicator-gtk3-devel
  librsvg2-devel
  libxdo-devel
  bzip2-devel
  expat-devel
  libacl-devel
  lz4-devel
  xz-devel
  libzstd-devel
  zlib-devel
  libxml2-devel
  rpm-build
  patchelf
  nautilus-python
  perl-IPC-Cmd
  python3
)

collect_missing_fedora_packages() {
  local package_name
  missing_fedora_packages=()
  for package_name in "${fedora_packages[@]}"; do
    if ! rpm -q "$package_name" >/dev/null 2>&1; then
      missing_fedora_packages+=("$package_name")
    fi
  done
}

run_dnf_install() {
  if ((EUID == 0)); then
    dnf install -y "$@"
  else
    sudo dnf install -y "$@"
  fi
}

run_dnf_remove() {
  if ((EUID == 0)); then
    dnf remove -y "$@"
  else
    sudo dnf remove -y "$@"
  fi
}

source_cargo_env() {
  if [[ -f "$HOME/.cargo/env" ]]; then
    # shellcheck disable=SC1091
    . "$HOME/.cargo/env"
  fi
}

source_cargo_env

version_major() {
  "$1" --version | sed -E 's/^[^0-9]*([0-9]+).*/\1/'
}

version_minor() {
  "$1" --version | sed -E 's/^[^0-9]*[0-9]+\.([0-9]+).*/\1/'
}

node_install_required() {
  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    return 0
  fi

  local node_major
  node_major="$(version_major node)"
  [[ -z "$node_major" || "$node_major" -lt 24 ]]
}

run_nodesource_setup() {
  if ((EUID == 0)); then
    curl -fsSL https://rpm.nodesource.com/setup_24.x | bash -
  else
    curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo -E bash -
  fi
}

rust_install_required() {
  if ! command -v cargo >/dev/null 2>&1 || ! command -v rustc >/dev/null 2>&1; then
    return 0
  fi

  local rust_major rust_minor
  rust_major="$(version_major rustc)"
  rust_minor="$(version_minor rustc)"
  [[ -z "$rust_major" || -z "$rust_minor" || "$rust_major" -lt 1 || ("$rust_major" -eq 1 && "$rust_minor" -lt 85) ]]
}

collect_missing_commands() {
  local command_name
  missing_commands=()
  required_commands=(git node npm cargo rustc pkg-config rpmbuild rpm cmake)
  if ((install_package)); then
    required_commands+=(dnf)
    if ((EUID != 0)); then
      required_commands+=(sudo)
    fi
  fi
  for command_name in "${required_commands[@]}"; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
      missing_commands+=("$command_name")
    fi
  done
}

if ((install_deps)); then
  if ! command -v dnf >/dev/null 2>&1; then
    echo "Installing Fedora packages requires dnf." >&2
    exit 1
  fi

  if ((EUID != 0)) && ! command -v sudo >/dev/null 2>&1; then
    echo "Installing Fedora packages requires sudo or a root shell." >&2
    echo "Run as root or install these packages first:" >&2
    echo "  dnf install ${fedora_packages[*]}" >&2
    exit 1
  fi

  collect_missing_fedora_packages
  if ((${#missing_fedora_packages[@]})); then
    echo "Installing missing Fedora package(s): ${missing_fedora_packages[*]}"
    run_dnf_install "${missing_fedora_packages[@]}"
  else
    echo "Fedora build packages are already installed."
  fi

  if node_install_required; then
    run_nodesource_setup
    conflicting_pkgs=()
    while IFS= read -r pkg; do
      [[ -n "$pkg" ]] && conflicting_pkgs+=("$pkg")
    done < <(rpm -qa "nodejs2[0-3]*" "nodejs1*" "nodejs-*" 2>/dev/null || true)
    if ((${#conflicting_pkgs[@]})); then
      run_dnf_remove "${conflicting_pkgs[@]}" 2>/dev/null || true
    fi
    if rpm -q nodejs >/dev/null 2>&1; then
      current_node_major="$(version_major node 2>/dev/null || echo "")"
      if [[ -n "$current_node_major" && "$current_node_major" -lt 24 ]]; then
        run_dnf_remove nodejs npm 2>/dev/null || true
      fi
    fi
    run_dnf_install nodejs
  fi

  if rust_install_required; then
    echo "Installing or updating Rust with rustup."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source_cargo_env
  fi
fi

collect_missing_commands
if ((${#missing_commands[@]})); then
  echo "Missing required command(s): ${missing_commands[*]}" >&2
  echo "Install Node.js, Rust, and Fedora packaging prerequisites, then rerun." >&2
  echo "Or run: scripts/build-linux-fedora-rpm.sh --install-deps" >&2
  echo "Fedora packages: sudo dnf install ${fedora_packages[*]}" >&2
  echo "Rust: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh" >&2
  echo "Node.js: curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo -E bash - && sudo dnf install nodejs" >&2
  exit 1
fi

required_pkg_config_packages=(
  gtk+-3.0
  libsoup-3.0
  webkit2gtk-4.1
)
missing_pkg_config_packages=()
for package_name in "${required_pkg_config_packages[@]}"; do
  if ! pkg-config --exists "$package_name"; then
    missing_pkg_config_packages+=("$package_name")
  fi
done

if ((${#missing_pkg_config_packages[@]})); then
  echo "Missing required pkg-config package(s): ${missing_pkg_config_packages[*]}" >&2
  echo "Install Fedora packaging prerequisites, then rerun:" >&2
  echo "  sudo dnf install ${fedora_packages[*]}" >&2
  echo "Or run: scripts/build-linux-fedora-rpm.sh --install-deps" >&2
  exit 1
fi

rust_major="$(version_major rustc)"
rust_minor="$(version_minor rustc)"
if ((rust_major < 1 || (rust_major == 1 && rust_minor < 85))); then
  echo "Rust 1.85 or newer is required for the Rust 2024 edition used by src-tauri/Cargo.toml." >&2
  echo "Current rustc: $(rustc --version)" >&2
  echo "Install or select a current toolchain, for example: rustup update stable" >&2
  exit 1
fi

node_major="$(version_major node)"
echo "Using Node.js: $(node --version)"
if ((node_major != 24)); then
  echo "Node.js 24 is required for the release build." >&2
  echo "Current node: $(node --version)" >&2
  echo "Install Node.js 24 or ensure actions/setup-node is first on PATH." >&2
  exit 1
fi

npm_install_required() {
  if [[ ! -d node_modules ]]; then
    return 0
  fi

  # Exit 1 when any declared dependency is missing or mismatched (stale tree).
  ! npm ls --depth=0 >/dev/null 2>&1
}

if npm_install_required; then
  npm install
fi

scripts/ensure-sibling-repos.sh

cargo_target_dir="${CARGO_TARGET_DIR:-$repo_root/src-tauri/target}"
if [[ -e "$cargo_target_dir" && ! -w "$cargo_target_dir" ]]; then
  if [[ -n "${CARGO_TARGET_DIR:-}" ]]; then
    echo "Cargo target directory is not writable: $cargo_target_dir" >&2
    echo "Choose a writable CARGO_TARGET_DIR or fix its ownership, then rerun." >&2
    exit 1
  fi

  cargo_target_dir="/tmp/zmanager-desktop-cargo-target-${UID:-$(id -u)}"
  echo "Default Cargo target directory is not writable; using $cargo_target_dir"
fi
install -d -m 0755 "$cargo_target_dir"
export CARGO_TARGET_DIR="$cargo_target_dir"
export OPENSSL_NO_VENDOR="${OPENSSL_NO_VENDOR:-1}"

if ((!skip_tests)); then
  npm run test:frontend
  (cd src-tauri && cargo fmt --check)
  (cd src-tauri && cargo clippy --release --all-targets --all-features -- -D warnings)
  (cd src-tauri && cargo test --release)
fi

cargo_target_dir="${CARGO_TARGET_DIR:-$repo_root/src-tauri/target}"
rm -rf "$cargo_target_dir/release/bundle/rpm"

build_number="${ZMANAGER_BUILD_NUMBER:-$(git rev-list --count HEAD 2>/dev/null || echo 1)}"
architecture="$(uname -m)"
os_label="Linux"
build_id="${os_label}-${architecture}-${build_profile}-${build_number}"
export ZMANAGER_BUILD_NUMBER="$build_number"
export ZMANAGER_BUILD_ID="$build_id"
export ZMANAGER_TZAP_BUILD_ENV="${ZMANAGER_TZAP_BUILD_ENV:-prod}"
export VITE_TZAP_BUILD_ENV="$ZMANAGER_TZAP_BUILD_ENV"
export VITE_ZMANAGER_PROFILE="$build_profile"
if [[ "$build_profile" == online ]]; then
  export VITE_ENABLE_HOSTED_CAPABILITIES=true
  tauri_profile_args=(-- --no-default-features --features online-profile)
else
  export VITE_ENABLE_HOSTED_CAPABILITIES=false
  tauri_profile_args=(-- --no-default-features)
fi
echo "Build: ${build_id}"

# Use Vite's runner config loader for Fedora packaging so a root-owned
# node_modules/.vite-temp cache from a previous sudo build does not break Tauri's
# beforeBuildCommand.
tauri_args=(build --bundles rpm --config '{"build":{"beforeBuildCommand":"npm run build -- --configLoader runner"}}')
npm run tauri -- "${tauri_args[@]}" "${tauri_profile_args[@]}"

product_version=$(node -p 'require("./package.json").version')
dnf_stage_dir="${ZMANAGER_RPM_STAGE_DIR:-/tmp/zmanager-desktop-rpm}"
rm -rf "$dnf_stage_dir"
install -d -m 0755 "$dnf_stage_dir"

rpm_count=0
staged_artifacts=()
while IFS= read -r artifact; do
  pkg_ver=""
  if command -v rpm >/dev/null 2>&1; then
    pkg_ver=$(rpm -qp --queryformat '%{VERSION}' "$artifact" 2>/dev/null || true)
  fi
  if [[ -n "$pkg_ver" && "$pkg_ver" != "$product_version" ]]; then
    echo "Warning: skipping artifact $artifact with mismatched package version '$pkg_ver' (expected '$product_version')." >&2
    continue
  fi

  rpm_count=$((rpm_count + 1))
  staged_artifact="$dnf_stage_dir/$(basename "$artifact")"
  install -m 0644 "$artifact" "$staged_artifact"
  staged_artifacts+=("$staged_artifact")
  echo "Built package: $artifact"
  echo "Dnf-readable package: $staged_artifact"
  scripts/inspect-linux-package.sh "$staged_artifact" "x86_64" "$product_version" > "$dnf_stage_dir/evidence-$(basename "$staged_artifact").json"
  echo "Evidence generated for $staged_artifact."
done < <(find "$cargo_target_dir/release/bundle/rpm" -maxdepth 1 -type f -name '*.rpm' -print 2>/dev/null | sort)

if ((rpm_count == 0)); then
  echo "Tauri build completed, but no .rpm package was found under $cargo_target_dir/release/bundle/rpm." >&2
  exit 1
fi

if ((install_package)); then
  dnf_action="install"
  if ((rpm_count == 1)); then
    package_name="$(rpm -qp --queryformat '%{NAME}' "${staged_artifacts[0]}")"
    if rpm -q "$package_name" >/dev/null 2>&1; then
      dnf_action="reinstall"
    fi
  fi

  echo "Installing staged package(s): ${staged_artifacts[*]}"
  if [[ "$EUID" -eq 0 ]]; then
    dnf "$dnf_action" -y "${staged_artifacts[@]}"
  else
    sudo dnf "$dnf_action" -y "${staged_artifacts[@]}"
  fi
else
  echo "Skipping install because --no-install was set."
  echo "Install later with: sudo dnf install ${staged_artifacts[*]}"
fi
