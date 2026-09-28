import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import test from "node:test";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(scriptsDirectory, "..");

const shellBootstrap = readFileSync(join(scriptsDirectory, "ensure-sibling-repos.sh"), "utf8");
const powershellBootstrap = readFileSync(join(scriptsDirectory, "ensure-sibling-repos.ps1"), "utf8");
const cargoManifest = readFileSync(join(repositoryRoot, "src-tauri", "Cargo.toml"), "utf8");

const siblingDirectories = [
  ["ZMANAGER_TZAP", "tzap"],
  ["ZMANAGER_ZMANAGER", "zmanager"],
  ["ZMANAGER_LOCALSEND", "localsend-rs"],
  ["ZMANAGER_FORENSIC_VFS_ENGINE", "forensic-vfs-engine"],
  ["ZMANAGER_ISO9660_FORENSIC", "iso9660-forensic"],
];

function git(cwd, args) {
  return execFileSync("git", args, {
    ...(cwd ? { cwd } : {}),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function configureGitUser(directory) {
  git(directory, ["config", "user.name", "Sibling update test"]);
  git(directory, ["config", "user.email", "sibling-update-test@example.invalid"]);
}

function createSiblingUpdateFixture() {
  const root = mkdtempSync(join(tmpdir(), "zmanager-sibling-update-"));
  const remote = join(root, "remote.git");
  const seed = join(root, "seed");
  const workspace = join(root, "workspace");
  const script = join(workspace, "scripts", "ensure-sibling-repos.sh");

  mkdirSync(join(workspace, "scripts"), { recursive: true });
  cpSync(join(scriptsDirectory, "ensure-sibling-repos.sh"), script);
  git(undefined, ["init", "--bare", "--initial-branch=main", remote]);
  git(root, ["clone", remote, seed]);
  configureGitUser(seed);
  writeFileSync(join(seed, "tracked.txt"), "base\n");
  git(seed, ["add", "tracked.txt"]);
  git(seed, ["commit", "-m", "base"]);
  git(seed, ["push", "origin", "main"]);

  const env = { ...process.env };
  for (const [prefix, name] of siblingDirectories) {
    env[`${prefix}_REPO`] = remote;
    env[`${prefix}_REF`] = "main";
    env[`${prefix}_DIR`] = join(root, "siblings", name);
  }

  return { env, root, remote, script, seed, workspace };
}

function runUpdater(fixture) {
  return execFileSync("bash", [fixture.script], {
    cwd: fixture.workspace,
    encoding: "utf8",
    env: fixture.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("sibling bootstrap provisions the LocalSend path dependency", () => {
  for (const [name, content] of [
    ["shell", shellBootstrap],
    ["PowerShell", powershellBootstrap],
  ]) {
    assert.match(content, /localsend-rs/,
      `${name} bootstrap must mention the localsend-rs sibling repository`);
    assert.match(content, /ZMANAGER_LOCALSEND_REPO/,
      `${name} bootstrap must expose the LocalSend repository override`);
    assert.match(content, /ZMANAGER_LOCALSEND_REF/,
      `${name} bootstrap must expose the LocalSend ref override`);
    assert.match(content, /ZMANAGER_LOCALSEND_DIR/,
      `${name} bootstrap must expose the LocalSend directory override`);
  }
});

test("published DPP does not require a sibling checkout", () => {
  for (const [name, content] of [
    ["shell", shellBootstrap],
    ["PowerShell", powershellBootstrap],
  ]) {
    assert.doesNotMatch(content, /ZMANAGER_DPP|ensure[_-]sibling[_-]repo[^\n]*dpp|Ensure-SiblingRepo[^\n]*dpp/i,
      `${name} bootstrap must not provision a DPP sibling repository`);
  }
});

test("published NTFS and UDF adapters do not require sibling checkouts", () => {
  for (const [name, content] of [
    ["shell", shellBootstrap],
    ["PowerShell", powershellBootstrap],
  ]) {
    assert.doesNotMatch(content, /ntfs-forensic|udf-forensic/i,
      `${name} bootstrap must use the published NTFS and UDF adapters`);
  }
});

test("LocalSend Cargo path dependency has a matching sibling bootstrap entry", () => {
  assert.match(cargoManifest, /zmanager-localsend\s*=\s*\{\s*path\s*=\s*"\.\.\/\.\.\/zmanager\/crates\/zmanager-localsend"/);
  assert.match(shellBootstrap, /ensure_sibling_repo\s+"localsend-rs"/);
  assert.match(powershellBootstrap, /Ensure-SiblingRepo\s+-Name\s+"localsend-rs"/);
});

test("sibling bootstrap does not fetch unrelated release tags during branch updates", () => {
  assert.match(shellBootstrap, /fetch --prune --no-tags origin/);
  assert.match(shellBootstrap, /pull --rebase --autostash --no-tags origin/);
  assert.match(powershellBootstrap, /"fetch", "--prune", "--no-tags", "origin"/);
  assert.match(powershellBootstrap, /"pull", "--rebase", "--autostash", "--no-tags", "origin"/);
});

test("sibling update failures are build-blocking", () => {
  for (const [name, content] of [
    ["shell", shellBootstrap],
    ["PowerShell", powershellBootstrap],
  ]) {
    assert.doesNotMatch(content, /Warning: git update failed/,
      `${name} bootstrap must not continue after a failed sibling update`);
    assert.match(content, /refusing to build/,
      `${name} bootstrap must make update failures build-blocking`);
  }
});

test("shell updater rebases local commits and reapplies dirty edits", () => {
  const fixture = createSiblingUpdateFixture();
  try {
    runUpdater(fixture);

    const zmanager = join(fixture.root, "siblings", "zmanager");
    configureGitUser(zmanager);
    writeFileSync(join(zmanager, "local.txt"), "local commit\n");
    git(zmanager, ["add", "local.txt"]);
    git(zmanager, ["commit", "-m", "local commit"]);
    writeFileSync(join(zmanager, "tracked.txt"), "base\nlocal dirty edit\n");

    writeFileSync(join(fixture.seed, "remote.txt"), "remote commit\n");
    git(fixture.seed, ["add", "remote.txt"]);
    git(fixture.seed, ["commit", "-m", "remote commit"]);
    const remoteCommit = git(fixture.seed, ["rev-parse", "HEAD"]);
    git(fixture.seed, ["push", "origin", "main"]);

    runUpdater(fixture);

    assert.equal(git(zmanager, ["merge-base", "--is-ancestor", remoteCommit, "HEAD"]), "");
    assert.match(git(zmanager, ["log", "--format=%s"]), /^local commit$/m);
    assert.match(readFileSync(join(zmanager, "tracked.txt"), "utf8"), /local dirty edit/);
    assert.equal(readFileSync(join(zmanager, "remote.txt"), "utf8"), "remote commit\n");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("shell updater stops on an autostash conflict", () => {
  const fixture = createSiblingUpdateFixture();
  try {
    runUpdater(fixture);

    const tzap = join(fixture.root, "siblings", "tzap");
    writeFileSync(join(tzap, "tracked.txt"), "local conflicting edit\n");
    writeFileSync(join(fixture.seed, "tracked.txt"), "remote conflicting edit\n");
    git(fixture.seed, ["add", "tracked.txt"]);
    git(fixture.seed, ["commit", "-m", "conflicting remote edit"]);
    git(fixture.seed, ["push", "origin", "main"]);

    let updateError;
    let updateOutput;
    try {
      updateOutput = runUpdater(fixture);
    } catch (error) {
      updateError = error;
    }
    if (!updateError) {
      console.error("unexpected successful updater output:", updateOutput);
      console.error("tzap status:", git(tzap, ["status", "--short"]));
      console.error("tzap stash:", git(tzap, ["stash", "list"]));
    }
    assert.ok(updateError, "the updater must fail when autostash cannot be reapplied");
    assert.match(`${updateError.stdout}\n${updateError.stderr}`, /Unable to update tzap[\s\S]*refusing to build/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
