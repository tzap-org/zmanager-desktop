# ZManager Desktop developer setup

This document contains technical setup, build, packaging, and release-procedure
information that was previously in the repository front page.

## Release notes workflow

For each release, update [`README.md`](../README.md) with the notes that should appear in GitHub release assets/description.

Set the product release version through the single bump command; it updates
the Cargo, Tauri, package, native bundle, and generated metadata versions:

```sh
bash scripts/bump-version.sh 1.1.2
```

The command runs the generated-contract and product-version consistency checks.

## Repository relationship

This project replaces the former macOS app while retaining its repository as
read-only migration evidence until cutover.

```text
ZManager/
  former macOS SwiftUI reference implementation
  cli/ -> public zmanager Rust CLI/core submodule

zmanager-desktop/
  Windows/Linux/macOS Tauri product and native macOS targets
  consumes zmanager-core from the public Rust repo
```

The desktop Cargo workspace uses sibling source checkouts, including `zmanager`
and `tzap`, through local path dependencies. The complete sibling inventory,
local and CI setup, and release pin procedure are documented in
[Build inputs and sibling repository design](BUILD_INPUTS_DESIGN.md). That guide
is the canonical operator reference; the product's release lock records the
authoritative sibling SHAs.

## Product direction (engineering)

- Keep one shared Windows/Linux/macOS GUI project.
- Keep platform-specific integration in isolated native modules.
- Keep application UI in React; use Swift/AppKit only for the macOS Native Host and Extension Suite.
- Do not duplicate archive logic; keep core archive behavior in `zmanager-core`.
- Keep the GUI as orchestration and presentation over the Rust job model.

## Stack

- Tauri 2 for the Windows, Linux, and macOS shell.
- Vite and TypeScript for UI state and shared logic.
- Rust Tauri commands for app-facing operations.
- `zmanager-core` for planning, listing, testing, extraction, creation, safety, and job events.

## Local development

```sh
npm install
npm run dev
npm run tauri dev
```

Rust command-layer check:

```sh
cd src-tauri
cargo check
```

## Automated GUI testing

The test layers are intentionally split by responsibility:

- `npm run test:frontend` runs fast Vitest workflow and component tests.
- `npm run test:e2e` runs Playwright browser tests with deterministic Tauri
  stubs, covering broad UI behavior without native-process startup cost.
- `npm run test:gui` builds a debug Tauri application with the GUI test mode,
  starts its embedded WebDriver server, and runs WebdriverIO against the real
  window and Rust commands. The test specs live in `e2e/tauri/`.

The embedded WDIO plugins are registered only for debug Rust builds. Do not
ship a debug build or expose its WebDriver port outside the local test host.
The GUI build uses `src-tauri/tauri.gui.conf.json` so the frontend is built
with the WDIO bridge before Tauri embeds the assets.

## Linux build prerequisites

Ubuntu/Debian builds need Rust 1.93+ for the pinned ZManager core and native
dependencies for the Tauri and archiving stack.

```sh
sudo apt-get update
sudo apt-get install build-essential ca-certificates cmake curl file gnupg libacl1-dev libayatana-appindicator3-dev libbz2-dev libexpat1-dev libgtk-3-dev liblz4-dev liblzma-dev libxml2-dev libsoup-3.0-dev librsvg2-dev libssl-dev libwebkit2gtk-4.1-dev libxdo-dev libzstd-dev patchelf perl pkg-config zlib1g-dev
```

These packages provide `cmake` for the bundled libarchive build, every enabled
libarchive compression/link dependency (`acl`, `bz2`, `lz4`, `lzma`, `zstd`,
`zlib`, XML, and OpenSSL), and the GTK/WebKit `pkg-config` dependencies required
by the Rust build.

## Debian package build

```sh
scripts/build-linux-ubuntu-deb.sh
```

- `--install-deps`: installs Ubuntu packages, Node.js 24, and Rust via rustup when needed.
- `--skip-tests`: packaging-only mode.
- Build output is staged to `/tmp/zmanager-desktop-deb/`.
- Install via:

```sh
sudo apt-get install --reinstall /tmp/zmanager-desktop-deb/ZManager_<version>_amd64.deb
```

## Fedora RPM build

```sh
scripts/build-linux-fedora-rpm.sh
```

- `--install-deps`: installs Fedora Tauri/packaging dependencies, Node.js 24, and Rust via rustup when needed.
- `--no-install`: stop before host install, leave artifacts staged.
- Build output is staged to `/tmp/zmanager-desktop-rpm/`.

## macOS application build

```sh
scripts/build-macos.sh
```

- Builds the complete Release Bundle. Local builds use the preferred Apple
  Development identity `8014C7D557DE28E3C52971362BA18A3CCC28A723` when it is
  available in Keychain. Matching main-app and Finder-extension provisioning
  profiles are selected from Xcode and refreshed through Personal Team
  automatic signing when missing or expired. Free Personal Team profiles expire
  after seven days; `scripts/refresh-macos-development-profiles.sh` refreshes
  them explicitly. Xcode must have the signing Apple Account configured. The
  build falls back to ad-hoc signing when the preferred identity is unavailable.
  Set `ZMANAGER_CODESIGN_IDENTITY=-` to force ad-hoc signing. Protected release
  builds use Developer ID signing, notarization, and stapling.
- `--bundle app|dmg|all` selects the artifact type; the default is `all`.
- `--install-deps` installs missing CMake/Node dependencies with Homebrew and
  installs or updates Rust through rustup.
- `--skip-tests` enables packaging-only mode.
- The built application is installed into `/Applications` by default.
- `--no-install` stages the artifacts without installing the application.
- `--install-dir PATH` or `ZMANAGER_MACOS_INSTALL_DIR` selects another
  application directory.
- Build output is staged to `/tmp/zmanager-desktop-macos/`, or the directory in
  `ZMANAGER_MACOS_STAGE_DIR`.
- `scripts/release-gate-macos.sh` verifies nested targets, linkage, identifiers,
  versions, entitlements, architectures, signatures, notarization, and stapling.

## Repository layout

```text
docs/
  ARCHITECTURE.md
  REQUIREMENTS.md
packaging/
  linux/
  windows/
src/
  TypeScript UI shell
src-tauri/
  Tauri app, Rust command layer, platform integration modules
```

## Current milestone focus

- healthcheck
- open archive
- browse entries
- extract archive
- create ZIP/TZST/TZAP/7Z
- password prompt through non-logging UI state
- progress and cancellation
- platform packaging
