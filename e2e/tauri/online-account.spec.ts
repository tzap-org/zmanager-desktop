import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

import type {
  AccountCurrentUserDto,
  AccountLifecycleResultDto,
  AccountSnapshotDto,
  VerifyTzapCertificateResponse,
} from "../../src/api/types";
import { captureHostedCallback } from "./helpers/hostedCallback.ts";
import { countWindowsInstalledApplicationProcesses, observeWindowsDefaultBrowserNavigation, openRegisteredProtocol, runWindowsAccountUiAction } from "./helpers/registeredProtocol.ts";
import { runJobInTaskWindow } from "./helpers/archiveCommands.ts";
import { assertHashManifestEqual, assertNoSecrets, hashTree, writeArchiveEvidence } from "./helpers/tzapArtifacts.ts";

const sourceRoot = path.resolve("e2e", "fixtures", "online", "source");
const runArtifactDir = path.resolve(process.env.TZAP_E2E_ARTIFACT_DIR ?? path.join(".tmp", "zmanager-online-e2e"));
const username = process.env.TZAP_E2E_USERNAME;
const password = process.env.TZAP_E2E_PASSWORD;
const boundaryResults: Record<string, { status: "passed" | "failed"; detail?: string }> = {};

function recordBoundary(name: string, status: "passed" | "failed", detail?: string): void {
  boundaryResults[name] = detail ? { status, detail } : { status };
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return browser.tauri.execute(
    async ({ core }, payload: { command: string; args?: Record<string, unknown> }) => payload.args ? core.invoke(payload.command, payload.args) : core.invoke(payload.command),
    { command, args },
  ) as Promise<T>;
}

async function clickHostedSignInFromUi(): Promise<void> {
  await $("button[aria-label='TZAP Account']").click();
  const dialog = await $("[role='dialog'][aria-labelledby='account-title']");
  await dialog.waitForDisplayed();
  const signIn = await dialog.$("button*=Sign in to");
  await signIn.waitForDisplayed();
  await signIn.click();
  await browser.waitUntil(async () => {
    const notice = await dialog.$("[role='status']");
    return (await notice.isExisting()) && (await notice.getText()).includes("Hosted sign-in is pending.");
  }, {
    timeout: 15_000,
    timeoutMsg: "The real Account UI sign-in action did not complete the opener handoff.",
  });
}

async function clickHostedSignInAndObserveBrowser(): Promise<string> {
  const observation = observeWindowsDefaultBrowserNavigation("https://staging.tzap.org");
  await clickHostedSignInFromUi();
  const observed = await observation;
  assert.equal(observed.origin, "https://staging.tzap.org");
  assert.ok(["/auth/launch", "/auth/login"].includes(observed.path), `unexpected staging auth path: ${observed.path}`);
  assert(observed.launchUrl, "the default-browser observer must return the observed launch URL in memory");
  assert(observed.observedAtUnixMs > 0, "the default-browser observer must report an observation timestamp");
  return observed.launchUrl;
}

async function openDeepLink(url: string): Promise<void> {
  if (process.env.TZAP_E2E_STAGING_CALLBACK_ADAPTER !== "1") {
    throw new Error("Staging callback delivery requires TZAP_E2E_STAGING_CALLBACK_ADAPTER=1.");
  }
  await openRegisteredProtocol(url);
}

