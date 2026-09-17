# Architecture

## Architecture Goal

ZManager adopts the user-visible manager/task workflow of 7-Zip without copying
its executable or process topology:

- one singleton **Main Window** is the persistent archive browser and operation
  launcher, corresponding to the role of `7zFM.exe`;
- every accepted create, extract, or test job gets one independent **Disposable Task
  Window**, corresponding to the role of `7zG.exe`; and
- the Main Window never becomes a progress surface and never waits for a job to
  finish before it can launch another one.

The decisive transition is **Job Handoff**. When Rust accepts a create,
extract, or test request and returns a Job ID, the frontend records process
activity and opens its Disposable Task Window, clears the submitted operation's
transient setup state when applicable, and returns the Main Window to a
browse-ready state. This reset happens after job start, not after job
completion. A start failure keeps the non-secret setup state available for
correction and retry.

Keep this transition as simple as the 7-Zip File Manager launch model. The Main
Window owns browse/setup state and a short-lived `submissionInFlight` guard only.
It has no global `jobRunning` workflow state: accepted Jobs do not disable
browsing, selection, drops, or the commands used to launch another operation.
Job Handoff is a one-way accepted-start action, not a state machine that follows
the Job to completion.

All durable extraction starts use a replayable accepted-Job feed. Rust accepts
the Job before native-drag preparation, and the shell presents exactly one task
window by Job ID; feed acknowledgements are sent only after presentation. The
same seam covers Main Window and Quick Action extraction, native drag-out,
LocalSend auto-extract while a shell coordinator lease is live, and password
retry replacement Jobs. Preview is the explicit temporary-extraction
exception.

Native drag completion, cancellation, timeout, release, partial failure, and
shutdown are owned by the Rust Job Registry. Platform adapters provide only
the operating-system drag mechanics, while the shared Job cancellation token
interrupts native streams. Progress counts unique logical files and bytes,
including nested files represented by one macOS file promise.

```text
Main Window
  browse/select/configure
       |
       | accepted create/extract/test request
       v
  Job Handoff -----------------------> Job Registry
       |                                   |
       | reset submitted setup             +--> Disposable Task Window A
       v                                   +--> Disposable Task Window B
  browse-ready Main Window                 +--> Disposable Task Window ...
```

Multiple task windows may run concurrently. Each owns the progress and controls
for exactly one job. The Main Window has no job drawer, shared job history,
focused-progress mode, in-workspace progress overlay, or accepted-Job state.
Process-level activity accounting belongs to the Shell coordinator; progress,
controls, recovery, output actions, and terminal state belong to the one-Job
Disposable Task Window.

The user-visible state model has only three owners:

1. the **Main Window** owns reusable browse/setup state and whether one start
   request is currently awaiting acceptance;
2. each **Disposable Task Window** mirrors one Rust Job status and owns only its
   local controls, close prompt, terminal acknowledgement, and recovery UI; and
3. a quick-action-only **coordinator** owns only the pending-request, active-Job,
   and open-task-window counts needed to decide when the hidden process exits.

Do not introduce a shared frontend job-running mode, a manager completion
transition, cross-task focus state, or another progress model.

Fixed-format shell Quick Actions bypass the visible Main Window and go directly
through Job Handoff to a Disposable Task Window. A quick-action-only process
keeps the Main Window hidden and exits when its pending requests, jobs, and task
windows have settled. Main-window shell actions such as **Add to archive...**
may prefill the reusable manager, but starting their job follows the same
handoff-and-reset rule.

Process ownership is selected before Tauri plugin registration:

- normal application launches and archive file-association launches register
  the single-instance plugin and route subsequent normal/file-open intents to
  the existing singleton Main Window process;
- explicit Quick Action arguments and macOS Finder Quick Action launches do not
  register the single-instance plugin on Windows and macOS; every such launch owns an independent
  Tauri process and consumes its own request exactly once. On Linux, however, Quick Actions MUST
  register the single-instance plugin and redirect to the primary instance due to WebKitGTK data directory locking constraints; and
- a Disposable Task Window is a webview window inside its owning Tauri process,
  not a second executable process.

This process isolation is independent of generated window disposition. Most
Quick Actions keep the coordinator webview hidden and open only a Disposable
Task Window. A review action may reveal the reusable Main Window in that
isolated process when its generated disposition is `mainWindow`.

## Layering

