# Linux Packaging Notes

The Linux bundle uses Tauri file associations for Open With support and custom deb/rpm
desktop templates for quick-action routes.

Packaged materials:

- `zmanager.desktop.hbs`: the visible launcher/Open With entry plus desktop
  actions. Tauri renders it as `zmanager-desktop.desktop`, matching the Wayland
  app id for dock/taskbar icon matching. Tauri also owns the application icon
  payloads; custom package files add only MIME icons and shell integrations.
- `xdg-mime.xml`: MIME definitions for ZManager-owned `.tzst`, `.tar.zst`, and `.tzap`
  extensions, including explicit XDG MIME icon definitions (`application-x-zmanager-tzap`, `application-x-zmanager-tzst`) and fallback generic archive icons.
- `src-tauri/icons/icon-256.png`, `icon-512.png`, and `icon.png`: installed as
  the `zmanager-desktop` hicolor app icon and `application-x-zmanager-*` hicolor MIME icons in indexed sizes for desktop shells and file managers.
- `org.tzap-org.zmanager.desktop.metainfo.xml`: AppStream metadata for graphical
  package managers and software centers.
- `postinstall.sh` and `postremove.sh`: refresh XDG MIME, desktop, and icon
  caches, then reload running Nautilus instances so Python extension changes
  take effect after install, upgrade, or removal.
- `nautilus/zmanager_nautilus.py`: GNOME Files/Nautilus Python extension that
  adds the real right-click `ZManager` submenu for selected files, folders, and
  folder backgrounds.
- `kde/zmanager-archive-servicemenu.desktop`: KDE/Dolphin archive-only
  extraction/open service-menu actions installed by deb/rpm packages.
- `kde/zmanager-servicemenu.desktop`: KDE/Dolphin create service-menu actions for
  selected files and folders installed by deb/rpm packages.

Ubuntu/Debian package build:

```sh
scripts/build-linux-ubuntu-deb.sh
```

Release `.deb` artifacts must be built on Ubuntu 22.04 LTS (jammy), preferably
on amd64 for the primary x86_64 package. Ubuntu 22.04 is the runtime baseline.
Building on Ubuntu 24.04 or newer can produce binaries linked against newer
system libraries than Ubuntu 22.04 has. When building outside Ubuntu 22.04 jammy,
the script automatically prints a warning and proceeds for local testing.

The build script prints both the canonical bundle artifact and an apt-readable
copy staged under `/tmp/zmanager-desktop-deb/`, then reinstalls the staged copy
through apt. This avoids apt's `_apt` sandbox warning when the project lives in
a private home directory:

```sh
scripts/build-linux-ubuntu-deb.sh
```

Use `--no-install` when you only want to build and stage the `.deb` artifact.

Ubuntu is best served by a `.deb` package. It integrates with `dpkg`/apt,
desktop launchers, MIME associations, and the post-install hooks in this
directory. AppImage remains useful for portable manual installs, but `.deb` is
the primary Ubuntu distribution artifact.

Fedora RPM package build:

```sh
scripts/build-linux-fedora-rpm.sh
```

Release `.rpm` artifacts should be built on Fedora. Linux builds inherit the
build machine's glibc floor, so use the oldest Fedora release you intend to
support for release packages. When building outside Fedora, the script
automatically prints a warning and proceeds for local testing.

The RPM script prints both the canonical bundle artifact and a dnf-readable copy
staged under `/tmp/zmanager-desktop-rpm/`, then installs or reinstalls the
staged copy through dnf:

```sh
scripts/build-linux-fedora-rpm.sh
```

Use `--no-install` when you only want to build and stage the `.rpm` artifact.

Fresh Ubuntu builders must install Tauri's native GTK/WebKit dependencies and
native archive/link dependencies:

```sh
sudo apt-get update
sudo apt-get install build-essential ca-certificates cmake curl file gnupg libacl1-dev libayatana-appindicator3-dev libbz2-dev libexpat1-dev libgtk-3-dev liblz4-dev liblzma-dev libxml2-dev libsoup-3.0-dev librsvg2-dev libssl-dev libwebkit2gtk-4.1-dev libxdo-dev libzstd-dev patchelf pkg-config zlib1g-dev
```

These packages provide `cmake` for the bundled libarchive build and required
`pkg-config` entries such as `gtk+-3.0`, `libsoup-3.0`, and `webkit2gtk-4.1`.
They also provide every native library enabled by the bundled libarchive build:
`acl`, `bz2`, `expat`, `lz4`, `lzma`, `zstd`, `zlib`, `xml2`, and OpenSSL. If
they are missing, Cargo fails before packaging, often in
`zmanager-libarchive-sys`, `soup3-sys`, WebKit build scripts, or the final Rust
link step. A missing libsoup package looks like:

```text
pkg-config --libs --cflags libsoup-3.0 'libsoup-3.0 >= 3.0'
No package 'libsoup-3.0' found
```

A missing `cmake` package looks like:

```text
failed to execute command: No such file or directory (os error 2)
is `cmake` not installed?
```

You can also run `scripts/build-linux-ubuntu-deb.sh --install-deps`, but it
requires an interactive sudo session. The script installs missing Node.js 24
and Rust through rustup, then reloads Cargo's environment before checking
versions. The script expects Rust 1.85 or newer because the Tauri crate uses the
Rust 2024 edition.

Fresh Fedora builders must install Tauri's native GTK/WebKit dependencies,
RPM build tooling, and native archive/link dependencies:

