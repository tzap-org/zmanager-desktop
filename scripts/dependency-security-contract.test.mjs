import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");

test("security workflow audits npm and every desktop Rust lockfile without advisory exceptions", () => {
  const workflow = read(".github/workflows/security-audit.yml");
  for (const trigger of ["push:", "pull_request:", "schedule:", "workflow_dispatch:"]) {
    assert.ok(workflow.includes(trigger), `missing ${trigger}`);
  }
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /npm audit --audit-level=low/);
  for (const lockfile of ["src-tauri/Cargo.lock", "native/windows-shell-extension/Cargo.lock", "crates/zmanager-shell-contract/Cargo.lock", "vendor/glib/Cargo.lock"]) {
    assert.ok(workflow.includes(lockfile), `missing ${lockfile}`);
  }
  assert.match(workflow, /cargo audit --deny yanked --file/);
  assert.match(workflow, /repository: tzap-org\/zmanager/);
  assert.match(workflow, /ref: \$\{\{ steps\.core\.outputs\.revision \}\}/);
  assert.match(workflow, /cargo audit --deny yanked --file \.audit\/core\/Cargo.lock/);
  assert.doesNotMatch(workflow, /continue-on-error|--ignore|\|\| true/);
  assert.doesNotMatch(workflow, /docs\/|ensure-sibling-repos|secrets\./);
});