async function completeBrowserAuth(launchUrl: string, dispatchCallback = true): Promise<string> {
  assert(username && password, "staging browser credentials must be configured");
  const browserSession = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browserSession.newPage();
    let productionRequest: string | null = null;
    const productionHosts = new Set(["login.tzap.org", "sign.tzap.org", "account.tzap.org"]);
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (productionHosts.has(url.hostname)) {
        productionRequest = url.origin;
        await route.abort();
        return;
      }
      await route.continue();
    });
    await page.goto(launchUrl, { waitUntil: "domcontentloaded" });
    assert.equal(productionRequest, null, `staging browser attempted production TZAP traffic: ${productionRequest}`);
    const usernameInput = page.locator("input[name=username], input[name=email], input[type=email]").first();
    const passwordInput = page.locator("input[name=password], input[type=password]").first();
    await usernameInput.waitFor({ state: "visible", timeout: 15_000 });
    await passwordInput.waitFor({ state: "visible", timeout: 15_000 });
    await usernameInput.fill(username);
    await passwordInput.fill(password);
    const callbackPromise = captureHostedCallback(page);
    await Promise.all([
      page.waitForLoadState("domcontentloaded").catch(() => undefined),
      page.locator("button[type=submit]").click(),
    ]);

    const callback = await callbackPromise;
    if (dispatchCallback) await openDeepLink(callback);
    return callback;
  } finally {
    await browserSession.close();
  }
}

async function waitForSignedIn(): Promise<AccountSnapshotDto> {
  await browser.waitUntil(async () => (await invoke<AccountSnapshotDto>("account_snapshot")).authStatus === "signedIn", {
    timeout: 60_000,
    interval: 500,
    timeoutMsg: "native account did not consume the hosted callback",
  });
  return invoke<AccountSnapshotDto>("account_snapshot");
}

async function startCreate(request: Record<string, unknown>): Promise<void> {
  const terminal = await runJobInTaskWindow("start_create", request, 120_000);
  assert.equal(terminal.status, "completed", JSON.stringify(terminal.latestFailure));
}

async function startExtract(request: Record<string, unknown>): Promise<void> {
  const terminal = await runJobInTaskWindow("start_extract", request, 120_000);
  assert.equal(terminal.status, "completed", JSON.stringify(terminal.latestFailure));
}

async function clearTestIdentityMaterial(): Promise<boolean> {
  try {
    const snapshot = await invoke<AccountSnapshotDto>("account_snapshot");
    let cleanupComplete = true;
    if (snapshot.authStatus === "signedIn") {
      try {
        const retirement = await invoke<AccountLifecycleResultDto>("account_retire_device");
        cleanupComplete = retirement.outcome === "complete" && cleanupComplete;
      } catch {
        cleanupComplete = false;
      }
    }
    for (const identity of snapshot.certificates) {
      try {
        await invoke("account_remove_signing_identity", { request: { id: identity.identityId } });
      } catch {
        cleanupComplete = false;
      }
    }
    for (const key of snapshot.recipientKeys) {
      try {
        await invoke("account_remove_recipient_key", { request: { id: key.keyId } });
      } catch {
        cleanupComplete = false;
      }
    }
    try {
      await invoke("account_forget");
    } catch {
      cleanupComplete = false;
    }
    try {
      const finalSnapshot = await invoke<AccountSnapshotDto>("account_snapshot");
      cleanupComplete = cleanupComplete
        && finalSnapshot.authStatus !== "signedIn"
        && finalSnapshot.pendingState === null
        && finalSnapshot.certificates.length === 0
        && finalSnapshot.recipientKeys.length === 0;
    } catch {
      cleanupComplete = false;
    }
    return cleanupComplete;
  } catch {
    // If the WDIO connection is unavailable, finish cleanup through the same
    // external Account UI used by the installed-artifact lane so the staging
    // device is still retired.
    if (process.platform !== "win32" || !process.env.ZMANAGER_GUI_APP_PATH) return false;
    try {
      await runWindowsAccountUiAction("OpenAccount");
      await runWindowsAccountUiAction("OpenDevice");
      await runWindowsAccountUiAction("Retire");
      await runWindowsAccountUiAction("ConfirmRetire");
      await runWindowsAccountUiAction("OpenCertificates");
      await runWindowsAccountUiAction("EnsureSignedOut");
      await runWindowsAccountUiAction("DeleteIdentity");
      await runWindowsAccountUiAction("ConfirmDelete");
      await runWindowsAccountUiAction("AssertSignedOut");
      return true;
    } catch {
      return false;
    }
  }
}

