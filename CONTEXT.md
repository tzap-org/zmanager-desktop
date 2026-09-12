# ZManager Desktop context

ZManager Desktop is the single cross-platform Tauri archive manager built on
`zmanager-core`. Windows, Linux, and macOS are first-class build, package, and
release targets. This repository owns the replacement macOS Native Host,
Extension Suite, Release Bundle, and Replacement Migration. The former SwiftUI
repository is frozen reference evidence after cutover. Archive semantics and
extraction safety remain core-owned.

## Domain glossary

### Local Identity Inventory

The public catalog plus native secure references to private material available
on this installation. It is the source of truth for local signing,
recipient-key, and trusted-contact capabilities; it is not a hosted account
database.

### Identity & Contacts workspace

The React workspace that manages the local inventory: enrolled signing
identities, recipient keys, verified trusted contacts, aliases, lifecycle
state, and capability-aware account connection status.

### Hosted Account

The browser-hosted `login.tzap.org`/Account experience for cross-device
account management, device listing, and server-side revocation. It remains a
separate authority from the local inventory.

### Secure secret handoff

At archive job handoff, Rust re-resolves selected opaque local IDs, obtains
only the required private material through a native secure-store interface,
and passes it to `zmanager-core`. React snapshots, persisted preferences,
catalog files, URLs, diagnostics, and command-line arguments contain no
private key bytes or session secrets.

### Desktop Shell

The complete cross-platform Tauri application: React user interface, application
state machines, Tauri command integration, native window behavior, platform
integration, and packaging.

### Main Window

The singleton, persistent application window opened by launching the app or by
an explicit **Add to archive** shell action. It hosts the normal Compress and
Extract launch workflows. It is a reusable archive browser and operation
launcher, not a job-progress surface. After an accepted create, extract, or test
request crosses **Job Handoff**, it clears the submitted operation's transient
state and immediately returns to a browse-ready state without waiting for the
job to finish. Its workflow state has no global `jobRunning` mode: only the
individual start request awaiting Rust acceptance is guarded against duplicate
submission, and unrelated active Jobs never disable normal manager use.

### Disposable Task Window

A short-lived window dedicated to exactly one create, extract, or test Job, whether
launched from a Quick Action or the Main Window. Multiple task windows may
coexist. Successful and cancelled jobs auto-close after brief acknowledgement;
a failed task remains open so its error and recovery actions are visible. It
does not replace or duplicate the Main Window. Its state mirrors one
authoritative Rust Job plus minimal local UI state such as close confirmation
or one recovery action; it does not participate in a shared frontend progress
lifecycle.

### Job Handoff

The one-way transition after Rust accepts a create, extract, or test request and
returns a Job ID. The Desktop Shell records active process work, opens the
Job's Disposable Task Window, and resets the submitted operation state in the
Main Window. The task window then subscribes directly to that Job. The accepted
Job is independent of the reset and continues if the Main Window is reused,
hidden, or closed. A request rejected before Job Handoff does not reset the
non-secret setup state. Job Handoff ends after these accepted-start effects; it
does not subscribe to progress or wait for completion. Presentation failure is
reported as degradation of the already accepted Job and never causes the
operation to be resubmitted.

### Quick Action Coordinator

The hidden Desktop Shell role used only when an isolated Quick Action process
launches Disposable Task Windows without revealing the Main Window. Explicit
Quick Action launches do not register the single-instance plugin; each launch
owns its request, hidden coordinator webview, Rust Jobs, and task windows. The
coordinator owns no progress workflow. It tracks only whether it is
coordinator-only and the pending-request, active-Job, and open-task-window
counts required to exit after all work settles. It may retain bounded Job IDs
to reconcile Rust catalog updates, but it owns no per-Job progress, retry,
output-action, or terminal presentation state. When those counts settle and no
visible Main Window was revealed, the hidden coordinator is destroyed so the
isolated process exits.

### Quick Action

