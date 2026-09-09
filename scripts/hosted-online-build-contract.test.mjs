import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "..");

test("the product build enables hosted online account sign-in by default", () => {
  const manifest = readFileSync(resolve(repositoryRoot, "src-tauri/Cargo.toml"), "utf8");
  const features = manifest.match(/\[features\]([\s\S]*?)(?:\n\[|$)/)?.[1] ?? "";

  assert.match(features, /default\s*=\s*\[[^\]]*"hosted-online"/, "the default Cargo feature set must enable hosted-online");
});

test("the opener capability includes a scoped default URL permission", () => {
  const capability = JSON.parse(readFileSync(resolve(repositoryRoot, "src-tauri/capabilities/default.json"), "utf8"));
  assert.ok(capability.permissions.includes("opener:allow-default-urls"), "the app must allow the system browser URL scope");
  assert.ok(!capability.permissions.includes("opener:allow-open-url"), "the app must not grant an unscoped opener URL command");
});

test("Windows build entry points keep local E2E on staging and production explicit", () => {
  const batch = readFileSync(resolve(repositoryRoot, "scripts/build.bat"), "utf8");
  const staticBuild = readFileSync(resolve(repositoryRoot, "scripts/build-windows-static.ps1"), "utf8");
  const prepare = readFileSync(resolve(repositoryRoot, "scripts/prepare-windows-static-build.ps1"), "utf8");
  const packageWorkflow = readFileSync(resolve(repositoryRoot, ".github/workflows/package.yml"), "utf8");
  const standaloneRunner = readFileSync(resolve(repositoryRoot, "scripts/test-windows-standalone-staging.ps1"), "utf8");
  const onlineSpec = readFileSync(resolve(repositoryRoot, "e2e/tauri/online-account.spec.ts"), "utf8");

  assert.match(batch, /if not defined BUILD_ENV set "BUILD_ENV=staging"/u);
  assert.match(batch, /-Environment "%BUILD_ENV%"/u);
  assert.match(staticBuild, /ValidateSet\("staging", "prod"\)[\s\S]*?Environment = "staging"/u);
  assert.match(staticBuild, /VITE_TZAP_BUILD_ENV = \$Environment/u);
  assert.match(prepare, /ValidateSet\("staging", "prod"\)[\s\S]*?Environment = "staging"/u);
  assert.match(prepare, /-Environment \$Environment/u);
  assert.match(packageWorkflow, /Run staging Windows standalone E2E[\s\S]*?test-windows-standalone-staging\.ps1/u);
  assert.match(packageWorkflow, /Prepare Windows build environment[\s\S]*?-Environment staging/u);
  assert.match(packageWorkflow, /Prepare and build Windows package[\s\S]*?-Environment prod/u);
  assert.match(standaloneRunner, /tauri\.conf\.json/u);
  assert.match(standaloneRunner, /--bundles nsis/u);
  assert.doesNotMatch(standaloneRunner, /tauri\.gui\.conf\.json/u);
  assert.match(onlineSpec, /openRegisteredProtocol\(url\)/u);
  assert.doesNotMatch(onlineSpec, /spawn\(/u);
});
