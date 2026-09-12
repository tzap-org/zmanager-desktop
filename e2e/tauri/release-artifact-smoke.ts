import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { chromium } from "@playwright/test";

import { captureHostedCallback } from "./helpers/hostedCallback.ts";
import { countWindowsInstalledApplicationProcesses, observeWindowsDefaultBrowserNavigation, openRegisteredProtocol, startWindowsInstalledApplication, stopWindowsInstalledApplication } from "./helpers/registeredProtocol.ts";

const appPath = process.env.ZMANAGER_GUI_APP_PATH;
const username = process.env.TZAP_E2E_USERNAME;
const password = process.env.TZAP_E2E_PASSWORD;
const artifactDir = path.resolve(process.env.TZAP_E2E_ARTIFACT_DIR ?? path.join(".tmp", "zmanager-release-artifact-smoke"));
const logPath = appPath ? path.join(path.dirname(appPath), "logs", "zmanager-diagnostics.log") : "";
const boundaries: Record<string, { status: "passed" | "failed"; detail?: string }> = {};

function mark(name: string, status: "passed" | "failed", detail?: string): void {
  boundaries[name] = detail ? { status, detail } : { status };
}

function runUiAction(action: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.resolve("scripts", "windows-uia-account-action.ps1"), "-Action", action,
    ], { stdio: ["ignore", "ignore", "ignore"], windowsHide: true });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`Windows UI Automation action failed: ${action}`)));
  });
}


function captureFailureScreen(): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.resolve("scripts", "capture-windows-installed-ui.ps1"),
      "-OutputPath", path.join(artifactDir, "failure-screen.png"),
    ], { stdio: "ignore", windowsHide: true });
    child.once("close", () => resolve());
    child.once("error", () => resolve());
  });
}

async function completeBrowserAuth(launchUrl: string): Promise<string> {
  assert(username && password, "staging browser credentials must be configured");
  const browserSession = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browserSession.newPage();
    let productionOrigin: string | null = null;
    const productionHosts = new Set(["login.tzap.org", "sign.tzap.org", "account.tzap.org"]);
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (productionHosts.has(url.hostname)) {
        productionOrigin = url.origin;
        await route.abort();
        return;
      }
      await route.continue();
    });
    await page.goto(launchUrl, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    assert.equal(productionOrigin, null, `staging browser attempted production TZAP traffic: ${productionOrigin}`);
    assert.equal(new URL(page.url()).origin, "https://staging.tzap.org");
    const usernameInput = page.locator("input[type=email], input[name=username], input[name=email], input[type=text]").first();
    const passwordInput = page.locator("input[name=password], input[type=password]").first();
    try {
      await usernameInput.waitFor({ state: "visible", timeout: 30_000 });
      await passwordInput.waitFor({ state: "visible", timeout: 30_000 });
    } catch {
      throw new Error(`staging login form was not visible (path=${new URL(page.url()).pathname}, inputs=${await page.locator("input").count()}, buttons=${await page.locator("button").count()})`);
    }
    await usernameInput.fill(username);
    await passwordInput.fill(password);
    const callbackPromise = captureHostedCallback(page);
    await Promise.all([
      page.waitForLoadState("domcontentloaded").catch(() => undefined),
      page.locator("button[type=submit]").click(),
    ]);
    return await callbackPromise;
  } finally {
    await browserSession.close();
  }
}

async function signInThroughInstalledApplication(options: { allowAlreadyCompleted?: boolean } = {}): Promise<void> {
  const completionOffset = options.allowAlreadyCompleted && existsSync(logPath) ? statSync(logPath).size : 0;
  const browserObservation = observeWindowsDefaultBrowserNavigation("https://staging.tzap.org");
  await runUiAction("SignIn");
  const browserFlow = browserObservation.then(async (observed) => {
    assert.ok(["/auth/launch", "/auth/login"].includes(observed.path), `unexpected staging auth path: ${observed.path}`);
    const callback = await completeBrowserAuth(observed.launchUrl);
    await openRegisteredProtocol(callback);
    await waitForLog(completionOffset, ["\"name\":\"hostedAuthCompleted\""]);
  });
  if (!options.allowAlreadyCompleted) {
    await browserFlow;
    return;
  }

  // A re-authentication after forced expiry can reuse an already authenticated
  // Edge session and complete before UI Automation observes a distinct address
  // bar value. The app's new hostedAuthCompleted event is the authoritative
  // success signal for this cleanup-only re-authentication.
  await Promise.race([
    browserFlow,
    waitForLog(completionOffset, ["\"name\":\"hostedAuthCompleted\""])
  ]);
}

