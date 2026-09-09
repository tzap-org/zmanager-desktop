import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

import type {
  AccountCurrentUserDto,
  AccountLifecycleResultDto,
  AccountSnapshotDto,
  VerifyTzapCertificateResponse,
} from "../../src/api/types";
import { openRegisteredProtocol } from "./helpers/registeredProtocol.ts";
import { runJobInTaskWindow } from "./helpers/archiveCommands.ts";
import { assertHashManifestEqual, assertNoSecrets, hashTree, writeArchiveEvidence } from "./helpers/tzapArtifacts.ts";

const sourceRoot = path.resolve("e2e", "fixtures", "online", "source");
const runArtifactDir = path.resolve(process.env.TZAP_E2E_ARTIFACT_DIR ?? path.join(".tmp", "zmanager-online-e2e"));
const username = process.env.TZAP_E2E_USERNAME;
const password = process.env.TZAP_E2E_PASSWORD;

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
  const signIn = await dialog.$("button*=Sign in to enroll");
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

async function openDeepLink(url: string): Promise<void> {
  if (process.env.TZAP_E2E_STAGING_CALLBACK_ADAPTER !== "1") {
    throw new Error("Staging callback delivery requires TZAP_E2E_STAGING_CALLBACK_ADAPTER=1.");
  }
  await openRegisteredProtocol(url);
}

async function completeBrowserAuth(launchUrl: string): Promise<string> {
  assert(username && password, "staging browser credentials must be configured");
  const browserSession = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browserSession.newPage();
    let attemptedCallback: string | null = null;
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
    page.on("request", (request) => {
      try {
        const url = new URL(request.url());
        if (url.protocol === "tzap:" && url.pathname === "/auth/callback") attemptedCallback = request.url();
      } catch {
        // Ignore ordinary HTTP requests.
      }
    });
    await page.goto(launchUrl, { waitUntil: "domcontentloaded" });
    assert.equal(productionRequest, null, `staging browser attempted production TZAP traffic: ${productionRequest}`);
    const usernameInput = page.locator("input[name=username], input[name=email], input[type=email]").first();
    const passwordInput = page.locator("input[name=password], input[type=password]").first();
    await usernameInput.waitFor({ state: "visible", timeout: 15_000 });
    await passwordInput.waitFor({ state: "visible", timeout: 15_000 });
    await usernameInput.fill(username);
    await passwordInput.fill(password);
    await Promise.all([
      page.waitForLoadState("domcontentloaded").catch(() => undefined),
      page.locator("button[type=submit]").click(),
    ]);

    let callback: string | null = attemptedCallback;
    if (!callback) {
      const callbackLink = page.locator("[data-callback-url], a[href^='tzap://'], a[href^='zmanager://']").first();
      await callbackLink.waitFor({ state: "attached", timeout: 15_000 });
      callback = await callbackLink.getAttribute("data-callback-url") ?? await callbackLink.getAttribute("href");
    }
    assert(callback, "hosted login must return a tzap:// callback URL");
    await openDeepLink(callback);
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

async function clearTestIdentityMaterial(): Promise<void> {
  try {
    const snapshot = await invoke<AccountSnapshotDto>("account_snapshot");
    for (const identity of snapshot.certificates) {
      await invoke("account_remove_signing_identity", { request: { id: identity.identityId } }).catch(() => undefined);
    }
    for (const key of snapshot.recipientKeys) {
      await invoke("account_remove_recipient_key", { request: { id: key.keyId } }).catch(() => undefined);
    }
    await invoke("account_forget").catch(() => undefined);
  } catch {
    // The app may already be gone after a native-driver failure.
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
  });

  afterAll(async () => {
    try {
      await clearTestIdentityMaterial();
    } finally {
      cleanupRunArtifacts();
    }
  });

  it("completes the real staging browser handoff and current-user session", async () => {
    await invoke("account_forget");
    await clickHostedSignInFromUi();

    // The UI opener probe above is the boundary under test. A second launch is
    // obtained for the controlled login browser so the test can complete auth
    // without relying on the user's interactive browser profile.
    const launch = await invoke<{ launchUrl: string; state: string; expiresAtUnixSeconds: number }>("account_begin_hosted_auth", {
      request: { environment: "staging", audience: process.env.TZAP_E2E_AUDIENCE ?? "sign.tzap.org" },
    });
    const launchUrl = new URL(launch.launchUrl);
    assert.equal(launchUrl.origin, "https://staging.tzap.org");
    assert.equal(launchUrl.pathname, "/auth/launch");
    assert.equal(launchUrl.searchParams.get("redirect_uri"), "tzap://auth/callback");

    const callback = await completeBrowserAuth(launch.launchUrl);
    const callbackUrl = new URL(callback);
    assert.equal(callbackUrl.protocol, "tzap:");
    assert.equal(callbackUrl.pathname, "/auth/callback");
    const snapshot = await waitForSignedIn();
    assert.equal(snapshot.capabilities.auth, "handoff_exchange");
    const currentUser = await invoke<AccountCurrentUserDto>("account_fetch_current_user");
    assertNoSecrets({ launch: launchUrl.origin, callback: callbackUrl.origin, snapshot, currentUser }, [username, password]);

    await assert.rejects(
      () => invoke("account_complete_hosted_auth", {
        request: { state: callbackUrl.searchParams.get("state"), handoffCode: callbackUrl.searchParams.get("handoff_code"), callbackUrl: "tzap://auth/callback" },
      }),
      "a replayed hosted handoff must be rejected",
    );
  });

  it("enrolls, signs, and verifies the staging flow", async () => {
    const result = await invoke<AccountLifecycleResultDto>("account_enroll_certificate");
    assert.equal(result.outcome, "complete");
    const hosted = result.snapshot.certificates.find((certificate) => certificate.identityType === "hosted" && certificate.state === "active");
    assert(hosted, "staging enrollment must produce an active hosted certificate");
    assert.equal(hosted.assuranceLevel, "oauth_verified_email");
    assert.equal(result.snapshot.defaultSigningIdentityId, hosted.identityId);

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
