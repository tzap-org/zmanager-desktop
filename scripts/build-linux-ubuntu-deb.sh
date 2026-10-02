#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

install_deps=0
skip_tests=0
allow_non_baseline=0
install_package=1
deps_only=0
build_profile="local"

usage() {
  cat <<'EOF'
Usage: scripts/build-linux-ubuntu-deb.sh [--install-deps] [--skip-tests] [--allow-non-baseline] [--no-install] [--deps-only] [--profile local|online]

Builds the Ubuntu/Debian .deb distribution package with Tauri, stages it under
/tmp/zmanager-desktop-deb, and reinstalls the staged package through apt.

Release baseline:
  Build release .deb artifacts on Ubuntu 22.04 LTS (jammy). Building on newer
  Ubuntu releases can link against newer system libraries than Ubuntu 22.04 has.

Ubuntu prerequisites:
  sudo apt-get update
  sudo apt-get install build-essential ca-certificates cmake curl file gnupg libacl1-dev libayatana-appindicator3-dev libbz2-dev libexpat1-dev libgtk-3-dev liblz4-dev liblzma-dev libxml2-dev libsoup-3.0-dev librsvg2-dev libssl-dev libwebkit2gtk-4.1-dev libxdo-dev libzstd-dev patchelf pkg-config zlib1g-dev
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
  sudo apt-get install nodejs

Options:
  --install-deps  Install required Ubuntu build packages, Node.js, and Rust.
  --skip-tests    Skip frontend and Rust tests before packaging.
  --allow-non-baseline
                  Allow local/test builds outside Ubuntu 22.04 jammy (retained for compatibility).
  --no-install    Build and stage the .deb without reinstalling it.
  --deps-only     Install prerequisites and sync sibling repos, then exit
                   before running tests or building the package.
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
    --deps-only)
      deps_only=1
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
  local os_id="" version_codename="" pretty_name=""
  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    os_id="${ID:-}"
    version_codename="${VERSION_CODENAME:-}"
    pretty_name="${PRETTY_NAME:-}"
  fi

  if [[ "$os_id" == "ubuntu" && "$version_codename" == "jammy" ]]; then
    return
  fi

  echo "Warning: building outside the Ubuntu 22.04 jammy release baseline: ${pretty_name:-unknown OS}" >&2
  echo "Use this package for local testing only; build release .deb artifacts on Ubuntu 22.04." >&2
}

check_release_baseline

ubuntu_packages=(
  build-essential
  ca-certificates
  clang
  libclang-dev
  cmake
  curl
  file
  git
  gnupg
  libacl1-dev
  libayatana-appindicator3-dev
  libbz2-dev
  libexpat1-dev
  libgtk-3-dev
  liblz4-dev
  liblzma-dev
  libxml2-dev
  libsoup-3.0-dev
  librsvg2-dev
  libssl-dev
  libwebkit2gtk-4.1-dev
  libxdo-dev
  libzstd-dev
  patchelf
  pkg-config
  ripgrep
  zlib1g-dev
)

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

rust_install_required() {
  if ! command -v cargo >/dev/null 2>&1 || ! command -v rustc >/dev/null 2>&1; then
    return 0
  fi

  local rust_major rust_minor
  rust_major="$(version_major rustc)"
  rust_minor="$(version_minor rustc)"
  [[ -z "$rust_major" || -z "$rust_minor" || "$rust_major" -lt 1 || ("$rust_major" -eq 1 && "$rust_minor" -lt 85) ]]
}

npm_packages=(
  @tailwindcss/vite
  @tauri-apps/cli
  @vitejs/plugin-react
  typescript
  vite
  vitest
)

npm_install_required() {
  if [[ ! -d node_modules ]]; then
    return 0
  fi

  ! npm ls --depth=0 "${npm_packages[@]}" >/dev/null 2>&1
}