A shell or startup request that begins a specific operation with its inputs and
destination already implied. An explicit Quick Action is an isolated process
launch and never joins the normal application's singleton process. Quick
actions normally use a Disposable Task Window. A general action such as **Add
to archive** may reveal the reusable Main Window in its own launch process when
its generated disposition requires user review. Each shell action declares
this window disposition in the generated shell-action contract so cold startup
and frontend routing use the same classification.

### Shell Action Request

The atomic, versioned request produced from one operating-system shell
selection. It contains a language-neutral action and every selected local path.
Windows builds it from `IShellItemArray`; Linux integrations may build the same
contract from their native multi-selection mechanism. Shell integrations never
perform archive operations themselves.

### Compress Workspace / Create Workspace

**Compress** is the user-facing mode for choosing sources, reviewing the
authoritative archive plan, configuring creation options, and starting an
archive job. Internal architecture may call its state module the **Create
Workspace**. These names describe the same workflow at different boundaries.

### Extract Workspace / Archive Workspace

The user-facing mode for opening an archive, navigating its entries, choosing
an extraction destination and options, previewing entries, and starting extract
or test jobs. Internal architecture may use **Archive Workspace** for the
listing, navigation, selection, and extraction state owned by this workflow.

### Archive Plan

The authoritative, core-produced representation of the sources and entries
that will be archived after ignore and clean-source rules are applied. The GUI
may display and select the plan but must not independently reproduce archive
planning semantics. During replanning, keep the current tree visible, show a
subtle refreshing state, and atomically replace it when the new plan arrives.

### Job

A long-running create, extract, preview, or test operation registered by the
Rust job layer. Jobs expose normalized progress and terminal events and support
cancellation where the core operation permits it.

### Diagnostic Log

The bounded, structured, secret-free lifecycle log owned by the Rust desktop
boundary. Its preferred location is the running installation's `logs/`
directory, with an explicitly reported per-user fallback when the installation
is read-only. It records action kinds, counts, states, and decisions rather than
passwords, opaque tokens, or selected paths.

TZAP create jobs also expose phase-native progress for planning payload,
planning metadata, emitting payload, emitting metadata, and committing output.
Repeated source-byte totals belong to different phases and must not be merged
as unique file bytes; only a terminal completed event represents 100%.

### Preview

A temporary extraction of one archive entry for viewing. The desktop layer
owns launching the associated application and tracking temporary preview paths;
the core owns safe extraction.

### Global Defaults

Persisted, non-secret preferences used to prepopulate archive-creation and
extraction options. Passwords and archive-specific secrets are never global
defaults. A workflow may override a default without mutating the stored value.

### Native Platform

The operating-system adapter composition that supplies the native capability
families required by the Desktop Shell. Every supported platform implements the
applicable Rust capability interfaces, such as default-handler control,
Replacement Migration, secure local-file protection, system icons, and native
drag. Callers use platform-neutral wrapper functions and never select or invoke
operating-system-specific implementations directly. `notApplicable`,
`unavailable`, and `failed` are typed outcomes rather than successful stubs or
platform-specific error strings.

### Native Integration Contract

The cross-platform record of which native capabilities are required, optional,
or not applicable and whether each capability is implemented in source, included
in a package, registered after installation, and enabled for the current user.
Runtime readiness is a separate fifth layer. The contract reports the current
package kind explicitly, defines normalized `available`, `unavailable`,
`failed`, and `notApplicable` outcomes, and binds each layer to verification
evidence while Windows, Linux, and macOS retain separate native adapters for
their operating-system mechanisms.

### macOS Native Host

The bounded Swift/AppKit runtime embedded in the Tauri application. It owns
macOS lifecycle callbacks, Services, system menus, Launch Services, icons, and
file-promise presentation. It emits typed events and never owns archive jobs or
application product screens.

### macOS Extension Suite

The Finder Sync, Quick Look preview and thumbnail, and Spotlight targets built
and signed from this repository. They consume generated contracts or the
metadata-only FFI and perform no general archive or account work.

