import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");

test("security workflow blocks all npm advisories and audits every desktop Rust lockfile", () => {
  const workflow = read(".github/workflows/security-audit.yml");
  for (const trigger of ["push:", "pull_request:", "schedule:", "workflow_dispatch:"]) {
    assert.ok(workflow.includes(trigger), `missing ${trigger}`);
  }
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /npm audit --audit-level=low/);
  assert.doesNotMatch(workflow, /picomatch|allowlist|exception/i);
  for (const lockfile of ["src-tauri/Cargo.lock", "native/windows-shell-extension/Cargo.lock", "crates/zmanager-shell-contract/Cargo.lock", "vendor/glib/Cargo.lock"]) {
    assert.ok(workflow.includes(lockfile), `missing ${lockfile}`);
  }
  assert.match(workflow, /cargo audit --deny yanked --file/);
  assert.match(workflow, /repository: tzap-org\/zmanager/);
  assert.match(workflow, /ref: \$\{\{ steps\.core\.outputs\.core_revision \}\}/);
  assert.match(workflow, /repository: tzap-org\/tzap/);
  assert.match(workflow, /tzap_revision/);
  assert.ok(workflow.includes(".audit/core/release-build-inputs.lock"));
  assert.ok(workflow.includes("checkout-release-inputs.mjs .audit"));
  assert.ok(workflow.includes("cargo update --package tzap-core"));
  assert.ok(workflow.includes("cargo update --package crypto-bigint"));
  assert.ok(workflow.includes("cargo update --package url"));
  assert.ok(workflow.includes("cargo audit --deny yanked --file Cargo.lock"));
  assert.doesNotMatch(workflow, /continue-on-error|--ignore|\|\| true/);
  assert.doesNotMatch(workflow, /--ignore|audit-level=(?:moderate|high|critical)/);
  assert.doesNotMatch(workflow, /docs\/|ensure-sibling-repos|secrets\./);
});