```text
Cross-platform Tauri desktop shell
  React views render immutable snapshots and emit typed intents
  app workspaces/controllers own workflow state and Job Handoff
  desktop adapters own windows, dialogs, paths, and runtime integration

Tauri command layer
  app-facing command DTOs, job registry, platform integration

zmanager-core
  archive planning, listing, extraction, creation, safety, format routing

backend crates
  zip, tar/zstd, TZAP, 7z, UnRAR
```

The frontend must not implement archive parsing or extraction. It calls Tauri commands and renders command results.

## Frontend Module Ownership

The frontend target is a small composition root around deep workflow modules.
Depth is measured at each module's interface: callers should get substantial
workflow behavior without learning its internal state representation or effect
sequencing.

```text
src/main.ts
  composition root only

src/app/shell/
  Desktop Shell state and native-launch lifecycle

src/app/workspaces/
  Archive Workspace, Create Workspace, Disposable Task Workflow

src/app/controllers/
  asynchronous orchestration and Job Handoff

src/app/commands/
  shared command availability and execution routing

src/app/display/ and src/app/pathHistory.ts
  language-neutral display context and normalized persisted histories

src/ui/react/ and src/ui/components/ui/
  React rendering, typed intent decoding, shadcn/ui primitives

src/api/
  serializable command DTOs and Tauri invoke wrappers

src/desktop/
  concrete dialogs, paths, windows, clipboard, timers, drag, and runtime adapters
```

### Composition Root

`src/main.ts` may locate stable roots, instantiate the runtime adapter, and
mount React. It does not own durable workflow state, row derivation,
selection/focus, job decisions, request construction, command switches,
storage normalization, or native effect sequencing. Moving those
responsibilities into another broad bootstrap file does not satisfy this goal.

### Shell Workspace

Owns reusable Main Window mode, app-level status, drop decisions, native-launch
state, preview cleanup metadata, and history snapshots. Quick-action-only
coordinator lifecycle is a shell concern; individual job progress is not. The
coordinator remains deliberately small: it observes whether the Main Window
owns the session and the request, active-Job, and task-window counts needed for
shutdown. Its catalog accounting may retain bounded Job IDs to deduplicate
updates, but it does not retain progress snapshots, retry metadata, output
actions, or task-window presentation state.

### Archive Workspace

Owns archive loading state, listing/navigation/search, tree expansion,
selection/focus, table layout, extract/test/preview readiness, password retry
state, and archive command context. It builds language-neutral request inputs
but does not invoke Tauri or render React.

### Create Workspace

Owns sources, authoritative plan revisions, stale-plan guards, inclusion state,
plan browsing, selection/focus, destination and format options, create
readiness, and request construction. Accepted requests are reset through Job
Handoff; rejected requests preserve non-secret setup.

### Job Handoff Controller

Owns the accepted create/extract/test transition shared by the Main Window launch
paths: record accepted process activity, present exactly one Disposable Task
Window, reset the submitted workspace state once, and report presentation
failure without duplicating the accepted Job. Quick Actions use the same
accepted-Job presentation path but have no visible Main Window state to reset.

Its interface stays coarse-grained: accept one normalized Job response and an
optional submitted-state reset. The implementation performs those effects once
and then stops. It does not own Job progress, subscription, completion, task
focus, retry/output metadata, a retry state machine, or manager command
availability. Presentation failure is reported as degraded presentation of an
already accepted Job; it is never converted back into a start failure and never
resubmits the operation.

Password recovery stays inside the failed task surface. A successful retry
creates a new Rust Job and sends that accepted response through the same Job
Handoff seam so it receives a distinct task window. The old failed task closes
only after emitting the accepted replacement; passwords never enter retained
frontend state.

### Quick Action Coordinator

Owns process-presence accounting only: whether this is a hidden
quick-action-only session plus the pending-request, active-Job, and
open-task-window counts. It consumes the Rust Job catalog to reconcile accepted
and terminal Jobs without subscribing to per-Job progress. The same active
count supports Main Window hide-vs-close behavior. When the session is
coordinator-only, it force-destroys the hidden coordinator after all three
counts reach zero. With no remaining windows or Jobs, the isolated Tauri
process exits. Normal singleton sessions never use this forced-destroy path;
their Main Window remains under explicit user control.

### Command Router

Owns language-neutral command availability, disabled reasons, payload
validation, and one execution route for toolbar, menu, shortcut, context-menu,
details-pane, tree, and row-action commands. Views emit typed command intents;
they do not implement parallel command behavior.

### Hierarchical Table

