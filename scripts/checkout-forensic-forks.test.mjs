import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "zmanager-forensic-forks-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const scripts = join(root, "desktop", "scripts");
  const remote = join(root, "upstream");
  const parent = join(root, "siblings");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(remote);
  copyFileSync(join(import.meta.dirname, "checkout-forensic-forks.mjs"), join(scripts, "checkout-forensic-forks.mjs"));
  git(remote, "init", "--initial-branch=main");
  git(remote, "config", "user.name", "Frank Zhu");
  git(remote, "config", "user.email", "frankmanzhu@hotmail.com");
  writeFileSync(join(remote, ".gitattributes"), "* text eol=lf\n");
  writeFileSync(join(remote, "codec.txt"), "reviewed codec\n");
  git(remote, "add", ".");
  git(remote, "commit", "-m", "Fix codec");
  const revision = git(remote, "rev-parse", "HEAD");
  const pins = join(root, "desktop", "forensic-forks.lock");
  writeFileSync(pins, `# reviewed fork\ncodec ${remote} ${revision}\n`);
  const run = () => spawnSync(process.execPath, [join(scripts, "checkout-forensic-forks.mjs"), parent], { encoding: "utf8" });
  return { root, remote, parent, pins, revision, run, checkout: join(parent, "codec") };
}

test("fork bootstrap clones an exact detached revision and is repeatable", (t) => {
  const f = fixture(t);
  for (let i = 0; i < 2; i++) {
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(git(f.checkout, "rev-parse", "HEAD"), f.revision);
    assert.equal(git(f.checkout, "branch", "--show-current"), "");
    assert.equal(readFileSync(join(f.checkout, "codec.txt"), "utf8"), "reviewed codec\n");
  }
});

test("fork bootstrap refuses a different revision without altering existing work", (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  writeFileSync(join(f.remote, "codec.txt"), "unreviewed codec\n");
  git(f.remote, "commit", "-am", "Change codec");
  writeFileSync(f.pins, `codec ${f.remote} ${git(f.remote, "rev-parse", "HEAD")}\n`);
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /existing work was preserved/);
  assert.equal(git(f.checkout, "rev-parse", "HEAD"), f.revision);
});

test("fork bootstrap refuses dirty reviewed checkouts without discarding edits", (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  writeFileSync(join(f.checkout, "codec.txt"), "local work\n");
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be clean/);
  assert.equal(readFileSync(join(f.checkout, "codec.txt"), "utf8"), "local work\n");
});

test("fork bootstrap fails closed on malformed pins and clone errors", (t) => {
  const f = fixture(t);
  for (const pin of [`../escape ${f.remote} ${f.revision}`, `codec ${f.remote} main`, `codec ${f.remote} ${f.revision} extra`]) {
    writeFileSync(f.pins, pin);
    assert.equal(f.run().status, 1);
  }
  writeFileSync(f.pins, `codec ${join(f.root, "missing")} ${f.revision}`);
  assert.equal(f.run().status, 1);
});
