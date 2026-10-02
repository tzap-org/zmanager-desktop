# ZManager Desktop

[![Package](https://github.com/frankmanzhu/zmanager-desktop/actions/workflows/package.yml/badge.svg?branch=main)](https://github.com/frankmanzhu/zmanager-desktop/actions/workflows/package.yml)
[![Release](https://github.com/frankmanzhu/zmanager-desktop/actions/workflows/release.yml/badge.svg)](https://github.com/frankmanzhu/zmanager-desktop/actions/workflows/release.yml)
[![Release version](https://img.shields.io/github/v/release/frankmanzhu/zmanager-desktop?include_prereleases&label=release)](https://github.com/frankmanzhu/zmanager-desktop/releases)
[![Latest tag](https://img.shields.io/github/v/tag/frankmanzhu/zmanager-desktop?sort=semver&label=latest%20tag)](https://github.com/frankmanzhu/zmanager-desktop/tags)
[![Downloads](https://img.shields.io/github/downloads/frankmanzhu/zmanager-desktop/total)](https://github.com/frankmanzhu/zmanager-desktop/releases)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

A fast, open-source archive manager for Windows, Linux, and macOS. ZManager
gives you one simple place to open, test, extract, and create archives, with
native desktop integration on each platform.

If someone sends you an archive and you are not sure which tool to use, start
with ZManager. It can open a very broad range of existing files, while keeping
new archive creation focused on formats that are fast, compatible, or secure.

## Latest release: 1.2.5

The latest release packages the cross-platform desktop app for macOS arm64 and
x86_64, Windows x64 and ARM64, and Linux x64 and ARM64. Release assets include
macOS DMG and ZIP packages, Windows installer and portable binaries, Linux DEB
and RPM packages, a generated third-party license bundle, and SHA256 checksums
for verification.

See the [full release notes](https://github.com/frankmanzhu/zmanager-desktop/releases/tag/v1.2.5)
and download the installers from [GitHub Releases](https://github.com/frankmanzhu/zmanager-desktop/releases/latest).

## What can I do with it?

- Open and extract archives, packages, disk images, filesystem images, and
  compressed files.
- Create ZIP, TZST, TGZ, TZAP, 7z, and Apple Archive files.
- Test an archive before extracting it.
- Work from Finder, Explorer, or your Linux file manager.
- Run each archive job in its own window with progress, cancellation, and
  recovery support.

## Supported formats

ZManager keeps two jobs separate: **open and extract broadly**, then **create
deliberately**. That means you can open files from many ecosystems without
being encouraged to create new archives in outdated formats.

### Create archives

| Format | Best for |
|---|---|
| `.zip` | Everyday sharing and maximum compatibility; Deflate/store and AES-256 encryption are supported. |
| `.tzst` (`.tar.zst`) | Fast compression for projects, backups, and large folders. |
| `.tgz` (`.tar.gz`) | Compatibility with Unix tools and older systems. |
| `.tzap` | Encrypted, signed, recoverable archives for long-lived data. |
| `.7z` | High-compression archives with AES-256 encryption. |
| `.aar` / `.aea` | Apple Archive files, including encrypted Apple Archive on macOS. |

### Open and extract

ZManager can open the following format families through the same desktop
workflow:

<details>
<summary>See the full compatibility list</summary>

#### ZIP family

`.zip`, `.zipx`, `.jar`, `.war`, `.ipa`, `.apk`, `.appx`, `.xpi`, `.cbz`,
`.epub`, split `.z01`… volumes, and ZIP-content `.exe` files.

#### 7z family

`.7z`, `.cb7`, `.sevenz`, encrypted 7z archives, and numbered `.7z.001`
volumes.

#### RAR family

`.rar`, `.cbr`, split `.partN.rar` volumes, RAR4/RAR5, passworded RAR, and
encrypted RAR5 archives.

#### TAR and variants

`.tar`, `.cbt`, `.ustar`, `.pax`, `.tar.gz`, `.tgz`, `.tar.bz2`, `.tbz2`,
`.tbz`, `.tar.xz`, `.txz`, `.tar.lzma`, `.tlzma`, `.tzst`, `.tar.zst`,
`.tar.lz`, `.tar.lzo`, `.tar.Z`, `.taz`, `.tar.lz4`, `.tar.uu`, and
`.tar.b64`.

#### TZAP and raw compression

`.tzap`, `.zst`, `.gz`, `.bz2`, `.xz`, `.lzma`, `.lz`, `.br`, `.lz4`, `.lzo`,
`.Z`, `.uu`, and `.b64`.

#### Packages and containers

`.deb`, `.rpm`, `.a`, `.ar`, `.lib`, `.cpio`, `.cpio.gz`, `.cpio.bz2`,
`.cpio.xz`, `.cpio.lzma`, `.cpio.zst`, `.cpgz`, `.spk`, `.iso`, `.xar`,
`.cab`, `.msi`, `.pkg`, `.lha`, `.lzh`, `.warc`, and `.mtree`.

#### Disk images and filesystems

`.dmg` (Apple Disk Image), `.vhd` (Virtual PC/Hyper-V), `.vmdk` (VMware), and
`.vdi` (VirtualBox). Disk partitions and inner filesystems are resolved for
supported images, including NTFS, FAT/exFAT, ext4, and UDF.

`.squashfs` and `.sqfs` Linux filesystem images, plus type-2 `.appimage`
files. SquashFS gzip, XZ, LZO, LZ4, and Zstandard blocks are supported, with
Unix modes and modification times restored.

#### Optical images

`.iso` and `.udf` optical images, `.nrg` (Nero), `.mds`/`.mdf` (Alcohol 120%),
`.cdi` (DiscJuggler), `.isz` (UltraISO Compressed ISO), `.ccd` with its `.img`
companion (CloneCD), and `.cue` with its `.bin` companion (CUE/BIN). Raw
2352/2448 and Mode 2 sectors are mapped to logical 2048-byte sectors.

#### Windows imaging

`.wim` images and `.swm` split sets support stored, XPRESS-Huffman, and WIM-LZX
resources, multiple images, sibling-part resolution, and reparse-point
symlinks. LZMS-compressed `.esd` distribution images are intentionally not
supported.

#### Apple Archive

`.aar` and encrypted `.aea` Apple Archives on supported Apple platforms.

</details>

TZAP is the cross-platform format ZManager targets for fast, secure, and
resilient workflows. Password-protected ZIP, 7z, TZAP, Apple Archive, and RAR
list, test, and extract through a prompt or standard input.

## Why this feels trustworthy

- Open-source, so archive behavior can be reviewed in code.
- Security-first handling stays in the Rust core (`zmanager-core`): path checks, overwrite policy, and normalization.
- Password input is handled in app state and is not logged.
- Every release includes checksums for verification.
- Every release includes a `zmanager-desktop-<version>-third-party-licenses.zip`
  asset containing generated notices and copied Rust, frontend, vendored, and
  native dependency license texts.

## Get started in 60 seconds

1. Open [GitHub Releases](https://github.com/frankmanzhu/zmanager-desktop/releases/latest).
2. Download the default package for your OS. These packages use the local/offline profile. To enable hosted account features, choose the matching filename containing `full`:
   - **Windows:** `zmanager-desktop-<version>-windows-x64-installer.exe` or `...-windows-arm64-installer.exe`
   - **Linux:** `zmanager-desktop-<version>-linux-x64` or `...-linux-arm64` (`.deb` / `.rpm`)
   - **macOS:** `ZManager-<version>-macos-arm64.dmg` or `...-macos-x86_64.dmg`
3. Install and open the app.
4. Open or create an archive. Each accepted operation gets its own task window,
   while the reusable manager stays ready for more work.

### Package quick lookup

| Platform | Local/offline default | Full/online |
|---|---|---|
| Windows x64 | `zmanager-desktop-<version>-windows-x64-installer.exe` or `...-portable.exe` | `zmanager-desktop-full-<version>-windows-x64-installer.exe` or `...-portable.exe` |
| Windows ARM64 | `zmanager-desktop-<version>-windows-arm64-installer.exe` or `...-portable.exe` | `zmanager-desktop-full-<version>-windows-arm64-installer.exe` or `...-portable.exe` |
| Linux x64 | `zmanager-desktop-<version>-linux-x64.deb` or `.rpm` | `zmanager-desktop-full-<version>-linux-x64.deb` or `.rpm` |
| Linux ARM64 | `zmanager-desktop-<version>-linux-arm64.deb` or `.rpm` | `zmanager-desktop-full-<version>-linux-arm64.deb` or `.rpm` |
| macOS ARM64 | `ZManager-<version>-macos-arm64.dmg` or `.zip` | `ZManager-full-<version>-macos-arm64.dmg` or `.zip` |
| macOS x86_64 | `ZManager-<version>-macos-x86_64.dmg` or `.zip` | `ZManager-full-<version>-macos-x86_64.dmg` or `.zip` |

The Microsoft Store MSIX is built from the local/offline profile.

## Platform integration

- **Windows:** Explorer context-menu actions, file associations, portable and
  installer packages, and x64/ARM64 builds.
- **Linux:** desktop and file-manager actions, MIME associations, and x64/ARM64
  DEB and RPM packages.
- **macOS:** Finder actions, Quick Look previews, Spotlight metadata, native
  file opening, and Apple Silicon/Intel DMG and ZIP packages.

## Recent improvements

- Each accepted archive operation runs in its own task window with progress,
  cancellation, and recovery support.
- Archive columns can be customized globally and per workspace.
- TZAP account, certificate, signing identity, and contact-management flows are
  available from the account workspace.
- Passwords remain in transient application state and are never logged or
  persisted.
- Release artifacts include checksums for verification.

## For users who want to go deeper

- [Release notes](https://github.com/frankmanzhu/zmanager-desktop/releases)
- Engine context: [`zmanager` README](https://github.com/frankmanzhu/zmanager/blob/main/README.md)
- TZAP context: [`TZAP` README](https://github.com/frankmanzhu/tzap/blob/main/README.md)

## Developer docs

- [Developer setup and build details](./public-docs/developer-setup.md)
- [Architecture overview](./public-docs/ARCHITECTURE.md)
- [Requirements](./public-docs/REQUIREMENTS.md)

To regenerate the license inventory locally, run
`npm run generate:third-party-licenses`. The CI license gate also runs the Rust
`cargo-deny` policy and validates production npm license expressions.