test("forensic patches have immutable checkout pins and bootstrap on both platforms", () => {
  const manifest = read("src-tauri/Cargo.toml");
  const pins = read("forensic-forks.lock").split("\n").filter((line) => line.trim() && !line.startsWith("#"));
  assert.equal(pins.length, 6);
  for (const line of pins) {
    const [name, repository, revision, extra] = line.split(/\s+/);
    assert.equal(extra, undefined);
    assert.match(repository, /^https:\/\/github\.com\/frankmanzhu\//);
    assert.match(revision, /^[0-9a-f]{40}$/);
    const path = name === "backhand" ? "../../backhand/backhand" : `../../${name}/core`;
    assert.ok(manifest.includes(`path = "${path}"`), `${name} must be patched at the desktop workspace root`);
  }
  assert.match(manifest, /^tzap-core = \{ path = "\.\.\/\.\.\/tzap\/crates\/tzap-core" \}$/m);
  for (const script of ["scripts/ensure-sibling-repos.sh", "scripts/ensure-sibling-repos.ps1"]) {
    assert.ok(read(script).includes("checkout-forensic-forks.mjs"), `${script} must provision the patches`);
  }
});

test("AFF4 and archive-core share ZIP forensic 0.2.2 without the retired checkout", () => {
  const manifest = read("src-tauri/Cargo.toml");
  const pins = read("forensic-forks.lock");
  assert.match(manifest, /^zip-forensic-core = \{ path = "\.\.\/\.\.\/zip-forensic-core\/core" \}$/m);
  assert.doesNotMatch(manifest + pins, /zip-forensic-core-0[.12]/);
  const packages = read("src-tauri/Cargo.lock").split("[[package]]");
  const zip = packages.filter((entry) => /^\s*name = "zip-forensic-core"$/m.test(entry));
  assert.equal(zip.length, 1);
  assert.match(zip[0], /version = "0\.2\.2"/);
  assert.doesNotMatch(zip[0], /source =|checksum =/);
  for (const name of ["aff4", "archive-core"]) {
    const entry = packages.find((entry) => entry.includes(`name = "${name}"\n`));
    assert.ok(entry, `${name} must be resolved`);
    assert.match(entry, /"zip-forensic-core",/);
  }
});

test("Fedora test and artifact jobs install Rust before checking sibling lockfiles", () => {
  const workflow = read(".github/workflows/package.yml");
  const prerequisites = workflow.split("      - name: Install Fedora prerequisites\n").slice(1);
  assert.equal(prerequisites.length, 2, "both test and package jobs need Fedora prerequisites");
  for (const section of prerequisites) {
    const step = section.split("\n      - name:")[0];
    const install = step.match(/dnf install -y ([^\n]+)/);
    assert.ok(install, "Fedora must install prerequisites");
    for (const tool of ["rust", "cargo"]) {
      assert.ok(install[1].split(/\s+/).includes(tool), `Fedora must install ${tool} before sibling validation`);
    }
    assert.ok(step.indexOf(install[0]) < step.indexOf("scripts/ensure-sibling-repos.sh"));
  }
});

test("the patched GLib source uses a mutable out parameter and retains its upstream identity", () => {
  const manifest = read("src-tauri/Cargo.toml");
  assert.match(manifest, /glib = \{ path = "\.\.\/vendor\/glib" \}/);
  const source = read("vendor/glib/src/variant_iter.rs");
  const body = source.slice(source.indexOf("fn impl_get", source.indexOf("impl<'a> VariantStrIter")), source.indexOf("fn impl_get", source.indexOf("impl<'a> VariantStrIter")) + 900);
  assert.match(body, /let mut p/);
  assert.match(body, /&mut p/);
  assert.doesNotMatch(body, /&p\b/);
  assert.match(read("vendor/glib/Cargo.toml"), /version = "0\.18\.5"/);
  assert.ok(read("vendor/glib/LICENSE").length > 100);
});

test("package and release jobs wait for the reusable security gate", () => {
  assert.match(read(".github/workflows/security-audit.yml"), /workflow_call:/);
  for (const path of [".github/workflows/package.yml", ".github/workflows/release.yml"]) {
    const workflow = read(path);
    assert.match(workflow, /security:[\s\S]*?uses: \.\/\.github\/workflows\/security-audit\.yml/);
    const jobs = path.endsWith("package.yml") ? ["test"] : ["package-macos", "package-windows", "package-deb", "package-rpm"];
    for (const job of jobs) {
      assert.ok(workflow.includes(`  ${job}:\n    needs: security`), `${job} must wait for security`);
    }
  }
});

test("the product lockfile resolves GLib 0.18 to the patched local source", () => {
  const lockfile = read("src-tauri/Cargo.lock");
  const packages = lockfile.split("[[package]]");
  const glib = packages.filter((entry) => /^\s*name = "glib"\nversion = "0\.18\.5"/m.test(entry));
  assert.equal(glib.length, 1);
  assert.doesNotMatch(glib[0], /source =|checksum =/);
});

test("the product lockfile uses the reviewed codec sources and excludes yanked crypto-bigint", () => {
  const packages = read("src-tauri/Cargo.lock").split("[[package]]");
  const packageEntries = (name) => packages.filter((entry) => new RegExp(`^\\s*name = "${name}"$`, "m").test(entry));
  const versions = (name) => packageEntries(name).map((entry) => entry.match(/^version = "([^"]+)"/m)?.[1]);

  assert.deepEqual(versions("backhand"), ["0.25.5"]);
  assert.deepEqual(versions("tzap-core"), ["0.2.6"]);
  assert.deepEqual(versions("zstd"), ["0.14.3"]);
  assert.deepEqual(versions("zstd-safe"), ["8.2.0"]);
  assert.deepEqual(versions("crypto-bigint"), ["0.7.10"]);
});

test("release pins the fixed core and bootstraps reject lockfile drift", () => {
  const reviewedCoreRevision = read(".github/workflows/release.yml").match(/ZMANAGER_ZMANAGER_REF: ([0-9a-f]{40})/)?.[1];
  assert.ok(reviewedCoreRevision, "release must pin the reviewed core commit");
  assert.ok(read(".github/workflows/release.yml").includes(`ZMANAGER_ZMANAGER_REF: ${reviewedCoreRevision}`));
  assert.match(read("scripts/ensure-sibling-repos.sh"), /cargo tree --locked --all-features --target all/);
  assert.match(read("scripts/ensure-sibling-repos.ps1"), /"tree", "--locked", "--all-features", "--target", "all"/);
  for (const path of ["scripts/ensure-sibling-repos.sh", "scripts/ensure-sibling-repos.ps1"]) {
    assert.ok(read(path).includes("400c3d719c4afe354b3d21d67f71c39092059eee"));
    const coreRevision = read(".github/workflows/release.yml").match(/ZMANAGER_ZMANAGER_REF: ([0-9a-f]{40})/)?.[1];
    assert.ok(coreRevision && read(path).includes(coreRevision), `${path} must use the audited core revision`);
    assert.equal(coreRevision, "1cc01b9e5dc0f2fcf0a3a2eb840062f783bfcfc2");
  }
});
