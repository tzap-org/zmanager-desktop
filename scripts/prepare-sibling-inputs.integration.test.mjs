import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const repositoryRoot = join(import.meta.dirname, "..");
const resolverSource = join(repositoryRoot, "scripts", "prepare-sibling-inputs.sh");
const bash = process.env.BASH ?? "bash";

function command(executable, args, options = {}) {
  return execFileSync(executable, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function git(directory, ...args) {
  return command("git", args, { cwd: directory });
}

function createFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "zmanager-build-inputs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const workspace = join(root, "workspace");
  const scripts = join(workspace, "scripts");
  const parent = join(root, "siblings");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(parent, { recursive: true });
  const resolver = join(scripts, "prepare-sibling-inputs.sh");
  writeFileSync(resolver, readFileSync(resolverSource));

  const seed = join(root, "seed");
  const remote = join(root, "remote.git");
  git(root, "init", "--bare", "--initial-branch=main", remote);
  git(root, "init", "--initial-branch=main", seed);
  git(seed, "config", "user.name", "Build Inputs Test");
  git(seed, "config", "user.email", "build-inputs@example.invalid");
  writeFileSync(join(seed, "tracked.txt"), "initial\n");
  git(seed, "add", "tracked.txt");
  git(seed, "commit", "-m", "initial");
  git(seed, "remote", "add", "origin", remote);
  git(seed, "push", "origin", "main");
  const revision = git(seed, "rev-parse", "HEAD");

  const repoUrl = "https://fixture.invalid/tzap.git";
  const catalog = join(workspace, "inputs.lock");
  writeFileSync(catalog, `tzap ${repoUrl} main ${revision}\n`);
  git(workspace, "init", "--initial-branch=main");
  git(workspace, "config", "user.name", "Build Inputs Test");
  git(workspace, "config", "user.email", "build-inputs@example.invalid");
  git(workspace, "add", "scripts/prepare-sibling-inputs.sh", "inputs.lock");
  git(workspace, "commit", "-m", "fixture workspace");
  const env = {
    ...process.env,
    ZMANAGER_SIBLING_PARENT_DIR: parent,
  };

  return { catalog, env, parent, remote, repoUrl, resolver, revision, root, seed, workspace };
}

function setRemoteUrl(fixture, checkout) {
  git(checkout, "remote", "set-url", "origin", fixture.repoUrl);
}

function localCloneEnvironment(fixture) {
  const shimDirectory = join(fixture.root, "git-shim");
  mkdirSync(shimDirectory);
  const gitName = process.platform === "win32" ? "git.exe" : "git";
  const realGit = process.env.GIT_EXECUTABLE ?? process.env.REAL_GIT ?? process.env.PATH
    .split(delimiter)
    .map((directory) => join(directory, gitName))
    .find(existsSync);
  assert.ok(realGit, "could not locate Git executable on PATH");
  const shim = join(shimDirectory, "git");
  writeFileSync(shim, `#!/bin/sh
if [ "$1" = clone ]; then
  for destination do :; done
  "$REAL_GIT" clone "$LOCAL_REMOTE" "$destination" || exit $?
  "$REAL_GIT" -C "$destination" remote set-url origin "$CANONICAL_ORIGIN"
else
  exec "$REAL_GIT" "$@"
fi
`);
  chmodSync(shim, 0o755);
  return {
    REAL_GIT: realGit,
    LOCAL_REMOTE: fixture.remote,
    CANONICAL_ORIGIN: fixture.repoUrl,
    PATH: `${shimDirectory}:${process.env.PATH}`,
  };
}

function initCheckout(fixture) {
  const checkout = join(fixture.parent, "tzap");
  command("git", ["clone", fixture.remote, checkout], { cwd: fixture.parent });
  git(checkout, "config", "user.name", "Build Inputs Test");
  git(checkout, "config", "user.email", "build-inputs@example.invalid");
  // The resolver validates the canonical HTTPS URL; existing checkouts need
  // only contain the requested commit, so use the fixture's local object store.
  setRemoteUrl(fixture, checkout);
  return checkout;
}

function runResolver(fixture, args, env = fixture.env) {
  return command(bash, [fixture.resolver, "--lockfile", fixture.catalog, ...args], {
    cwd: fixture.workspace,
    env,
  });
}

test("CI resolver captures the configured branch head in a snapshot lock", (t) => {
  const fixture = createFixture(t);
  const gitConfig = join(fixture.root, "gitconfig");
  git(fixture.root, "config", "--file", gitConfig, "--add", `url.file://${fixture.remote}.insteadOf`, fixture.repoUrl);
  const env = { ...fixture.env, GIT_CONFIG_GLOBAL: gitConfig };
  const output = join(fixture.root, "ci-snapshot.lock");

  runResolver(fixture, ["--resolve-ci", output], env);

  const entry = readFileSync(output, "utf8").split(/\r?\n/).find((line) => line.startsWith("tzap "));
  assert.equal(entry, `tzap ${fixture.repoUrl} main ${fixture.revision}`);
});

test("snapshot mode reports the GitHub revision when a container checkout has no .git directory", (t) => {
  const fixture = createFixture(t);
  initCheckout(fixture);
  rmSync(join(fixture.workspace, ".git"), { recursive: true, force: true });
  const env = {
    ...fixture.env,
    GITHUB_SHA: fixture.revision,
    GITHUB_REPOSITORY: "tzap-org/build-inputs-test",
  };

  runResolver(fixture, ["--mode", "snapshot"], env);

  const desktopRow = readFileSync(join(fixture.workspace, "target", "build-inputs-report.tsv"), "utf8")
    .split(/\r?\n/)[1]
    .split("\t");
  assert.equal(desktopRow[3], "DETACHED");
  assert.equal(desktopRow[4], fixture.revision);
  assert.equal(desktopRow[5], "clean");
  assert.equal(desktopRow[6], "snapshot");
  assert.equal(desktopRow[1], "https://github.com/tzap-org/build-inputs-test");
});

test("snapshot mode clones a missing sibling cleanly before checking out its pinned SHA", (t) => {
  // On Windows Git records the rewritten file:// URL as origin during clone,
  // which correctly fails the resolver's canonical-origin validation. The
  // resolver CI job runs on Ubuntu, where Git preserves the HTTPS origin.
  if (process.platform === "win32") {
    t.skip("Git for Windows records rewritten file:// clone URLs as origin");
    return;
  }

  const fixture = createFixture(t);
  const env = { ...fixture.env, ...localCloneEnvironment(fixture) };
  const checkout = join(fixture.parent, "tzap");

  runResolver(fixture, ["--mode", "snapshot"], env);

  assert.equal(git(checkout, "rev-parse", "HEAD"), fixture.revision);
  assert.equal(git(checkout, "branch", "--show-current"), "");
  assert.equal(git(checkout, "status", "--porcelain=v1", "--untracked-files=all"), "");
});

test("snapshot mode detaches at the requested commit and rejects dirty checkouts", (t) => {
  const fixture = createFixture(t);
  const checkout = initCheckout(fixture);

  runResolver(fixture, ["--mode", "snapshot"]);
  assert.equal(git(checkout, "rev-parse", "HEAD"), fixture.revision);
  assert.equal(git(checkout, "branch", "--show-current"), "");

  writeFileSync(join(checkout, "tracked.txt"), "preserve this edit\n");
  assert.throws(
    () => runResolver(fixture, ["--mode", "snapshot"]),
    (error) => /has local changes/.test(`${error.stdout}\n${error.stderr}`),
  );
  assert.equal(readFileSync(join(checkout, "tracked.txt"), "utf8"), "preserve this edit\n");
});

test("local mode preserves dirty sibling work and records its actual head", (t) => {
  const fixture = createFixture(t);
  const checkout = initCheckout(fixture);
  writeFileSync(join(checkout, "tracked.txt"), "local iteration\n");
  const report = join(fixture.root, "report.tsv");

  runResolver(fixture, ["--mode", "local", "--report", report]);

  assert.equal(git(checkout, "rev-parse", "HEAD"), fixture.revision);
  assert.equal(readFileSync(join(checkout, "tracked.txt"), "utf8"), "local iteration\n");
  assert.match(readFileSync(report, "utf8"), /^tzap\t.*\tmain\tmain\t[0-9a-f]{40}\tdirty\tlocal\t/m);
});

test("local mode accepts and reports a fork remote without changing it", (t) => {
  const fixture = createFixture(t);
  const checkout = initCheckout(fixture);
  const forkUrl = "https://github.com/frankmanzhu/tzap.git";
  git(checkout, "remote", "set-url", "origin", forkUrl);
  const report = join(fixture.root, "report.tsv");

  runResolver(fixture, ["--mode", "local", "--report", report]);

  assert.equal(git(checkout, "remote", "get-url", "origin"), forkUrl);
  assert.match(readFileSync(report, "utf8"), /^tzap\thttps:\/\/github\.com\/frankmanzhu\/tzap\.git\tmain\tmain\t[0-9a-f]{40}\tclean\tlocal\t/m);
});

test("snapshot mode still rejects a non-canonical sibling origin", (t) => {
  const fixture = createFixture(t);
  const checkout = initCheckout(fixture);
  git(checkout, "remote", "set-url", "origin", "https://github.com/frankmanzhu/tzap.git");

  assert.throws(
    () => runResolver(fixture, ["--mode", "snapshot"]),
    (error) => /tzap origin mismatch/.test(`${error.stdout}\n${error.stderr}`),
  );
  assert.equal(git(checkout, "rev-parse", "HEAD"), fixture.revision);
});

function createReleaseFixture(t, { drift = false, ffiFails = false } = {}) {
  const fixture = createFixture(t);
  const { workspace, root, seed, remote, repoUrl, revision } = fixture;
  git(seed, "tag", "v1.0.0", revision);
  git(seed, "push", "origin", "v1.0.0");

  const controlled = [
    "tzap-core", "tzap-plugin-keywrap", "tzap-plugin-signing",
    "zmanager-core", "zmanager-tzap-hosted", "zmanager-localsend",
  ];
  const shared = [
    "aff4", "backhand", "btrfs-core", "dar-core", "forensic-vfs-engine",
    "tzap-core", "zfs-forensic-core", "zip", "zip-forensic-core", "zmanager-core",
  ];
  const lockfile = (names) => [...new Set(names)]
    .map((name) => `[[package]]\nname = "${name}"\nversion = "1.0.0"\n`).join("\n");

  const core = join(root, "core");
  const coreRemote = join(root, "core.git");
  const coreUrl = "https://fixture.invalid/zmanager.git";
  const forensicUrl = "https://fixture.invalid/forensic-vfs-engine.git";
  git(root, "init", "--bare", "--initial-branch=main", coreRemote);
  git(root, "init", "--initial-branch=main", core);
  git(core, "config", "user.name", "Build Inputs Test");
  git(core, "config", "user.email", "build-inputs@example.invalid");
  mkdirSync(join(core, "crates", "zmanager-ffi"), { recursive: true });
  writeFileSync(join(core, "crates", "zmanager-ffi", "Cargo.toml"), "# FFI fixture\n");
  writeFileSync(join(core, "Cargo.lock"), lockfile(shared));
  writeFileSync(join(core, "release-build-inputs.lock"),
    `tzap ${repoUrl} main ${revision}\nforensic-vfs-engine ${forensicUrl} main ${revision}\n`);
  git(core, "add", ".");
  git(core, "commit", "-m", "ZManager release manifest");
  git(core, "tag", "v1.0.0");
  const coreRevision = git(core, "rev-parse", "HEAD");
  git(core, "remote", "add", "origin", coreRemote);
  git(core, "push", "--tags", "origin", "main");

  let forensicPin = revision;
  if (drift) {
    writeFileSync(join(seed, "tracked.txt"), "changed dependencies at the same version\n");
    git(seed, "commit", "-am", "Same version with different dependencies");
    forensicPin = git(seed, "rev-parse", "HEAD");
    git(seed, "push", "origin", "main");
  }

  for (const name of [
    "check-sibling-repos.sh", "check-shared-dependency-locks.mjs",
    "ensure-sibling-repos.sh", "release-gate.sh", "update-release-build-inputs.sh",
  ]) {
    writeFileSync(join(workspace, "scripts", name), readFileSync(join(repositoryRoot, "scripts", name)));
  }
  mkdirSync(join(workspace, "src-tauri"));
  writeFileSync(join(workspace, "src-tauri", "Cargo.toml"), "# Desktop fixture\n");
  writeFileSync(join(workspace, "src-tauri", "Cargo.lock"), lockfile([...controlled, ...shared]));
  writeFileSync(join(workspace, ".gitignore"), "/target/\n");
  writeFileSync(join(workspace, "release-build-inputs.lock"),
    `tzap ${repoUrl} main ${revision}\nzmanager ${coreUrl} main ${coreRevision}\nforensic-vfs-engine ${forensicUrl} main ${forensicPin}\n`);
  git(workspace, "add", ".");
  git(workspace, "commit", "-m", "Desktop release inputs");
  const desktopRemote = join(root, "desktop.git");
  git(root, "init", "--bare", "--initial-branch=main", desktopRemote);
  git(workspace, "remote", "add", "origin", desktopRemote);
  git(workspace, "push", "-u", "origin", "main");

  const gitConfig = join(root, "gitconfig");
  for (const [url, path] of [[repoUrl, remote], [forensicUrl, remote], [coreUrl, coreRemote]]) {
    git(root, "config", "--file", gitConfig, "--add", `url.${path}.insteadOf`, url);
  }

  const bin = join(root, "bin");
  mkdirSync(bin);
  const gitName = process.platform === "win32" ? "git.exe" : "git";
  const realGit = process.env.GIT_EXECUTABLE ?? process.env.REAL_GIT ?? process.env.PATH
    .split(delimiter).map((directory) => join(directory, gitName)).find(existsSync);
  assert.ok(realGit, "could not locate Git executable on PATH");
  // Keep fixture fetches on disk while Git reports the canonical URL in the manifest.
  writeFileSync(join(bin, "git"), `#!/bin/sh
if [ "$1" = clone ]; then
  "$REAL_GIT" "$@" || exit $?
  for arg do
    case "$arg" in
      https://fixture.invalid/*) canonical="$arg" ;;
    esac
    destination="$arg"
  done
  if [ -n "$canonical" ]; then
    "$REAL_GIT" -C "$destination" remote set-url origin "$canonical"
  fi
elif [ "$1" = -C ] && [ "$3" = remote ] && [ "$4" = get-url ]; then
  exec "$REAL_GIT" -C "$2" config --get "remote.$5.url"
else
  exec "$REAL_GIT" "$@"
fi
`, { mode: 0o755 });
  const cargoLog = join(root, "cargo.log");
  writeFileSync(join(bin, "cargo"), `#!/bin/sh
printf '%s\\t%s\\n' "$PWD" "$*" >> "$RELEASE_TEST_CARGO_LOG"
case "$*" in
  "tree --locked"*) ;;
  *) exit 90 ;;
esac
case "$*" in
  *zmanager-ffi*) exit "$RELEASE_TEST_FFI_EXIT" ;;
esac
`, { mode: 0o755 });

  const env = {
    ...fixture.env,
    GIT_CONFIG_GLOBAL: gitConfig,
    PATH: `${bin}${delimiter}${process.env.PATH}`,
    REAL_GIT: realGit,
    RELEASE_TEST_CARGO_LOG: cargoLog,
    RELEASE_TEST_FFI_EXIT: ffiFails ? "91" : "0",
    ZMANAGER_RELEASE_TAG: "",
    ZMANAGER_NOTARIZATION_TEST: "false",
  };
  return { ...fixture, env, cargoLog };
}

function verifyRelease(fixture) {
  return command(bash, ["scripts/release-gate.sh", "verify"], {
    cwd: fixture.workspace,
    env: fixture.env,
  });
}

test("pre-tag release verification checks both locked Cargo graphs in a clean sibling layout", (t) => {
  const fixture = createReleaseFixture(t);
  const localTzap = initCheckout(fixture);
  writeFileSync(join(localTzap, "tracked.txt"), "local patch\n");

  assert.match(verifyRelease(fixture), /ready for the desktop release tag/);

  const [desktop, ffi] = readFileSync(fixture.cargoLog, "utf8").trim().split("\n");
  assert.match(desktop, /desktop\ttree --locked .*src-tauri\/Cargo.toml/);
  assert.match(ffi, /desktop\ttree --locked .*--features tzap-online .*zmanager-ffi\/Cargo.toml/);
  assert.equal(readFileSync(join(localTzap, "tracked.txt"), "utf8"), "local patch\n");
  assert.equal(git(fixture.workspace, "status", "--porcelain"), "");
});

test("pre-tag release verification rejects a sibling pin that differs from the tagged ZManager manifest", (t) => {
  const fixture = createReleaseFixture(t, { drift: true });

  assert.throws(() => verifyRelease(fixture), (error) => {
    assert.match(error.stderr, /forensic-vfs-engine pin differs from ZManager/);
    return true;
  });
  assert.equal(existsSync(fixture.cargoLog), false);
});

test("pre-tag release verification stops when the locked FFI graph cannot resolve", (t) => {
  const fixture = createReleaseFixture(t, { ffiFails: true });

  assert.throws(() => verifyRelease(fixture), (error) => {
    assert.match(error.stderr, /macOS FFI dependency graph/);
    return true;
  });
  assert.match(readFileSync(fixture.cargoLog, "utf8"), /zmanager-ffi\/Cargo.toml/);
});
