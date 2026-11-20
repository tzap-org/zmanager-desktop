import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = join(import.meta.dirname, "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const lock = read("release-build-inputs.lock");
const entries = lock.split(/\r?\n/).filter((line) => line.trim() && !line.trimStart().startsWith("#"))
  .map((line) => line.trim().split(/\s+/));

test("release input lock has unique sibling URLs, integration branches, and full commit pins", () => {
  assert.ok(entries.length >= 10);
  assert.equal(new Set(entries.map(([name]) => name)).size, entries.length);
  for (const [name, url, branch, sha, extra] of entries) {
    assert.match(name, /^[a-z0-9][a-z0-9.-]*$/);
    assert.match(url, /^https:\/\//);
    assert.match(branch, /^[A-Za-z0-9._/-]+$/);
    assert.match(sha, /^[0-9a-f]{40}$/);
    assert.equal(extra, undefined);
  }
});

test("release lock covers every path-based sibling dependency", () => {
  const manifest = read("src-tauri/Cargo.toml");
  const lockNames = new Set(entries.map(([name]) => name));
  for (const name of ["zmanager", "tzap", "localsend-rs", "forensic-vfs-engine", "aff4", "backhand", "btrfs-core", "dar-core", "zfs-forensic-core", "zip-forensic-core"]) {
    assert.ok(lockNames.has(name), `${name} must be in the release lock`);
  }
  assert.match(manifest, /zmanager-core\s*=\s*\{\s*path\s*=\s*"\.\.\/\.\.\/zmanager\/crates\/zmanager-core"/);
  assert.match(manifest, /zmanager-localsend\s*=\s*\{\s*path\s*=\s*"\.\.\/\.\.\/zmanager\/crates\/zmanager-localsend"/);
  assert.match(manifest, /tzap-core = \{ path = "\.\.\/\.\.\/tzap\/crates\/tzap-core" \}/);
});

test("local and CI sibling resolution preserve local heads and freeze one CI snapshot", () => {
  const resolver = read("scripts/prepare-sibling-inputs.sh");
  assert.match(resolver, /mode="\$\{ZMANAGER_BUILD_MODE:-local\}"/);
  assert.match(resolver, /--resolve-ci/);
  assert.match(resolver, /git ls-remote --exit-code --refs/);
  assert.match(resolver, /git clone --single-branch --depth 1 --branch/);
  assert.match(resolver, /git -C "\$dir" checkout --detach "\$expected"/);
  const workflow = read(".github/workflows/package.yml");
  assert.match(workflow, /resolve-sibling-inputs/);
  assert.match(workflow, /actions\/download-artifact@v7/);
  assert.match(workflow, /--mode snapshot/);
  assert.equal(
    [...workflow.matchAll(/name: Prepare frozen sibling snapshot\s+shell: bash\s+run: bash scripts\/prepare-sibling-inputs\.sh --mode snapshot/g)].length,
    2,
    "both package matrix snapshot steps must run under Bash on Windows",
  );
});

test("release gate checks refreshed clean repositories and release workflows use the committed lock", () => {
  const status = read("scripts/check-sibling-repos.sh");
  assert.match(status, /fetch --prune --no-tags origin/);
  assert.match(status, /for-each-ref[^\n]*refs\/heads/);
  assert.match(status, /dirty worktree/);
  assert.match(status, /unpushed commit/);
  assert.match(status, /behind/);
  const gate = read("scripts/release-gate.sh");
  assert.match(gate, /"\$check" --strict/);
  assert.match(gate, /"\$update" --write/);
  assert.match(gate, /release-build-inputs\.lock/);
  assert.match(gate, /root_dirty=/);
  const workflow = read(".github/workflows/release.yml");
  assert.match(workflow, /scripts\/ensure-sibling-repos\.sh --mode release/);
  assert.match(read("scripts/ensure-sibling-repos.sh"), /scripts\/release-gate\.sh" verify-build/);
  assert.doesNotMatch(workflow, /ZMANAGER_(?:TZAP|ZMANAGER)_REF/);
});

test("PowerShell entry points reuse the same cross-platform sibling implementation", () => {
  assert.match(read("scripts/ensure-sibling-repos.ps1"), /ensure-sibling-repos\.sh/);
  assert.match(read("scripts/check-sibling-repos.ps1"), /check-sibling-repos\.sh/);
});