### Native Launch Inbox

The Rust-owned ordered, bounded, acknowledgement-based queue that joins early
native callbacks and single-instance requests to frontend readiness without
losing, duplicating, or exposing secret-bearing events.

### Native Drag Session

A Rust-owned archive-handle and password-lifetime session paired with a Swift
file-promise drag. Bytes are streamed only after Finder chooses a destination.

### Extension Bindings

Quick Look and Spotlight consume the UniFFI zmanager-ffi crate from the
sibling zmanager checkout (`crates/zmanager-ffi`, staticlib linked into the
extension executables by `scripts/build-macos-native-targets.sh`). The
generated Swift bindings are copied into the Swift package at build time by
`scripts/sync-uniffi-swift-bindings.sh`. Extensions only call the bounded
`tzapPublicMetadataDisplaySummary` entry point — no archive jobs, account
state, private keys, or mutations.

### Release Bundle

The one signed, notarized, and stapled macOS application plus nested host,
extensions, importer, libraries, manifests, and architecture-labelled release
artifacts produced by this repository.

### Replacement Migration

The versioned, idempotent, rollback-aware conversion of old native preferences,
Application Support state, registrations, associations, and install identity to
the Release Bundle.

## Ownership boundaries

### TZAP local identity boundary

The public catalog owns metadata and references; the native secure store owns
private signing keys, recipient keys, and hosted sessions. The desktop may
show capability-gated local state before hosted services are available. It
must not infer authentication from a callback URL, relay payload, or endpoint
presence, and it must not restore the retired secret-bearing hosted-auth
relay described by ADR 0011.

### `src/app`

Owns deterministic workflow state, state transitions, command readiness, pure
derivations, and interfaces for injected effects. It may depend on DTO types but
does not invoke Tauri directly.

### `src/ui`

Owns React rendering and DOM event decoding. UI components render immutable
snapshots and emit typed intents; they do not duplicate workflow decisions or
archive behavior.

### `src/api`

Owns serializable application command DTOs and Tauri invoke wrappers.

### `src/desktop`

Owns concrete adapters for native dialogs, paths, windows, file-manager actions,
Tauri events, file drops, drag-out, clipboard, timers, and preview cleanup.

### `src-tauri`

Owns app-facing Rust commands, validation at the desktop boundary, DTO mapping,
the job registry, and Windows/Linux/macOS platform modules. It delegates archive
semantics to `zmanager-core`.

### `zmanager-core`

Owns archive planning, listing, creation, extraction, testing, format routing,
normalization, collision and overwrite handling, link safety, and archive-bomb
guards. Do not reimplement these behaviors in TypeScript.

## Architectural invariants

- `src/main.ts` is a composition root, not a home for durable workflow state or
  command switches.
- Workspaces are deterministic state machines where practical. Controllers
  coordinate asynchronous effects through injected interfaces.
- Accepted create and extract requests cross one Job Handoff seam. The handoff
  opens one Disposable Task Window and resets submitted Main Window setup
  immediately; job completion never controls Main Window reset.
- The Main Window has no global active-Job permission state. Active Jobs do not
  block commands, drops, browsing, selection, or another accepted start; only
  an unresolved submission guards its own duplicate activation.
- The Main Window never renders job progress or shared job history. Internal
  process accounting is limited to the Shell coordinator counts needed for
  shutdown and close guards; the Main Window owns no accepted-Job state.
- Each Disposable Task Window mirrors one Rust Job plus minimal local UI state.
  It subscribes directly and owns that Job's controls, recovery, output actions,
  and terminal presentation. The Quick Action Coordinator owns only the counts
  needed for process shutdown; neither introduces another shared progress
  lifecycle.
- Toolbar, menu, shortcut, context-menu, tree, details-pane, and row actions
  route through shared typed command seams rather than separate behavior.
- Workflow snapshots are immutable, render-ready plain data. They never contain
  passwords, DOM nodes, mutable collections, or pending Tauri promises.
