# Dependency security checks

The **Security Audit** workflow checks the committed npm lockfile and all three
desktop Rust lockfiles plus the GLib regression-test lockfile on pull requests, pushes to `main`, a daily schedule,
and manual runs. A separate job audits the core lockfile used by the macOS FFI
library at the same reviewed commit. Package and release workflows call the
same workflow and wait for it before building artifacts. Audits need no private
documentation, hosted-account credentials, application builds or full sibling
bootstrap; the FFI audit retrieves only the pinned core source checkout.

- `npm audit --audit-level=low` blocks on every reported severity, including
  development tools.
- `cargo audit --deny yanked --file <lockfile>` blocks on vulnerabilities and
  yanked versions. Informational maintenance warnings remain visible.
- `npm run test:security` checks dependency patch ownership, immutable fork
  pins, the GLib backport and the CI gate integration. The daily workflow also
  runs GLib's public iterator tests in an optimized Linux build.

Run these commands locally before proposing dependency updates. Advisory
database or registry failures fail the job; there are no advisory exceptions
or `continue-on-error` paths. Branch protection can require the workflow's
checks; artifact workflows enforce their own dependency on the gate.

Both sibling bootstraps validate Cargo resolution with `--locked` before
packaging, so a stale sibling manifest cannot silently replace audited
dependencies. Releases pin core security commit
`1cc01b9e5dc0f2fcf0a3a2eb840062f783bfcfc2`; the earlier `v2.1.7` tag predates
the codec fixes. Advance that pin only with a reviewed, audited lockfile.
The shell and PowerShell bootstraps use the same pin by default. Developers
can explicitly override `ZMANAGER_ZMANAGER_REF` while working on core changes.

## Temporary forensic codec forks

Until the forensic readers publish fixed codec constraints, desktop mirrors the
reviewed forks used by the core workspace. `forensic-forks.lock` records exact
commit pins for AFF4, backhand, Btrfs, DAR, ZFS and the shared ZIP 0.2.2 reader.
AFF4 and archive-core now use the same patched `zip-forensic-core`; the ZIP 0.1
backport and checkout are no longer needed.

`scripts/checkout-forensic-forks.mjs` runs from both the shell and PowerShell
sibling bootstraps. It clones missing forks at detached revisions and rejects
existing checkouts with a different revision or local changes, preserving the
developer's work. Cargo's `[patch.crates-io]` entries in `src-tauri/Cargo.toml`
apply the forks at the desktop workspace root; Cargo does not inherit core's
workspace patches. The backhand pin and local TZAP core path keep the desktop
codec graph on the same fixed zstd releases as the core workspace. The same
sibling layout supports the core workspace used by the macOS FFI build.

The engine bootstrap pins compatibility commit
`400c3d719c4afe354b3d21d67f71c39092059eee` to match core's upstream ISO 0.8 /
VFS 0.7 interface. Its `main` branch still
resolves the older ISO fork and would change desktop's lockfile on a clean
machine. Restore the default to `main` once the compatibility change is merged.

When updating these pins, review the source diff and keep desktop and core
compatible. Remove each override and checkout pin once a fixed upstream
release satisfies every consuming reader. Rebuild the lockfile and rerun
audits, license checks, archive safety tests and platform builds.

## GLib 0.18 backport

Tauri 2.12.5 (the latest stable release reviewed on 2026-10-23) still requires
GTK 0.18 and GLib 0.18 in its Linux GTK/WebKit stack. Updating Tauri does not
remove the need for this backport. The released GLib 0.18.5 crate has
[RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html):
its string iterator passes an immutable reference to a mutable C out parameter.

`vendor/glib` preserves the upstream crate identity, source and MIT license,
with the upstream fix backported. Provenance and the removal plan are in
[PATCHES.md](../vendor/glib/PATCHES.md). The product patches the complete
GLib 0.18 graph to this copy. The security contract prevents silently restoring
the registry version, and optimized upstream iterator tests exercise the
affected public API. No advisory is ignored and the crate is not relabeled as
a newer upstream release.

Remove the vendor copy, patch, contract and dedicated regression job when the
full Tauri/GTK/WebKit stack supports a fixed upstream release. Update the
third-party notices whenever dependency license metadata changes.

## Linux deep-link compatibility

The Linux graph temporarily pins `rust-ini` to 0.21.1: the latest deep-link
plugin (2.6.2) constructs `ParseOption` without the fields added in 0.21.2 and
fails to compile with 0.21.3. The pin uses a non-yanked release and is covered
by the same advisory gate and Linux build. Remove it when the plugin supports
the expanded parser options (for example, using `..Default::default()`).

## Verification environment

Application tests and local validation builds must use
`ZMANAGER_TZAP_BUILD_ENV=staging` and
`ZMANAGER_TZAP_SERVER_BASE_URL=https://staging.tzap.org`. Security audits inspect
dependency metadata and never contact the hosted application service.