async function waitForLog(offset: number, predicates: string[], timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(logPath)) {
      const contents = readFileSync(logPath, "utf8").slice(offset);
      if (predicates.every((predicate) => contents.includes(predicate))) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("release artifact did not emit the expected sanitized diagnostic events");
}

async function main(): Promise<void> {
  assert(process.platform === "win32", "release artifact smoke is Windows-only");
  assert(appPath, "installed release executable path is required");
  assert(username && password, "staging browser credentials are required");
  mkdirSync(artifactDir, { recursive: true });
  let completed = false;
  try {
    await startWindowsInstalledApplication(appPath);
    await runUiAction("OpenAccount");
    const browserObservation = observeWindowsDefaultBrowserNavigation("https://staging.tzap.org");
    await runUiAction("SignIn");
    const observed = await browserObservation;
    assert.equal(observed.origin, "https://staging.tzap.org");
    assert.ok(["/auth/launch", "/auth/login"].includes(observed.path), `unexpected staging auth path: ${observed.path}`);
    mark("environmentSelection", "passed", `${observed.origin}${observed.path}`);
    mark("oauthLaunch", "passed", `${observed.origin}${observed.path}@${observed.observedAtUnixMs}`);
    mark("tauriOpener", "passed");

    const callback = await completeBrowserAuth(observed.launchUrl);
    const callbackUrl = new URL(callback);
    assert.equal(callbackUrl.protocol, "tzap:");
    assert.equal(callbackUrl.host, "auth");
    assert.equal(callbackUrl.pathname, "/callback");
    mark("login", "passed", `${callbackUrl.protocol}//${callbackUrl.host}${callbackUrl.pathname}`);
    const exchangeOffset = existsSync(logPath) ? statSync(logPath).size : 0;
    await openRegisteredProtocol(callback);
    await waitForLog(exchangeOffset, ["\"name\":\"hostedAuthCallbackObserved\"", "\"name\":\"hostedAuthCompleted\""]);
    assert.equal(await countWindowsInstalledApplicationProcesses(appPath), 1, "warm callback must be forwarded to one installed application instance");
    mark("protocolRegistration", "passed");
    mark("warmCallback", "passed");
    mark("sessionExchange", "passed");
    const securityOffset = existsSync(logPath) ? statSync(logPath).size : 0;
    await openRegisteredProtocol(callback);
    await openRegisteredProtocol(`tzap://wrong/callback?state=${encodeURIComponent(callbackUrl.searchParams.get("state") ?? "")}&result=completed&handoff_code=invalid-handoff-code-123456&unexpected=1`);
    await openRegisteredProtocol(`tzap://auth/callback?state=${encodeURIComponent(callbackUrl.searchParams.get("state") ?? "")}&result=completed&handoff_code=invalid-handoff-code-123456&code=forbidden`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const securityLog = existsSync(logPath) ? readFileSync(logPath, "utf8").slice(securityOffset) : "";
    assert(!securityLog.includes("\"name\":\"hostedAuthCompleted\""), "replayed or invalid callbacks must not complete another hosted exchange");
    mark("callbackSecurity", "passed");

    const enrollOffset = existsSync(logPath) ? statSync(logPath).size : 0;
    await runUiAction("Enroll");
    await waitForLog(enrollOffset, ["\"name\":\"hostedCertificateEnrolled\""]);
    mark("enrollment", "passed");

    // Start a second fresh pending flow, then deliver its callback only after
    // the release application has exited. This is the release-artifact cold
    // callback proof; the first flow above is the warm proof.
    await runUiAction("OpenAccount");
    await runUiAction("SignOut");
    await runUiAction("AssertSignedOut");
    const coldObservationPromise = observeWindowsDefaultBrowserNavigation("https://staging.tzap.org");
    await runUiAction("SignIn");
    const coldObserved = await coldObservationPromise;
    assert.ok(["/auth/launch", "/auth/login"].includes(coldObserved.path), `unexpected staging auth path: ${coldObserved.path}`);
    const coldCallback = await completeBrowserAuth(coldObserved.launchUrl);
    const wrongStateCallback = new URL(coldCallback);
    wrongStateCallback.searchParams.set("state", "wrong-state-1234567890");
    await openRegisteredProtocol(wrongStateCallback.toString());
    await runUiAction("AssertSignedOut");

    await stopWindowsInstalledApplication(appPath);
    const coldCallbackOffset = existsSync(logPath) ? statSync(logPath).size : 0;
    await openRegisteredProtocol(coldCallback);
    await waitForLog(coldCallbackOffset, ["\"name\":\"hostedAuthCallbackObserved\"", "\"name\":\"hostedAuthCompleted\""]);
    assert.equal(await countWindowsInstalledApplicationProcesses(appPath), 1, "cold callback must leave one installed application instance");
    mark("coldCallback", "passed");

    await stopWindowsInstalledApplication(appPath);
    const restartOffset = existsSync(logPath) ? statSync(logPath).size : 0;
    await startWindowsInstalledApplication(appPath);
    await waitForLog(restartOffset, ["\"name\":\"accountSessionRestored\""]);
    await runUiAction("OpenAccount");
    await runUiAction("AssertSignedIn");
    await runUiAction("OpenCertificates");
    await runUiAction("AssertIdentityPresent");
    mark("persistence", "passed");

    process.env.TZAP_E2E_FORCE_SESSION_EXPIRED = "1";
    try {
      await stopWindowsInstalledApplication(appPath);
      await startWindowsInstalledApplication(appPath);
      await runUiAction("OpenAccount");
      await runUiAction("AssertSignedOut");
    } finally {
      delete process.env.TZAP_E2E_FORCE_SESSION_EXPIRED;
      await stopWindowsInstalledApplication(appPath).catch(() => undefined);
    }

    // Re-authenticate after the forced-expiry assertion so the installed artifact
    // can prove the device-management ownership boundary before local cleanup.
    const cleanupOffset = existsSync(logPath) ? statSync(logPath).size : 0;
    await startWindowsInstalledApplication(appPath);
    await runUiAction("OpenAccount");
    await signInThroughInstalledApplication({ allowAlreadyCompleted: true });
    await waitForLog(cleanupOffset, ["\"name\":\"hostedAuthCompleted\""]);
    await runUiAction("AssertSignedIn");
    await runUiAction("OpenDevice");
    await runUiAction("AssertDeviceManagementExternal");
    await runUiAction("OpenCertificates");
    await runUiAction("EnsureSignedOut");
    await runUiAction("DeleteIdentity");
    await runUiAction("ConfirmDelete");
    await runUiAction("AssertIdentityAbsent");
    await runUiAction("AssertSignedOut");
    mark("cleanup", "passed", "local account material cleared; device revocation remains hosted-console-owned");
    completed = true;
  } finally {
    if (!completed) await captureFailureScreen();
    await stopWindowsInstalledApplication(appPath).catch(() => undefined);
  }
}

try {
  await main();
} catch (error) {
  const detail = error instanceof Error ? error.message.replace(/([?&][A-Za-z0-9_.~-]+=)[^&\s#]*/gu, "$1<redacted>") : "release artifact smoke failed";
  for (const name of ["environmentSelection", "oauthLaunch", "tauriOpener", "login", "protocolRegistration", "warmCallback", "callbackSecurity", "sessionExchange", "enrollment", "coldCallback", "persistence", "cleanup"]) {
    if (!boundaries[name]) mark(name, "failed", detail);
  }
  process.exitCode = 1;
} finally {
  writeFileSync(path.join(artifactDir, "release-artifact-boundaries.json"), `${JSON.stringify({
    runId: process.env.TZAP_E2E_RUN_ID ?? "unknown",
    artifact: appPath ? path.basename(appPath) : null,
    boundaries,
  }, null, 2)}\n`);
}
