# Temporary GLib 0.18 compatibility backport

Source: the unmodified `glib 0.18.5` crates.io release archive, SHA-256
`233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5`.
Upstream authorship, version, COPYRIGHT and MIT LICENSE are retained.

The only runtime change is the upstream fix from
[gtk-rs/gtk-rs-core#1343](https://github.com/gtk-rs/gtk-rs-core/pull/1343):
`VariantStrIter::impl_get` declares its C out pointer mutable and passes `&mut p`
instead of `&p`. This repairs
[RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)
without changing the GTK 0.18 types required by Tauri/WebKit2GTK.

Rechecked against stable Tauri 2.12.5 on 2026-10-23: its Linux dependencies still
require GTK 0.18, so the Tauri upgrade cannot yet replace this backport.

`src-tauri/Cargo.toml` patches the product's complete GLib 0.18 graph to this
copy. The security contract test checks that patch, and CI runs the upstream
iterator tests in release mode, where the original code crashes.

Remove this directory, the Cargo patch and the dedicated regression job when
the complete Tauri/GTK/WebKit stack accepts a fixed upstream GLib release.
Never relabel this code as GLib 0.20 or suppress the advisory to conceal an
unpatched dependency. Future edits must be recorded here.

Modern rustc compatibility: machine-applicable `cargo fix --lib` suggestions
add explicit elided lifetimes and remove redundant type parentheses in the
upstream sources. These annotations do not change runtime behavior; no
compiler lint is suppressed. `zmanager-backport.patch` records the complete
diff from the release archive, including the security fix and these annotations.

The additional Cargo.lock freezes the standalone upstream regression-test
dependencies. CI audits it and tests with `--locked`; the product continues
to resolve this crate through `src-tauri/Cargo.lock`.
