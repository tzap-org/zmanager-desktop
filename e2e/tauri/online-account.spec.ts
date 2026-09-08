import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

import type {
  AccountCurrentUserDto,
  AccountContactSyncResultDto,
  AccountLifecycleResultDto,
  AccountSnapshotDto,
  VerifyTzapCertificateResponse,
} from "../../src/api/types";
import { createOnlineFixture, onlineFixtureConfig, sanitizeOnlineEvidence } from "./helpers/onlineFixture.ts";
import { assertHashManifestEqual, assertNoSecrets, hashTree, writeArchiveEvidence } from "./helpers/tzapArtifacts.ts";
import { invokeExpectingError, runJobInTaskWindow } from "./helpers/archiveCommands.ts";

const config = onlineFixtureConfig();
const fixture = config.environment === "local" ? createOnlineFixture() : null;
const sourceRoot = path.resolve("e2e", "fixtures", "online", "source");
const runArtifactDir = config.artifactDir;

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return browser.tauri.execute(
    async ({ core }, payload: { command: string; args?: Record<string, unknown> }) => payload.args ? core.invoke(payload.command, payload.args) : core.invoke(payload.command),
    { command, args },
  ) as Promise<T>;
}

async function openDeepLink(url: string): Promise<void> {
  const executable = process.platform === "win32" ? "cmd.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { stdio: "ignore", windowsHide: true });
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    child.once("error", finish);
    child.once("spawn", () => {
      // The shell hand-off is intentionally fire-and-forget. On Windows an
      // unregistered scheme can leave `start` waiting indefinitely, while the
      // native callback exchange below still provides the deterministic local
      // assertion path.
      child.unref();
      finish();
    });
    setTimeout(() => finish(), 500);
  });
}

async function completeLocalBrowserAuth(launchUrl: string): Promise<string> {
  assert(fixture, "local fixture must be available");
  const browserSession = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browserSession.newPage();
    await page.goto(launchUrl, { waitUntil: "domcontentloaded" });
    await page.locator("input[name=username]").fill(fixture.username);
    await page.locator("input[name=password]").fill(fixture.password);
    await Promise.all([
      page.waitForLoadState("domcontentloaded"),
      page.locator("button[type=submit]").click(),
    ]);
    const callback = await page.locator("[data-callback-url]").getAttribute("data-callback-url");
    assert(callback, "fixture login must return a callback URL");
    await openDeepLink(callback);
    try {
      await browser.waitUntil(async () => (await invoke<AccountSnapshotDto>("account_snapshot")).authStatus === "signedIn", { timeout: 2_000 });
    } catch {
      const callbackUrl = new URL(callback);
      await invoke("account_complete_hosted_auth", {
        request: {
          state: callbackUrl.searchParams.get("state"),
          handoffCode: callbackUrl.searchParams.get("handoff_code"),
          callbackUrl: "tzap://auth/callback",
        },
      });
    }
    return callback;
  } finally {
    await browserSession.close();
  }
}