collect_missing_commands() {
  local command_name
  missing_commands=()
  required_commands=(git node npm cargo rustc pkg-config dpkg-deb cmake)
  if ((install_package)); then
    required_commands+=(apt-get)
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

run_apt_get() {
  if ((EUID == 0)); then
    apt-get "$@"
  else
    sudo apt-get "$@"
  fi
}

ensure_package_install_access() {
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "Installing Ubuntu packages requires apt-get." >&2
    exit 1
  fi

  if ((EUID == 0)); then
    return
  fi

  if ! command -v sudo >/dev/null 2>&1; then
    echo "Installing Ubuntu packages requires sudo or a root shell." >&2
    echo "Run as root or install these packages first:" >&2
    echo "  apt-get update && apt-get install ${ubuntu_packages[*]}" >&2
    exit 1
  fi

  echo "Installing Ubuntu packages requires sudo access."
  sudo -v
}

run_nodesource_setup() {
  if ((EUID == 0)); then
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  else
    curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
  fi
}

if ((install_deps)); then
  ensure_package_install_access
  run_apt_get update
  run_apt_get install -y "${ubuntu_packages[@]}"

  if node_install_required; then
    run_nodesource_setup
    run_apt_get install -y nodejs
  fi

  if rust_install_required; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source_cargo_env
  fi
fi

collect_missing_commands
if ((${#missing_commands[@]})); then
  echo "Missing required command(s): ${missing_commands[*]}" >&2
  echo "Install Node.js, Rust, and Ubuntu packaging prerequisites, then rerun." >&2
  echo "Or run: scripts/build-linux-ubuntu-deb.sh --install-deps" >&2
  echo "Ubuntu packages: sudo apt-get install ${ubuntu_packages[*]}" >&2
  echo "Rust: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh" >&2
  echo "Node.js: curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt-get install nodejs" >&2
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
  echo "Install Ubuntu packaging prerequisites, then rerun:" >&2
  echo "  sudo apt-get update" >&2
  echo "  sudo apt-get install ${ubuntu_packages[*]}" >&2
  echo "Or run: scripts/build-linux-ubuntu-deb.sh --install-deps" >&2
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

if npm_install_required; then
  npm install
fi

scripts/ensure-sibling-repos.sh

if ((deps_only)); then
  echo "Dependencies installed and sibling repos synced; skipping tests and build (--deps-only)."
  exit 0
fi

if ((!skip_tests)); then
  npm run test:frontend
  (cd src-tauri && cargo fmt --check)
  (cd src-tauri && cargo clippy --release --all-targets --all-features -- -D warnings)
  (cd src-tauri && cargo test --release)
fi

cargo_target_dir="${CARGO_TARGET_DIR:-$repo_root/src-tauri/target}"
rm -rf "$cargo_target_dir/release/bundle/deb"

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

npm run tauri -- build --bundles deb "${tauri_profile_args[@]}"

product_version=$(node -p 'require("./package.json").version')
apt_stage_dir="${ZMANAGER_DEB_STAGE_DIR:-/tmp/zmanager-desktop-deb}"
rm -rf "$apt_stage_dir"
install -d -m 0755 "$apt_stage_dir"

deb_count=0
staged_artifacts=()
while IFS= read -r artifact; do
  pkg_ver=""
  if command -v dpkg-deb >/dev/null 2>&1; then
    pkg_ver=$(dpkg-deb -f "$artifact" Version 2>/dev/null || true)
  fi
  if [[ -n "$pkg_ver" && "$pkg_ver" != "$product_version" ]]; then
    echo "Warning: skipping artifact $artifact with mismatched package version '$pkg_ver' (expected '$product_version')." >&2
    continue
  fi

  deb_count=$((deb_count + 1))
  staged_artifact="$apt_stage_dir/$(basename "$artifact")"
  install -m 0644 "$artifact" "$staged_artifact"
  staged_artifacts+=("$staged_artifact")
  echo "Built package: $artifact"
  echo "Apt-readable package: $staged_artifact"
  scripts/inspect-linux-package.sh "$staged_artifact" "amd64" "$product_version" > "$apt_stage_dir/evidence-$(basename "$staged_artifact").json"
  echo "Evidence generated for $staged_artifact."
done < <(find "$cargo_target_dir/release/bundle/deb" -maxdepth 1 -type f -name '*.deb' -print 2>/dev/null | sort)

if ((deb_count == 0)); then
  echo "Tauri build completed, but no .deb package was found under $cargo_target_dir/release/bundle/deb." >&2
  exit 1
fi

if ((install_package)); then
  echo "Installing staged package(s): ${staged_artifacts[*]}"
  if ((EUID == 0)); then
    apt-get install -y --reinstall "${staged_artifacts[@]}"
  else
    sudo apt-get install -y --reinstall "${staged_artifacts[@]}"
  fi
else
  echo "Skipping install because --no-install was set."
  echo "Install without _apt sandbox warning: sudo apt-get install --reinstall ${staged_artifacts[*]}"
fi