```sh
sudo dnf install ca-certificates cmake curl file gcc gcc-c++ make pkgconf-pkg-config openssl-devel webkit2gtk4.1-devel libsoup3-devel gtk3-devel libappindicator-gtk3-devel librsvg2-devel libxdo-devel bzip2-devel expat-devel libacl-devel lz4-devel xz-devel libzstd-devel zlib-devel libxml2-devel rpm-build patchelf nautilus-python
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo -E bash -
sudo dnf install nodejs
```

You can also run `scripts/build-linux-fedora-rpm.sh --install-deps`. The script
installs missing Node.js 24 and Rust through rustup when needed.

The repository includes `.cargo/config.toml` to append `-lexpat` on Linux. Keep
`libexpat1-dev` in the dependency list; it avoids ARM64 GNU ld ordering
failures when test or release binaries link bundled libarchive.

Quick-action command contract:

- `zmanager-desktop --quick-action extract-here --path <archive>...`
- `zmanager-desktop --quick-action extract-to-folder --path <archive>`
- `zmanager-desktop --quick-action open --path <archive>`
- `zmanager-desktop --quick-action compress --path <target>...`
- `zmanager-desktop --quick-action compress-tzap --path <target>...`
- `zmanager-desktop --quick-action compress-zip --path <target>...`
- `zmanager-desktop --quick-action compress-7z --path <target>...`
- `zmanager-desktop --quick-action compress-tzst --path <target>...`
- `zmanager-desktop --quick-action compress-tgz --path <target>...`

These labels and command routes mirror the Windows `ZManager` cascaded context
menu documented in `docs/windows-context-menu-behavior.md`. The app validates
all quick actions before starting work; unsupported paths fail visibly instead
of relying on file-manager metadata for safety.

`Extract Here` accepts multiple selected archives. `Extract to Archive Folder`
and `Open archive` are single-archive actions, matching Windows Explorer's `%1`
verb contract; Linux desktop and KDE metadata use single-file tokens for those
actions, and the Nautilus extension disables them for multi-selection.

GNOME Files/Nautilus consumes the packaged Python extension from
`/usr/share/nautilus-python/extensions/zmanager_nautilus.py`. The deb package
depends on Ubuntu/Debian's `python3-nautilus`; the Fedora RPM depends on
Fedora's `nautilus-python`. Install `.deb` packages through
`apt-get install ./ZManager_...deb` rather than bare `dpkg -i` unless
dependencies are already installed; `dpkg` can unpack ZManager without installing
`python3-nautilus`, leaving GNOME Files with no Python extension host. On Ubuntu
22.04, `python3-nautilus` is in the `universe` repository, so a clean VM may
need:

```sh
sudo add-apt-repository universe
sudo apt-get update
```

The extension dynamically negotiates Nautilus 4.0+ and 3.0+ Python APIs.
The package scripts ask running Nautilus instances to quit after install,
upgrade, or removal because Nautilus does not reload Python extensions while it
is running. The next time GNOME Files opens, it loads the current ZManager
extension. If a locked-down session prevents the package script from reaching
the user's session bus, logging out and back in refreshes Nautilus.

After restart, selected files, selected folders, and folder backgrounds show a
top-level `ZManager` submenu. Supported archive selections show extract/open
actions first and create actions after them; non-archive file/folder selections
show create actions.

GNOME install checks:

```sh
dpkg -s zmanager-desktop python3-nautilus
ls -l /usr/share/nautilus-python/extensions/zmanager_nautilus.py
PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY'
import importlib.util
path = "/usr/share/nautilus-python/extensions/zmanager_nautilus.py"
spec = importlib.util.spec_from_file_location("zmanager_nautilus", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
print("ZManager Nautilus extension imports")
PY
```

For a verbose load check, launch Nautilus from a terminal:

```sh
ZMANAGER_NAUTILUS_DEBUG_LOG=/tmp/zmanager-nautilus-debug.log \
  NAUTILUS_PYTHON_DEBUG=misc nautilus "$HOME"
```

Right-click a file or folder, then check `/tmp/zmanager-nautilus-debug.log` for
`get_file_items` and `run_quick_action` lines. If `nautilus-python` reports no
load attempt, the extension host package is missing or Nautilus was not
restarted.

KDE/Dolphin consumes the packaged service menus from
`/usr/share/kio/servicemenus/zmanager-archive-servicemenu.desktop` and
`/usr/share/kio/servicemenus/zmanager-servicemenu.desktop` when installed from
deb/rpm. Archive MIME selections receive `Extract Here`, `Extract to Archive
Folder`, and `Open archive`; selected files and folders receive the create
actions. Archive selections also receive create actions through the generic
create service menu, matching Windows. If a distribution expects the user-level
path, copy both files to `~/.local/share/kio/servicemenus/` and run
`kbuildsycoca6` or log out and back in.

AppImage builds carry the app desktop metadata for manual registration, but system-level
Open With and service-menu installation depends on the user or distribution integration
tool installing that metadata.

Distribution expectations:

- Ubuntu 22.04 LTS: primary baseline for `.deb` release builds and GNOME
  Nautilus smoke testing.
- Ubuntu 24.04 LTS: supported as a newer runtime, but not the release build
  baseline.
- Debian GNOME: package shape is similar, but dependency names and Nautilus API
  version can vary by release. Validate on the target Debian stable release
  before publishing Debian-specific artifacts.
- Fedora: primary `.rpm` target. Build with `scripts/build-linux-fedora-rpm.sh`
  and validate GNOME Files and KDE/Dolphin integration on the target Fedora
  release before publishing.
- openSUSE/RHEL-family: use `.rpm`, but dependency names differ. The checked-in
  RPM metadata is Fedora-oriented and may need distro-specific dependency
  mapping before publishing to those distributions.
- KDE/Dolphin: service-menu files are packaged, but should be smoke-tested on
  each target distro because KIO service-menu cache behavior differs by KDE
  version.