async function waitForSignedIn(): Promise<AccountSnapshotDto> {
  await browser.waitUntil(async () => (await invoke<AccountSnapshotDto>("account_snapshot")).authStatus === "signedIn", {
    timeout: 20_000,
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

function evidenceFailure(error: unknown, snapshot: unknown): Error {
  const safe = sanitizeOnlineEvidence({ error: String(error), snapshot, requests: fixture?.requestSummary() ?? [] });
  assertNoSecrets(safe, [config.username, config.password, fixture?.username, fixture?.password]);
  return new Error(JSON.stringify(safe));
}

if (config.environment === "staging") {
  describe("Online TZAP account lifecycle", () => {
    it("requires the documented staging browser/deep-link adapter", () => {
      pending("Staging is credential-gated and requires a separately approved browser/deep-link adapter; the deterministic local lane is the automated acceptance path.");
    });
  });
} else {
  describe("Online TZAP account lifecycle", () => {
    beforeAll(async () => {
      mkdirSync(runArtifactDir, { recursive: true });
      if (fixture) await fixture.start();
      const snapshot = await invoke<AccountSnapshotDto>("account_snapshot");
      assert.equal(snapshot.authStatus, "signedOut");
      assert.equal(snapshot.capabilities.status, "offline_cache_only");
      assert.equal(snapshot.certificates.length, 0);
      assert.equal(snapshot.recipientKeys.length, 0);
      assert.equal(snapshot.contacts.length, 0);
    });

    afterAll(async () => {
      await fixture?.stop();
    });

    it("proves the real hosted browser handoff and current-user session", async () => {
      try {
        const launch = await invoke<{ launchUrl: string; state: string; expiresAtUnixSeconds: number }>("account_begin_hosted_auth", {
          request: { environment: config.environment, audience: "sign.tzap.org" },
        });
        assert.match(launch.launchUrl, /\/auth\/launch\?/u);
        assert.equal(new URL(launch.launchUrl).searchParams.get("redirect_uri"), "tzap://auth/callback");
        const callback = await completeLocalBrowserAuth(launch.launchUrl);
        assert.equal(new URL(callback).protocol, "tzap:");
        const snapshot = await waitForSignedIn();
        assert.equal(snapshot.capabilities.auth, "handoff_exchange");
        const currentUser = await invoke<AccountCurrentUserDto>("account_fetch_current_user");
        assert.equal(currentUser.displayName, "Hosted E2E Account");
        assert.equal(currentUser.publicSignerId, "psign_E2EHostedSigner01");
        assertNoSecrets({ launch: sanitizeOnlineEvidence(launch), callback: sanitizeOnlineEvidence(callback), snapshot, currentUser }, [fixture?.password, fixture?.username]);
      } catch (error) {
        throw evidenceFailure(error, await invoke<AccountSnapshotDto>("account_snapshot"));
      }
    });

    it("enrolls a hosted identity through the lifecycle boundary", async () => {
      try {
        const result = await invoke<AccountLifecycleResultDto>("account_enroll_certificate");
        assert.equal(result.outcome, "complete");
        const hosted = result.snapshot.certificates.find((certificate) => certificate.identityType === "hosted");
        assert(hosted, "enrollment must add a hosted certificate");
        assert.equal(hosted.state, "active");
        assert.match(hosted.certificateSha256, /^sha256:[0-9a-f]{64}$/u);
        assert.ok(hosted.certificateId);
        assert.ok(hosted.notAfterUnixSeconds > Math.floor(Date.now() / 1000));
      } catch (error) {
        throw evidenceFailure(error, await invoke<AccountSnapshotDto>("account_snapshot"));
      }
    });

    it("keeps local recipient-key generation independent from hosted auth", async () => {
      const before = await invoke<AccountSnapshotDto>("account_snapshot");
      const after = await invoke<AccountSnapshotDto>("account_generate_recipient_key", { request: { label: "Local Recovery Recipient" } });
      assert.equal(after.recipientKeys.length, before.recipientKeys.length + 1);
      assert.equal(after.recipientKeys.at(-1)?.lifecycle, "active");
    });

    it("syncs signed hosted contacts, rejects malformed cards, and applies removals", async () => {
      const first = await invoke<AccountContactSyncResultDto>("account_sync_contacts");
      let contactDiagnostics: Record<string, string> = {};
      if (first.counts.imported < 2 && fixture) {
        contactDiagnostics = Object.fromEntries(await Promise.all(fixture.contactCards.map(async ({ name, card }) => {
          try {
            await invoke("account_inspect_contact_card", { request: { contactCard: card } });
            return [name, "accepted"] as const;
          } catch (error) {
            return [name, String(error)] as const;
          }
        })));
      }
      assert.ok(first.counts.imported + first.counts.updated >= 2, JSON.stringify({ counts: first.counts, contactDiagnostics }));
      assert.ok(first.counts.rejected >= 1, JSON.stringify(first.counts));
      assert.equal(first.counts.statusRefreshFailed, 0, JSON.stringify(first.counts));
      assert.ok(first.snapshot.contacts.length >= 2);

      await fixture?.setContactSnapshotVersion(2);
      const second = await invoke<AccountContactSyncResultDto>("account_sync_contacts");
      assert.ok(second.counts.updated >= 1, JSON.stringify(second.counts));
      assert.ok(second.counts.removed >= 1, JSON.stringify(second.counts));
      assert.ok(second.counts.rejected >= 1, JSON.stringify(second.counts));
    });

    it("creates, verifies, extracts, and hashes a signed portable archive", async () => {
      const hosted = (await invoke<AccountSnapshotDto>("account_snapshot")).certificates.find((certificate) => certificate.identityType === "hosted" && certificate.state === "active");
      assert(hosted);
      const archivePath = path.join(runArtifactDir, "signed-portable.tzap");
      const sourceManifest = hashTree(sourceRoot);
      await startCreate({
        sources: [sourceRoot], destinationPath: archivePath, format: "tzap", cleanSource: false,
        replaceExisting: true, preserveMetadata: true,
        tzapCertificates: { signingSelection: { mode: "enrolledIdentity", signingIdentityId: hosted.identityId }, recipientSelection: { recipientKeyIds: [], contactRecipientIds: [], oneTimeCertificatePaths: [] } },
      });
      const offline = await invoke<VerifyTzapCertificateResponse>("verify_tzap_certificate", { request: { archivePath, validateTrust: true, trustedCaCertificatePaths: [fixture!.rootCertificatePath], trustedSystemRoots: false, includeOfficialTzapRoot: false, checkCurrentStatus: false, environment: config.environment } });
      // The local fixture root is intentionally a custom root. The shared
      // archive verifier labels only pinned production/staging roots as
      // trusted, so assert the independent cryptographic axes explicitly.
      assert.equal(offline.signatureCheck, "ok", JSON.stringify(offline));
      assert.equal(offline.certificateTime, "valid_at_signing", JSON.stringify(offline));
      const extractedRoot = path.join(runArtifactDir, "extracted-portable");
      await startExtract({ archivePath, destinationPath: extractedRoot, password: null, recipientKeyId: null, overwrite: "replace", destinationCollisionStrategy: "refuse", entryPaths: null, stripComponents: 0, tzapRestorePolicy: "content", tzapAllowDegraded: false, tzapAllowAbsoluteSymlinks: false, ignoreSymlinks: false });
      assertHashManifestEqual(sourceManifest, path.join(extractedRoot, path.basename(sourceRoot)));
      writeArchiveEvidence({ artifactDir: runArtifactDir, archivePath, sourceManifest, signerCertificateSha256: hosted.certificateSha256, runId: process.env.TZAP_E2E_RUN_ID ?? "unknown" });
    });

    it("rejects unsafe TZAP option combinations at the command boundary", async () => {
      const outcome = await invokeExpectingError("start_create", { request: { sources: [sourceRoot], destinationPath: path.join(runArtifactDir, "invalid.tzap"), format: "tzap", cleanSource: false, replaceExisting: true, preserveMetadata: true, password: "fixture-password-never-log", tzapCertificates: { signingSelection: { mode: "none" }, recipientSelection: { recipientKeyIds: ["missing"], contactRecipientIds: [], oneTimeCertificatePaths: [] } } } });
      assert.equal(outcome.code, "invalid_request");
      assertNoSecrets(outcome, ["fixture-password-never-log"]);
    });

    it("reports online status separately from offline cryptographic verification", async () => {
      const archivePath = path.join(runArtifactDir, "signed-portable.tzap");
      if (!existsSync(archivePath)) pending("portable signed archive was not produced by the preceding lifecycle case");
      const offline = await invoke<VerifyTzapCertificateResponse>("verify_tzap_certificate", { request: { archivePath, validateTrust: true, trustedCaCertificatePaths: [fixture!.rootCertificatePath], trustedSystemRoots: false, includeOfficialTzapRoot: false, checkCurrentStatus: false, environment: config.environment } });
      const online = await invoke<VerifyTzapCertificateResponse>("verify_tzap_certificate", { request: { archivePath, validateTrust: true, trustedCaCertificatePaths: [fixture!.rootCertificatePath], trustedSystemRoots: false, includeOfficialTzapRoot: false, checkCurrentStatus: true, environment: config.environment } });
      assert.equal(online.certificateSha256, offline.certificateSha256);
      assert.ok(online.statusCheck);
      assert.ok(online.statusThisUpdateUnixSeconds);
    });
  });
}
