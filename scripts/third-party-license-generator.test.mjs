import assert from "node:assert/strict";
import { access, chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const generator = path.join(root, "scripts", "generate-third-party-notices.py");

test("third-party license generator copies Rust and production npm license files", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "zmanager-license-generator-"));
  const bin = path.join(workspace, "bin");
  const registryRoot = path.join(workspace, "registry", "demo-crate-1.0.0");
  const pathPackageRoot = path.join(workspace, "path-package");
  const npmRoot = path.join(workspace, "node_modules", "demo-package");
  await mkdir(path.join(workspace, "src-tauri"), { recursive: true });
  await mkdir(bin, { recursive: true });
  await mkdir(registryRoot, { recursive: true });
  await mkdir(pathPackageRoot, { recursive: true });
  await mkdir(npmRoot, { recursive: true });

  const workspaceId = "path+file:///workspace#zmanager-desktop@1.0.0";
  const registryId = "registry+https://github.com/rust-lang/crates.io-index#demo-crate@1.0.0";
  const pathPackageId = "path+file:///sibling#licensed-path@1.0.0";
  const metadataPath = path.join(workspace, "metadata.json");
  await writeFile(path.join(registryRoot, "LICENSE"), "demo rust license\n");
  await writeFile(path.join(pathPackageRoot, "license.txt"), "path package license\n");
  await writeFile(path.join(pathPackageRoot, "COPYRIGHT"), "Upstream authors\n");
  await writeFile(path.join(npmRoot, "package.json"), JSON.stringify({ name: "demo-package", version: "2.0.0" }));
  await writeFile(path.join(npmRoot, "LICENSE"), "demo npm license\n");
  await writeFile(path.join(workspace, "package-lock.json"), JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "": { name: "fixture" },
      "node_modules/demo-package": { version: "2.0.0", license: "MIT" },
    },
  }));
  await writeFile(path.join(workspace, "src-tauri", "Cargo.toml"), "[package]\nname = \"fixture\"\n");

  const metadata = {
    packages: [
      { id: workspaceId, name: "zmanager-desktop", version: "1.0.0", manifest_path: path.join(workspace, "src-tauri", "Cargo.toml"), source: null },
      { id: registryId, name: "demo-crate", version: "1.0.0", manifest_path: path.join(registryRoot, "Cargo.toml"), source: "registry+https://github.com/rust-lang/crates.io-index", license: "MIT" },
      { id: pathPackageId, name: "licensed-path", version: "1.0.0", manifest_path: path.join(pathPackageRoot, "Cargo.toml"), source: null, license_file: "license.txt" },
    ],
    workspace_members: [workspaceId],
    resolve: { nodes: [{ id: workspaceId }, { id: registryId }, { id: pathPackageId }] },
  };
  await writeFile(metadataPath, JSON.stringify(metadata));
  const cargo = path.join(bin, "cargo");
  await writeFile(cargo, `#!/bin/sh\ncat ${JSON.stringify(metadataPath)}\n`);
  await chmod(cargo, 0o755);

  const output = path.join(workspace, "THIRD_PARTY_NOTICES.md");
  const licenses = path.join(workspace, "third-party-licenses");
  const result = spawnSync("python3", [generator, "--workspace", workspace, "--out-notices", output, "--license-dir", licenses, "--check-npm"], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
  });

  assert.equal(result.status, 0, result.stderr);
  const notice = await readFile(output, "utf8");
  assert.match(notice, /demo-crate/);
  assert.match(notice, /licensed-path/);
  assert.match(notice, /demo-package/);
  await access(path.join(licenses, "rust", "demo-crate-1.0.0", "LICENSE"));
  await access(path.join(licenses, "rust", "licensed-path-1.0.0", "COPYRIGHT"));
  await access(path.join(licenses, "npm", "demo-package-2.0.0", "LICENSE"));
});

test("release workflow requires and publishes the generated license bundle", async () => {
  const workflow = await readFile(path.join(root, ".github", "workflows", "release.yml"), "utf8");
  assert.match(workflow, /Generate release third-party license bundle/);
  assert.match(workflow, /zmanager-desktop-\$version-third-party-licenses\.zip/);
  assert.match(workflow, /zmanager-desktop-\$\{release_version\}-third-party-licenses\.zip/);
  assert.match(workflow, /Required third-party license bundle is missing/);
});

test("license gate covers every shipped target and does not globally allow CDLA", async () => {
  const deny = await readFile(path.join(root, "deny.toml"), "utf8");
  const workflow = await readFile(path.join(root, ".github", "workflows", "license-audit.yml"), "utf8");
  const expectedTargets = [
    "aarch64-apple-darwin",
    "x86_64-apple-darwin",
    "aarch64-pc-windows-msvc",
    "x86_64-pc-windows-msvc",
    "aarch64-unknown-linux-gnu",
    "x86_64-unknown-linux-gnu",
  ];
  const graph = deny.match(/\[graph\][\s\S]*?(?=\n\[[^\[]|$)/)?.[0] ?? "";

  assert.match(graph, /all-features\s*=\s*true/);
  for (const target of expectedTargets) {
    assert.match(graph, new RegExp(`"${target}"`), `missing license target ${target}`);
  }
  assert.match(deny, /unused-allowed-license\s*=\s*"deny"/);
  assert.doesNotMatch(deny, /^\s+"CDLA-Permissive-2\.0",\s*$/m);
  assert.match(workflow, /cargo deny --all-features check licenses/);
});
