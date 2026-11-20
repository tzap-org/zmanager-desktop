# Sibling build inputs

## Goal

Build `zmanager` and `zmanager-desktop` from their sibling source checkouts in
local development and CI. Keep the exact sibling commits visible for every
build, and make release builds reproducible from a reviewed commit lock. The
controlled release order is TZAP first, ZManager second, desktop last.

## Source of truth

This page is the canonical operator guide for sibling build modes, release
steps, and provenance. Each product's `release-build-inputs.lock` is the
authoritative inventory of sibling repositories and release SHAs; the CI
snapshot lock is authoritative for the commits selected in a particular run.
The scripts and workflow files are the executable authority for how those
inputs are prepared and checked. Other documentation should link here instead
of maintaining a second procedure.

## Build modes

| Mode | Sibling revision selection | Worktree behavior |
| --- | --- | --- |
| Local | Current `HEAD` in each existing sibling checkout. A missing checkout is cloned at the configured integration branch. | Existing checkouts are preserved, including dirty or detached work. The report records branch, SHA, and dirty state. |
| CI | The configured integration branch tip is resolved once near workflow start and written to a temporary snapshot lock. All matrix jobs check out those exact SHAs. | CI uses detached, clean checkouts and uploads an input report with the build artifacts. |
| Release | Full commit SHAs in that product's committed `release-build-inputs.lock`. | Release setup fails on dirty checkouts and uses detached commits. It never advances refs or regenerates the lock. |

Local and CI builds use the same inputs when local sibling heads match the
configured remote branch heads resolved by CI. Compare the reported SHAs to
confirm parity or check out the SHAs from the CI report to reproduce a run.
Local changes are allowed for iteration and are clearly identified in the
report.

## The release input lock

Both product repositories use `release-build-inputs.lock` as the sibling
inventory and release pin file. Its columns are:

```text
checkout-name canonical-repository-url integration-branch release-commit-sha
```

The integration branch selects CI inputs and provides a clone target when a
local checkout is missing. The release SHA is the only source revision used by
release builds. Lock generation writes the SHA from each current checkout;
URLs, checkout names, and branches remain reviewed configuration.

Each product has a separate lock because the products can depend on different
revisions of shared forks. The ZManager lock includes TZAP, LocalSend, the
forensic engine, and the forensic forks. The desktop lock includes ZManager,
TZAP, LocalSend, the forensic engine, ISO support, and the forensic forks. A
product does not list itself in its own lock; its tag and commit are recorded
in build provenance. Existing `forensic-forks.lock` entries were migrated into
this single release lock so a checkout has only one release pin.

## Release sequence and gates

1. Release TZAP and confirm its tag and crate publication are available before
   starting the ZManager release. The ZManager gate verifies the TZAP source
   tag and Cargo.lock version alignment; publication availability is an
   operator check.
2. In `zmanager`, run `bash scripts/release-gate.sh prepare`. It fetches each
   repository's `origin`, checks every repository is clean and fully pushed,
   regenerates the ZManager lock, and verifies that the pinned TZAP commit has
   a release tag and that ZManager's locked TZAP crate versions match it.
3. Review, commit, and push `zmanager/release-build-inputs.lock`. Then run
   `bash scripts/release-gate.sh verify` and tag/publish ZManager.
4. In `zmanager-desktop`, run the same `prepare` command after ZManager is
   released. It requires both locked TZAP and ZManager commits to have release
   tags and checks their versions against the desktop Cargo lock.
5. Review, commit, and push the desktop release lock. Run `verify`, then tag
   and release `zmanager-desktop`.
6. Release workflows check out the committed sibling SHAs and run
   `bash scripts/release-gate.sh verify-build` before packaging.

The check-in gate fetches remotes and fails on dirty or untracked files,
stashes, commits not pushed, branches behind their upstream, missing upstreams,
incorrect remotes or integration branches, and fetch errors. It names the
repository, branch, and commit counts so the developer or agent can resolve
the issue. It never commits or pushes changes. After the lock is pushed, the
`verify` command checks repository freshness and confirms the lock still
matches. A tag cannot silently move inputs after that point.

Sibling inspection and setup have PowerShell wrappers. The release gate and
lock updater are Bash scripts; run them from PowerShell with Git Bash available
on `PATH`:

```powershell
.\scripts\check-sibling-repos.ps1 -Fetch
bash scripts/release-gate.sh prepare
git diff -- release-build-inputs.lock
bash scripts/release-gate.sh verify
```

Run these in the repository being released. Do not run `prepare` if sibling
changes are still uncommitted or unpushed; the strict check reports them.

## CI snapshots and provenance

The package CI workflows first run:

```sh
bash scripts/prepare-sibling-inputs.sh \
  --lockfile release-build-inputs.lock \
  --resolve-ci target/ci-sibling-inputs.lock
```

They upload that temporary lock and make every build/test matrix job download
and consume it in `snapshot` mode. Branch movement during the workflow cannot
change its sibling sources. Release jobs use the committed release lock
instead.

`target/build-inputs-report.tsv` records the product commit and dirty state,
each sibling URL, configured integration branch, checked-out branch, commit
SHA and dirty state, the build mode, and the release tag when the workflow is
running for a tag. CI uploads the report with its artifacts. Artifact hashes
belong in a separate attestation or release index, not inside the artifact
whose digest they describe.

The shared commands are:

- `scripts/prepare-sibling-inputs.sh` — local, CI snapshot, or release setup;
- `scripts/check-sibling-repos.sh` — clean, pushed, and remote freshness check;
- `scripts/update-release-build-inputs.sh` — generate or verify lock SHAs;
- `scripts/release-gate.sh` — prepare, verify, or verify a release build.

PowerShell entry points call the same shell implementations on Windows. Cargo
resolution and cross-repository lock checks run after sibling setup.

## Boundaries

- Sibling Cargo dependencies stay as path dependencies.
- Local mode does not fetch, switch, stash, or discard existing sibling work.
- CI pins one remote branch snapshot for each workflow run; later runs may
  resolve newer commits.
- Release mode uses full commit SHAs and fails closed if a checkout cannot
  match the lock.
- This source-input design does not promise identical output bytes across
  operating systems or signing environments. Toolchain and runner images are
  recorded separately.

## Related implementation

- [ZManager build inputs](https://github.com/tzap-org/zmanager/blob/main/docs/BUILD_INPUTS.md)
- [Developer setup](developer-setup.md)
- [Security policy](security.md)
- [Sibling inventory and release pins](../release-build-inputs.lock)
- [Package CI](../.github/workflows/package.yml)
- [Release CI](../.github/workflows/release.yml)