Owns shared folder-like row identity, derivation, navigation, selection, focus,
and keyboard behavior used by Archive and Create workspaces. Workspace-specific
columns, archive semantics, source inclusion rules, and native drag requests
remain outside its interface.

### React Views

React views render immutable, render-ready snapshots and emit typed intents.
Product UI uses React, shadcn/ui primitives, and Tailwind CSS 4 utilities.
Views do not import Tauri, build archive requests, hold workflow decisions, or
communicate through hidden DOM, generated HTML strings, or parallel mutable
state. `src/runtimeBridge.ts`, while it exists, is a compatibility export only;
it is not a renderer or workflow owner.

### Desktop Presentation

The shared React product should read as a compact desktop file utility on every
supported platform. The archive/source table is the primary surface; navigation
and contextual details are supporting panes, and top chrome is command access
rather than content. Platform adapters may supply native menus, dialogs, icons,
drag behavior, and shell integration without creating separate product
workflows.

Tables use stable row height, full-row selection, sticky headers, predictable
keyboard behavior, bounded native icons, and truncation in rows with full values
available in details. Compact layouts collapse supporting panes intentionally
without hiding the active operation command or introducing horizontal page
overflow. Dialogs open at the decision being made, keep their primary action
reachable, and place advanced archive settings behind disclosure when possible.
Passwords are transient and hidden by default.

Long-running progress never occupies the Main Window status area, a drawer, or a
workspace overlay. Each Disposable Task Window uses the same product visual
language while presenting only its own Job, controls, recovery, and output
actions. Visual audits should cover the reusable manager at full, compact, and
minimum sizes plus the independent task surface.

### Display, Storage, API, and Desktop Adapters

Display context resolves locale, translation, and formatting at render seams;
stable workflow values and DTOs remain language-neutral. Preferences and path
histories use typed storage and normalization modules rather than ad hoc
`localStorage` keys. `src/api` owns serializable command DTOs and invoke
wrappers. `src/desktop` owns concrete Tauri/runtime adapters so controllers and
workspaces remain testable without a desktop runtime.

## Command Interface

The command interface should be stable and coarse-grained:

- `healthcheck`
- `project_contract`
- `start_archive_index`, `wait_archive_index`, `get_archive_children`,
  `search_archive_index`, `close_archive_index`
- `test_archive`
- `plan_create`
- `start_create`
- `start_extract`
- `preview_entry`
- `subscribe_job`, `subscribe_job_catalog`, `ack_subscription`,
  `unsubscribe_job`
- `cancel_job`, `pause_job`, `resume_job`
- `dismiss_job`

Commands should return serializable DTOs. The DTOs are allowed to differ from core structs when the UI needs a stable presentation contract.

## Deep Modules

### Desktop Command Core

Owns request validation, calls into `zmanager-core`, maps core errors into UI-safe errors, and returns DTOs.

### Job Registry

Owns long-running job handles, cancellation, retained snapshots, direct
subscriptions, bounded retention, and cleanup. The frontend never holds raw
core handles.

### Job Feed

The Rust Job Registry is also the one authoritative retained Job Feed. It
publishes one immutable Desktop snapshot per Job and a process catalog used for
internal discovery and cleanup.

- Every snapshot has a monotonically increasing decimal-string revision.
  TypeScript compares revisions as arbitrary-precision integers, never as
  JavaScript numbers.
- A late or reconnecting subscriber immediately receives the latest retained
  snapshot. Delivery uses latest-value backpressure with acknowledgement rather
  than an unbounded event queue or correctness-critical polling timer.
- Each Disposable Task Window subscribes directly to exactly its bootstrap Job.
  The Main Window never subscribes to per-Job progress.
- Per-Job subscription and control commands are owner-scoped twice: Tauri grants
  them only to `task-*` windows, and Rust accepts them only when the caller's
  exact label is `task-{jobId}`. The Main Window cannot control or subscribe to
  an individual Job even if a capability manifest regresses.
- The process catalog lets the Shell coordinator reconcile bounded active-Job
  accounting for shutdown and Main Window close behavior. It is not permission
  to retain per-Job presentation state or render a job list/shared history.
  Disposable Task Windows cannot subscribe to the catalog.
- Admission, retained terminal Jobs, and per-Job subscribers have named,
  process-wide bounds. Capacity failure is structured; non-terminal Jobs are
  never silently evicted.
- A terminal success snapshot publishes its summary, output artifacts, and
  available actions atomically. Closing a task window unsubscribes without
  cancelling its Job unless the user explicitly requests cancellation.