function cleanupRunArtifacts(): void {
  if (process.env.TZAP_E2E_KEEP_ARTIFACTS === "1" || process.env.TZAP_E2E_FAILURES === "1") return;
  if (process.env.TZAP_E2E_ARTIFACT_DIR_MANAGED === "1") {
    rmSync(runArtifactDir, { recursive: true, force: true });
    return;
  }
  for (const name of ["desktop-state", "failures", "staging-mobile-parity.tzap", "staging-mobile-parity-extracted"]) {
    rmSync(path.join(runArtifactDir, name), { recursive: true, force: true });
  }
}

describe("Online TZAP account lifecycle", () => {
  beforeAll(() => {
    mkdirSync(runArtifactDir, { recursive: true });
    recordBoundary("environmentSelection", process.env.TZAP_E2E_ENV === "staging" ? "passed" : "failed", process.env.TZAP_E2E_ENV);
  });

  afterAll(async () => {
    try {
      recordBoundary("cleanup", (await clearTestIdentityMaterial()) ? "passed" : "failed");
    } finally {
      if (process.env.TZAP_E2E_FAILURES === "1") {
        for (const boundary of ["oauthLaunch", "tauriOpener", "login", "protocolRegistration", "warmCallback", "sessionExchange", "enrollment", "coldCallback", "persistence", "callbackSecurity"]) {
          if (!boundaryResults[boundary]) recordBoundary(boundary, "failed", "boundary was not reached");
        }
      }
      writeFileSync(path.join(runArtifactDir, "standalone-boundaries.json"), `${JSON.stringify({
        runId: process.env.TZAP_E2E_RUN_ID ?? "unknown",
        artifact: process.env.ZMANAGER_GUI_APP_PATH ? path.basename(process.env.ZMANAGER_GUI_APP_PATH) : null,
        boundaries: boundaryResults,
      }, null, 2)}\n`);
      cleanupRunArtifacts();
    }
  });

  it("completes the real staging browser handoff and current-user session", async () => {
    await invoke("account_forget");
    const launchUrl = new URL(await clickHostedSignInAndObserveBrowser());
    recordBoundary("oauthLaunch", "passed", `${launchUrl.origin}${launchUrl.pathname}`);
    recordBoundary("tauriOpener", "passed");
    assert.equal(launchUrl.origin, "https://staging.tzap.org");
    assert.ok(["/auth/launch", "/auth/login"].includes(launchUrl.pathname), `unexpected staging auth path: ${launchUrl.pathname}`);
    assert.equal(launchUrl.searchParams.get("redirect_uri"), "tzap://auth/callback");

    const callback = await completeBrowserAuth(launchUrl.toString());
    recordBoundary("login", "passed");
    const callbackUrl = new URL(callback);
    assert.equal(callbackUrl.protocol, "tzap:");
    assert.equal(callbackUrl.pathname, "/callback");
    const snapshot = await waitForSignedIn();
    recordBoundary("protocolRegistration", "passed");
    recordBoundary("warmCallback", "passed");
    recordBoundary("sessionExchange", "passed");
    assert.equal(await countWindowsInstalledApplicationProcesses(process.env.ZMANAGER_GUI_APP_PATH!), 1, "warm callback must be forwarded to one installed application instance");
    assert.equal(snapshot.capabilities.auth, "handoff_exchange");
    const currentUser = await invoke<AccountCurrentUserDto>("account_fetch_current_user");
    assertNoSecrets({ launch: launchUrl.origin, callback: callbackUrl.origin, snapshot, currentUser }, [username, password]);

    await assert.rejects(
      () => invoke("account_complete_hosted_auth", {
        request: { state: callbackUrl.searchParams.get("state"), handoffCode: callbackUrl.searchParams.get("handoff_code"), callbackUrl: "tzap://auth/callback" },
      }),
      "a replayed hosted handoff must be rejected",
    );
    const invalidCallbackState = callbackUrl.searchParams.get("state") ?? "";
    await openRegisteredProtocol(`tzap://wrong/callback?state=${encodeURIComponent(invalidCallbackState)}&result=completed&handoff_code=invalid-handoff-code-123456&unexpected=1`);
    await openRegisteredProtocol(`tzap://auth/callback?state=${encodeURIComponent(invalidCallbackState)}&result=completed&handoff_code=invalid-handoff-code-123456&code=forbidden`);
    await new Promise((resolve) => setTimeout(resolve, 750));
    assert.equal((await invoke<AccountSnapshotDto>("account_snapshot")).authStatus, "signedIn", "secret-bearing callbacks must be ignored without changing session state");
    recordBoundary("callbackSecurity", "passed");
  });

  it("enrolls, signs, and verifies the staging flow", async () => {
    const result = await invoke<AccountLifecycleResultDto>("account_enroll_certificate");
    assert.equal(result.outcome, "complete");
    const hosted = result.snapshot.certificates.find((certificate) => certificate.identityType === "hosted" && certificate.state === "active");
    assert(hosted, "staging enrollment must produce an active hosted certificate");
    assert.equal(hosted.assuranceLevel, "oauth_verified_email");
    assert.equal(result.snapshot.defaultSigningIdentityId, hosted.identityId);
    recordBoundary("enrollment", "passed");

    const archivePath = path.join(runArtifactDir, "staging-mobile-parity.tzap");
    const sourceManifest = hashTree(sourceRoot);
    await startCreate({
      sources: [sourceRoot], destinationPath: archivePath, format: "tzap", cleanSource: false,
      replaceExisting: true, preserveMetadata: true,
      tzapCertificates: { signingSelection: { mode: "enrolledIdentity", signingIdentityId: hosted.identityId }, recipientSelection: { recipientKeyIds: [], contactRecipientIds: [], oneTimeCertificatePaths: [] } },
    });

    const offline = await invoke<VerifyTzapCertificateResponse>("verify_tzap_certificate", { request: { archivePath, validateTrust: true, trustedCaCertificatePaths: [], trustedSystemRoots: false, includeOfficialTzapRoot: true, checkCurrentStatus: false, environment: "staging" } });
    assert.equal(offline.signatureCheck, "ok", JSON.stringify(offline));
    assert.equal(offline.certificateTime, "valid_at_signing", JSON.stringify(offline));
    const extractedRoot = path.join(runArtifactDir, "staging-mobile-parity-extracted");
    await startExtract({ archivePath, destinationPath: extractedRoot, password: null, recipientKeyId: null, overwrite: "replace", destinationCollisionStrategy: "refuse", entryPaths: null, stripComponents: 0, tzapRestorePolicy: "content", tzapAllowDegraded: false, tzapAllowAbsoluteSymlinks: false, ignoreSymlinks: false });
    assertHashManifestEqual(sourceManifest, path.join(extractedRoot, path.basename(sourceRoot)));

    const online = await invoke<VerifyTzapCertificateResponse>("verify_tzap_certificate", { request: { archivePath, validateTrust: true, trustedCaCertificatePaths: [], trustedSystemRoots: false, includeOfficialTzapRoot: true, checkCurrentStatus: true, environment: "staging" } });
    assert.equal(online.signatureCheck, "ok", JSON.stringify(online));
    assert.equal(online.statusCheck, "fresh_valid", JSON.stringify(online));
    assert.equal(online.verificationState, "verified_with_caveat", JSON.stringify(online));
    writeArchiveEvidence({ artifactDir: runArtifactDir, archivePath, sourceManifest, signerCertificateSha256: hosted.certificateSha256, runId: process.env.TZAP_E2E_RUN_ID ?? "unknown" });
  });

});