test("forensic patches have immutable checkout pins and bootstrap on both platforms", () => {
  const manifest = read("src-tauri/Cargo.toml");
  const pins = read("release-build-inputs.lock").split("\n").filter((line) => line.trim() && !line.startsWith("#"));
  assert.equal(pins.length, 8);
  for (const line of pins) {
    const [name, repository, branch, revision, extra] = line.split(/\s+/);
    assert.equal(extra, undefined);
    assert.match(repository, /^https:\/\/github\.com\/(?:frankmanzhu|tzap-org)\//);
    assert.match(branch, /^[A-Za-z0-9._/-]+$/);
    assert.match(revision, /^[0-9a-f]{40}$/);
  }
  for (const name of ["backhand", "btrfs-core", "zfs-forensic-core"]) {
    const path = name === "backhand" ? "../../backhand/backhand" : `../../${name}/core`;
    assert.ok(manifest.includes(`path = "${path}"`), `${name} must be patched at the desktop workspace root`);
  }
  assert.match(manifest, /^tzap-core = \{ path = "\.\.\/\.\.\/tzap\/crates\/tzap-core" \}$/m);
  for (const script of ["scripts/ensure-sibling-repos.sh", "scripts/ensure-sibling-repos.ps1"]) {
    assert.ok(/(?:prepare|ensure)-sibling-repos\.sh/.test(read(script)), `${script} must provision the sibling inputs`);
  }
});

test("AFF4 and archive-core share the published ZIP forensic release", () => {
  const manifest = read("src-tauri/Cargo.toml");
  assert.doesNotMatch(manifest, /^zip-forensic-core = \{ path = /m);
  const packages = read("src-tauri/Cargo.lock").split("[[package]]");
  const zip = packages.filter((entry) => /^\s*name = "zip-forensic-core"$/m.test(entry));
  assert.equal(zip.length, 1);
  assert.match(zip[0], /version = "0\.2\.3"/);
  assert.match(zip[0], /source = "registry\+https:\/\/github\.com\/rust-lang\/crates\.io-index"/);
  assert.match(zip[0], /checksum = /);
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
      assert.match(workflow, new RegExp(`  ${job}:\\n    needs: (?:security|\\[[^\\]]*security)`), `${job} must wait for security`);
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
  assert.deepEqual(versions("tzap-core"), ["0.3.0"]);
  assert.deepEqual(versions("tzap-plugin-keywrap"), ["0.3.0"]);
  assert.deepEqual(versions("tzap-plugin-signing"), ["0.3.0"]);
  assert.deepEqual(versions("openssl"), ["0.10.82"]);
  assert.deepEqual(versions("openssl-sys"), ["0.9.118"]);
  assert.doesNotMatch(packageEntries("tzap-core")[0], /source =|checksum =/,
    "tzap-core must resolve to the local patch provisioned by the sibling bootstrap");
  assert.deepEqual(versions("zstd"), ["0.14.3"]);
  assert.deepEqual(versions("zstd-safe"), ["8.2.0"]);
  assert.deepEqual(versions("crypto-bigint"), ["0.7.10"]);
  assert.deepEqual(versions("url"), ["2.5.9"]);
});

test("release lock captures controlled sibling commits and gate verifies them", () => {
  const entries = read("release-build-inputs.lock").split("\n")
    .filter((line) => line.trim() && !line.startsWith("#"))
    .map((line) => line.split(/\s+/));
  const reviewedCoreRevision = entries.find(([name]) => name === "zmanager")?.[3];
  const reviewedTzapRevision = entries.find(([name]) => name === "tzap")?.[3];
  assert.ok(reviewedCoreRevision, "release lock must pin the reviewed core commit");
  assert.ok(reviewedTzapRevision, "release lock must pin the reviewed TZAP commit");
  assert.match(read(".github/workflows/release.yml"), /scripts\/ensure-sibling-repos\.sh --mode release/);
  assert.match(read("scripts/ensure-sibling-repos.sh"), /cargo tree --locked --all-features --target all/);
  assert.match(read("scripts/ensure-sibling-repos.sh"), /release-gate\.sh" verify-build/);
  assert.match(read("scripts/ensure-sibling-repos.ps1"), /ensure-sibling-repos\.sh/);
  assert.match(read("scripts/release-gate.sh"), /refs\/tags\/\$zmanager_tag\^\{commit\}/);
  assert.match(read("scripts/release-gate.sh"), /require_tagged_commit tzap/);
  assert.match(read("scripts/release-gate.sh"), /ZMANAGER_NOTARIZATION_TEST/);
  assert.equal(reviewedCoreRevision, "b3e54e1be5fb537f6b05211d9397a2e91b28be08");
  assert.equal(reviewedTzapRevision, "67bedbfc1f77190596ad9f0c2dc8b286e3d23d72");
  assert.match(read(".github/workflows/security-audit.yml"), /check-shared-dependency-locks\.mjs/);
  assert.match(read("scripts/ensure-sibling-repos.sh"), /check-shared-dependency-locks\.mjs/);
  const opensslSetup = read("scripts/pinned-openssl.sh");
  assert.match(opensslSetup, /zmanager\/scripts\/build-openssl\.py/);
  assert.match(opensslSetup, /OPENSSL_STATIC=1/);
  assert.match(opensslSetup, /OPENSSL_NO_VENDOR=1/);
  assert.match(opensslSetup, /e08c7ad5e3f31488eb622515da4434a858038873b07fa1f021271c98bed8e2fe/);
  const windowsOpenSslSetup = read("scripts/setup-windows-static-env.ps1");
  assert.match(windowsOpenSslSetup, /3\.5\.9/);
  assert.match(windowsOpenSslSetup, /cargo\\s\+\(test\|check\|build\|clippy\)/);
  assert.match(read("scripts/test-windows-standalone-staging.ps1"), /-Run "tauri build"/);
  assert.match(read("scripts/generate-third-party-notices.py"), /collect_pinned_openssl_notice/);
});

test("release packaging and security audit check out the same resolved commit", () => {
  const release = read(".github/workflows/release.yml");
  const audit = read(".github/workflows/security-audit.yml");
  const job = (workflow, name) => workflow
    .split(/^  (?=\w[\w-]*:\n)/m)
    .find((section) => section.startsWith(name + ":\n")) ?? "";

  const resolve = job(release, "resolve-revision");
  assert.ok(resolve.includes("format('refs/tags/{0}', inputs.tag)"), "resolve a manual publishing tag as a tag ref");
  assert.ok(resolve.includes("github.sha"), "retain the event commit for notarization tests and tag pushes");
  assert.match(resolve, /git rev-parse HEAD/);
  assert.match(job(release, "security"), /checkout_ref: \$\{\{ needs\.resolve-revision\.outputs\.sha \}\}/);
  for (const name of ["package-macos", "package-windows", "package-deb", "package-rpm", "notarization-test-inputs", "publish"]) {
    assert.match(job(release, name), /ref: \$\{\{ needs\.resolve-revision\.outputs\.sha \}\}/, name);
  }
  for (const name of ["npm", "rust", "glib", "core"]) {
    assert.match(job(audit, name), /ref: \$\{\{ inputs\.checkout_ref \}\}/, name);
  }
});

test("desktop LAN receiving requires explicit consent for file requests", () => {
  const receiver = read("src-tauri/src/localsend.rs");
  assert.match(receiver, /\.start_receiver\([\s\S]*?auto_accept: false/);
  assert.equal((receiver.match(/\.respond_to_transfer\(/g) ?? []).length, 1,
    "only the explicit response command may accept a transfer");
  assert.doesNotMatch(read("src/ui/react/dialogs/LocalSendIncomingTransferBanner.tsx"), /alwaysAccept/);
});