- Passwords are never logged, persisted, placed in diagnostics, or passed via
  command-line arguments.
- Diagnostic events remain structured and bounded. They use counts and stable
  state names instead of selected paths, request tokens, or free-form secrets.
- Stable workflow and DTO values remain language-neutral. Localization and
  formatting occur at display boundaries.
- Storage-backed preferences and path histories use typed normalization modules;
  do not add ad hoc `localStorage` ownership.
- Platform behavior stays behind desktop adapters, Rust platform modules, or
  packaging code. The supported Tauri runtimes remain one product surface. Every supported Rust
  platform must provide a complete `NativePlatform` adapter; unsupported targets
  must fail compilation instead of inheriting another operating system's code.
- Frontend behavior selects native features from Native Integration Contract
  capability state, never from an operating-system name. Platform names may be
  displayed as diagnostics only.
- Rust and TypeScript command contracts require generated bindings or explicit
  contract coverage when changed.
- A regression fix requires failing-before/passing-after coverage when feasible.
  Architecture moves require characterization coverage and deletion of the old
  ownership path.

## Primary documentation

- `AGENTS.md`: repository working rules and maintainability constraints
- `docs/ARCHITECTURE.md`: authoritative runtime, frontend-module, Job Handoff,
  window-lifecycle, and command architecture
- `docs/REQUIREMENTS.md`: functional, platform, security, and acceptance requirements
- `docs/windows-context-menu-behavior.md`: Windows shell action contract
- `docs/adr/`: durable architectural decisions

## Hosted device retirement is disabled (2026-09-12)

`account_retire_device` is compiled out of the default build and the Device tab no longer offers
the action. The `hosted-revocation` cargo feature re-enables both.

**Why.** Retirement revokes signing identities on the sign server, and the server now requires a
recent admin MFA step-up for the personal revoke paths (`POST /v1/certificates/{id}/revoke`,
`POST /v1/devices/{id}/revoke`) so that a stolen session alone cannot destroy a user's
certificates. The step-up satisfaction is keyed on the **calling session** and lasts 15 minutes,
so a verification performed in the hosted console cannot satisfy this app's session. The desktop
has no step-up flow of its own, so the call could only ever return 403 — and it would do so
*after* the user confirmed a destructive action. Retirement lives in the hosted console until a
step-up prompt exists here.

**To re-enable.** Add a step-up flow (prompt for a code, `POST /v1/me/mfa/step-up`, retry) and
build with `--features hosted-revocation`. `TzapCertificateLifecycleError::AdminMfaRequired`
already separates the recoverable "step up and retry" case from a flat authorization failure.

## Device identity is not reproducible across a fresh install

A device's server-side identity is the SPKI SHA-256 fingerprint of its signing key, on both the
sign and login side. `enroll_or_renew_device_certificate` reuses an existing key by looking up a
`label` in the local identity catalog. The private key itself lives in the OS keyring, but the
reference that locates it (`TzapSecretRef::generate()`) is 24 random bytes and is deliberately
non-discoverable — the only record of it, and of the label, is the catalog file under
`app_data_dir/tzap-state`.

So if the state directory is lost (uninstall, new machine, cleared app data) while the keyring
entry survives, the label lookup misses, a fresh keypair is generated, and the server sees a
**brand-new device**. The old device stays active indefinitely, and with retirement disabled here
it cannot be retired from this app at all. The orphaned keyring entry is never cleaned up.

The intended recovery path already exists server-side and is unused: `/v1/me/key-backup/{public_device_id}`
(GET/PUT/DELETE), with `TzapBackupClient` support in `zmanager-tzap-hosted`. The desktop currently
calls only `fetch_contact_backup`. Wiring key backup into enrollment — upload on enrol, restore on
a fresh install — makes the key reproducible without weakening the non-discoverable-reference
property. Deriving the secret reference from the label instead would also work but deliberately
contradicts that property, and needs a migration for existing installs.
