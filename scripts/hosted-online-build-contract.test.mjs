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
  assert.ok(capability.permissions.includes("opener:allow-open-url"), "the app must authorize the opener open_url command");
  assert.ok(capability.permissions.includes("opener:allow-default-urls"), "the app must allow the system browser URL scope");
});

test("Windows build entry points keep local E2E on staging and production explicit", () => {
  const batch = readFileSync(resolve(repositoryRoot, "scripts/build.bat"), "utf8");
  const staticBuild = readFileSync(resolve(repositoryRoot, "scripts/build-windows-static.ps1"), "utf8");
  const prepare = readFileSync(resolve(repositoryRoot, "scripts/prepare-windows-static-build.ps1"), "utf8");
  const packageWorkflow = readFileSync(resolve(repositoryRoot, ".github/workflows/package.yml"), "utf8");
  const releaseWorkflow = readFileSync(resolve(repositoryRoot, ".github/workflows/release.yml"), "utf8");
  const standaloneRunner = readFileSync(resolve(repositoryRoot, "scripts/test-windows-standalone-staging.ps1"), "utf8");
  const standaloneDebugConfig = JSON.parse(readFileSync(resolve(repositoryRoot, "src-tauri/tauri.standalone-debug.conf.json"), "utf8"));
  const browserObserver = readFileSync(resolve(repositoryRoot, "scripts/observe-windows-default-browser.ps1"), "utf8");
  const protocolProbe = readFileSync(resolve(repositoryRoot, "scripts/test-windows-protocol-registration.ps1"), "utf8");
  const onlineSpec = readFileSync(resolve(repositoryRoot, "e2e/tauri/online-account.spec.ts"), "utf8");
  const wdioConfig = readFileSync(resolve(repositoryRoot, "wdio.conf.ts"), "utf8");
  const releaseDriver = readFileSync(resolve(repositoryRoot, "e2e/tauri/release-artifact-smoke.ts"), "utf8");
  const accountSource = readFileSync(resolve(repositoryRoot, "src-tauri/src/account.rs"), "utf8");
  const uiaDriver = readFileSync(resolve(repositoryRoot, "scripts/windows-uia-account-action.ps1"), "utf8");

  assert.match(batch, /if not defined BUILD_ENV set "BUILD_ENV=staging"/u);
  assert.match(batch, /-Environment "%BUILD_ENV%"/u);
  assert.match(staticBuild, /ValidateSet\("staging", "prod"\)[\s\S]*?Environment = "staging"/u);
  assert.match(staticBuild, /VITE_TZAP_BUILD_ENV = \$Environment/u);
  assert.match(staticBuild, /ZMANAGER_TZAP_SERVER_BASE_URL = "https:\/\/staging\.tzap\.org"/u);
  assert.match(prepare, /ZMANAGER_TZAP_SERVER_BASE_URL = "https:\/\/staging\.tzap\.org"/u);
  assert.match(prepare, /ValidateSet\("staging", "prod"\)[\s\S]*?Environment = "staging"/u);
  assert.match(prepare, /-Environment \$Environment/u);
  assert.match(packageWorkflow, /Run staging Windows standalone E2E[\s\S]*?test-windows-standalone-staging\.ps1/u);
  assert.match(packageWorkflow, /Prepare Windows build environment[\s\S]*?-Environment staging/u);
  assert.match(packageWorkflow, /Prepare and build Windows package[\s\S]*?-Environment prod/u);
  assert.match(packageWorkflow, /staging Windows release-artifact smoke[\s\S]*?test-windows-standalone-staging\.ps1[\s\S]*?-ReleaseArtifact/u);
  assert.match(releaseWorkflow, /Smoke-test staging release artifact on Windows[\s\S]*?test-windows-standalone-staging\.ps1[\s\S]*?-ReleaseArtifact/u);
  assert.match(standaloneRunner, /tauri\.conf\.json/u);
  assert.match(standaloneRunner, /(?:--bundles nsis|"--bundles"[\s\S]*?"nsis")/u);
  assert.match(standaloneRunner, /ReleaseArtifact/u);
  assert.match(standaloneRunner, /tsx e2e\/tauri\/release-artifact-smoke\.ts/u);
  assert.match(standaloneRunner, /test:gui:run -- --spec e2e\/tauri\/online-account\.spec\.ts/u);
  assert.match(standaloneRunner, /tauri\.standalone-debug\.conf\.json/u);
  assert.equal(standaloneDebugConfig.app.withGlobalTauri, true);
  assert.equal(standaloneDebugConfig.build.beforeBuildCommand, "npm run build -- --mode gui");
  assert.match(standaloneRunner, /test-windows-protocol-registration\.ps1/u);
  assert.match(standaloneRunner, /uninstall\.exe/u);
  assert.match(standaloneRunner, /zmanager-diagnostics\.log/u);
  assert.match(standaloneRunner, /artifact-metadata\.json/u);
  assert.doesNotMatch(standaloneRunner, /test-windows-protocol-registration\.ps1[\s\S]{0,200}\$LASTEXITCODE/u);
  assert.doesNotMatch(standaloneRunner, /tauri\.gui\.conf\.json/u);
  assert.match(browserObserver, /UIAutomationClient/u);
  assert.match(browserObserver, /ExpectedOrigin/u);
  assert.match(browserObserver, /baselineUrls/u);
  assert.match(browserObserver, /ObservedAtUnixMs/u);
  assert.match(browserObserver, /production_host_observed/u);
  assert.match(protocolProbe, /tzap\\shell\\open\\command/u);
  assert.match(onlineSpec, /countWindowsInstalledApplicationProcesses/u);
  assert.match(onlineSpec, /openRegisteredProtocol\(url\)/u);
  assert.match(onlineSpec, /callbackUrl\.pathname, "\/callback"/u);
  assert.doesNotMatch(onlineSpec, /spawn\(/u);
  assert.match(standaloneRunner, /onlineExitCode[\s\S]*release-artifact-smoke\.ts/u);
  assert.match(releaseDriver, /observeWindowsDefaultBrowserNavigation/u);
  assert.match(releaseDriver, /openRegisteredProtocol/u);
  assert.match(releaseDriver, /countWindowsInstalledApplicationProcesses/u);
  assert.match(releaseDriver, /warm callback must be forwarded to one installed application instance/u);
  assert.match(releaseDriver, /cold callback must leave one installed application instance/u);
  assert.match(releaseDriver, /captureHostedCallback/u);
  assert.match(releaseDriver, /AssertIdentityAbsent/u);
  assert.match(releaseDriver, /AssertRetirementComplete/u);
  assert.match(releaseDriver, /TZAP_E2E_FORCE_SESSION_EXPIRED/u);
  assert.match(releaseDriver, /delete process\.env\.TZAP_E2E_FORCE_SESSION_EXPIRED[\s\S]*stopWindowsInstalledApplication\(appPath\)[\s\S]*startWindowsInstalledApplication\(appPath\)[\s\S]*signInThroughInstalledApplication/u);
  assert.match(releaseDriver, /windows-uia-account-action\.ps1/u);
  assert.doesNotMatch(releaseDriver, /account_complete_hosted_auth/u);
  assert.doesNotMatch(accountSource, /with_reqwest\(intermediate_cache, Some\(config\.hosted_account_base_url/u);
  assert.match(accountSource, /TzapOnlineIntermediateResolver::new\(intermediate_cache, Some\(config\.hosted_account_base_url/u);
  assert.match(uiaDriver, /UIAutomationClient/u);
  assert.match(uiaDriver, /AssertRetirementComplete/u);
  assert.match(uiaDriver, /Retirement completed/u);
  assert.ok(
    releaseDriver.indexOf('assert.equal(observed.origin, "https://staging.tzap.org")') < releaseDriver.indexOf('mark("environmentSelection", "passed"'),
    "environment selection must only pass after the observed launch origin is validated",
  );
  assert.match(wdioConfig, /\[A-Za-z0-9_.~-\]\+=\)\[\^&\\s#\]/u);
});