- A failed subscription or channel affects only that subscriber. It cannot stop
  publication to other windows or change Job state.

`zmanager-core` remains the owner of format-neutral progress meaning and bounded
producer aggregation. The Desktop Job Feed owns retention, delivery, revisions,
controls, output actions, and process lifecycle. Each Disposable Task Workflow
owns its one-Job presentation, recovery, and completion policy.

### Main Window Manager

The Main Window composes Archive Workspace, Create Workspace, shared command
routing, and controllers. Workspaces own deterministic browse and operation
setup state; React views only render their snapshots and emit intents. A
successful create or extract start crosses the Job Handoff seam and resets the
submitted setup state in one explicit workspace/controller transition. It must
not be implemented as scattered form clearing or DOM manipulation.

The reset removes one-shot inputs, selections, secrets, validation state, and
submission state belonging to the accepted request. It preserves global
defaults, path histories, and reusable manager preferences. Browse context may
be retained where it helps launch the next operation, but the submitted
selection must not remain armed for accidental duplicate execution.

While any Main Window start request is awaiting Rust acceptance, one shared
manager guard rejects duplicate Create, Extract, or Test activation. The guard
ends at acceptance or rejection; accepted Job lifetime is never stored in it.
Once accepted, the manager immediately returns to normal command, drop, browse,
selection, and start behavior. It never waits for a Job snapshot or terminal
event before becoming reusable.

### Disposable Task Workflow

Every accepted create, extract, or test job opens a separate OS window (currently
620×460). The task workflow subscribes to one Job ID, shows live progress,
handles pause/cancel, and applies its own terminal completion policy. Successful
and cancelled jobs auto-close after brief acknowledgement; a failed job remains
open so the error and recovery actions are not lost.

The task state is the authoritative Rust Job status plus minimal local UI state
such as a close prompt or one in-flight recovery action. It does not need a
second progress lifecycle layered over the Job Feed. Password questions and
other recovery actions belong with the failed task experience; a retry that
Rust accepts is handed off as another Job and receives its own task window.

There is no job drawer, shared job history, or in-workspace progress overlay.
Each operation is an independent fire-and-forget unit from the Main Window's
perspective.
See [`adr/0016-pure-7z-job-architecture.md`](adr/0016-pure-7z-job-architecture.md).

User-visible text belongs at the display boundary. Keep internal state, command DTOs,
job events, and archive behavior language-neutral, then render labels and messages
through the frontend localization layer.

### Windows Shell Integration

Owns Explorer context menu registration, file associations, installer hooks, and Windows path integration.

### Linux Shell Integration

Owns `.desktop` files, MIME registration, AppImage/Flatpak/deb/rpm packaging hooks, and XDG integration.

### macOS Runtime Integration

`src-tauri::platform::macos` owns the bounded Rust Adapter. The Swift/AppKit
macOS Native Host owns lifecycle, Services, menus, Launch Services, icons, and
file-promise presentation. The Native Launch Inbox buffers typed callbacks until
the React shell is ready. Native Drag Sessions retain core handles and secrets
only for the lifetime of asynchronous promises. The Finder, Quick Look,
thumbnail, and Spotlight Extension Suite is built under `native/macos` and uses
generated contracts or the Public Metadata FFI. One Release Bundle pipeline
owns nesting, identity, signing, notarization, stapling, installation, and
replacement migration.

Swift/AppKit contains no application-owned product screen and no archive
semantics. Quick Look and Spotlight can parse only bounded public metadata.

### Native Integration Contract

`manifests/native-capabilities.json` is the semantic catalog for native
capabilities across Windows, Linux, and macOS. It records applicability, source
expectations, package kinds, installed probes, user-enabled state, runtime
readiness requirements, normalized failures, and evidence identifiers.

`project_contract` reports the current package kind explicitly and exposes one
snapshot per catalog capability. These layers remain independent:

1. source support;
2. package inclusion;
3. installed registration;
4. user-enabled state; and
5. runtime readiness.

The normalized capability outcome is `available`, `unavailable`, `failed`, or
`notApplicable`. An available first-class capability must have real source
support and every layer required by its catalog declaration. Package or
installed state is never inferred from the operating-system name.

The frontend branches on capability identity and state. It may display the
platform name as diagnostic information, but it must not use that name to
select behavior. Native adapters retain their operating-system mechanisms while
the contract provides shared meaning and comparable evidence.

## Data Flow

Normal manager operation:

```text
User action
  -> typed React intent
  -> workspace/controller request readiness
  -> Tauri invoke
  -> Rust command DTO validation
  -> zmanager-core job start
  -> normalized Job ID
  -> Job Handoff
       -> record active process work and open one Disposable Task Window
       -> reset submitted setup and make Main Window browse-ready
  -> task window subscribes directly and consumes normalized snapshots
```

The Main Window data flow ends at Job Handoff. Later Job snapshots may update
internal process accounting, but they never disable, reset, resize, replace, or
otherwise drive the reusable manager workflow.

Normal file-open requests and explicit Quick Actions share a typed inbox but
have different process policies:

```text
normal launch or file association
  -> register single-instance plugin
  -> existing or new singleton Main Window process
  -> Native Launch Inbox

explicit Quick Action / macOS Finder Quick Action
  -> Windows/macOS: create isolated application process; no single-instance plugin
  -> Linux: register single-instance plugin to route to primary instance (WebKitGTK constraint)
  -> consume versioned ShellActionRequest exactly once
  -> Native Launch Inbox (ordered, bounded, deduplicated)
  -> frontend-ready drain and acknowledgement
  -> generated window-disposition routing
       -> mainWindow: reveal/prefill reusable Main Window
       -> disposableTask: keep Main Window hidden and perform Job Handoff
```

Startup state carries only the generated window-disposition marker needed to
decide whether the Main Window may be revealed. Executable quick-action input
has exactly one ingress: the Native Launch Inbox. The frontend records a
bounded set of completed event IDs before acknowledgement, so an
at-least-once replay within the frontend process can repeat the
acknowledgement but not its operation side effect.

Successful and cancelled Disposable Task Workflows auto-close after brief
acknowledgement. A failed task remains visible so its error and recovery actions
are not discarded. Closing the last terminal task causes the hidden
quick-action-only coordinator to reevaluate its zero-count shutdown invariant
and destroy itself.

## Error Model

Errors should include:

- short code
- user-facing message
- optional recovery hint
- severity
- whether retry is useful

Errors must not include passwords, raw command-line strings, or sensitive path data beyond what the user selected.

## Architecture Guardrails And Verification

- Use the deletion test for every proposed module. If deleting it only inlines
  a pass-through call, it is shallow; if its behavior would spread across
  callers, the module is providing leverage and locality.
- Treat the module interface as the test surface. Workspace and controller
  tests exercise public transitions and injected adapters rather than private
  helpers extracted only for tests.
- Add characterization coverage before moving workflow ownership. Delete the
  old ownership path when the new seam is proven; hidden DOM, duplicate state,
  or a second renderer is not an acceptable migration endpoint.
- Keep Tauri imports in `src/api` and `src/desktop`. App workspaces and
  controllers use injected interfaces.
- Keep passwords out of snapshots, URLs, storage, logs, diagnostics, command
  lines, and persisted retry state.
- Require generated Rust/TypeScript bindings or explicit contract tests when
  command DTOs change.
- Prove Job Handoff at controller interfaces: accepted start performs
  register/open/reset once, rejected start preserves non-secret setup, a second
  operation can start before the first completes, and terminal Job events do
  not mutate the Main Window.
- Prove the manager has no global active-Job permission gate: commands, drops,
  browsing, and selection remain usable while unrelated Jobs run.
- Prove in-process Native Inbox replay idempotency, fast-terminal coordinator
  reconciliation, durable Job Feed reconnect, owner-scoped task controls, and
  native Main Window close routing through coordinator accounting.
- Prove launch-instance classification without consuming request files:
  explicit Quick Actions are isolated, while normal and file-association
  launches register the singleton plugin.
- Prove an idle quick-action-only coordinator force-destroys its hidden window,
  successful/cancelled tasks auto-close, and failed tasks remain visible.
- Prefer direct state and deletion over orchestration. The accepted-start guard,
  one-Job task state, and coordinator shutdown counts are sufficient; do not
  add another lifecycle module unless deleting it would force real complexity
  back into multiple callers.
- Use Vitest for deterministic workflow proof and Playwright for cross-surface
  behavior. Cross-platform desktop smoke checks remain required for native
  windows, drag, shell integration, and packaging behavior.

## Platform Strategy

Windows, Linux, and macOS share the app workspace. In-process platform selection
and behavior live behind `src-tauri::platform`; packaging scripts and external
shell integrations remain explicit platform adapters at their own seams.

Do not create separate products until a platform requirement cannot be cleanly isolated.
