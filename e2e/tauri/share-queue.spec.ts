import { mkdtemp, writeFile, rm, mkdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, basename } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import type { EnqueueShareResponse, ShareRegistrySnapshot, LocalSendDeviceInfoDto } from "../../src/api/types";

type DiagnosticLogInfo = Readonly<{
  enabled: boolean;
  path: string | null;
  sessionId: string;
}>;

type DiagnosticLogEntry = Readonly<{
  sessionId: string;
  scope: string;
  name: string;
  fields: Record<string, unknown>;
}>;

function launchNativeShareQuickAction(artifactPath: string): Promise<void> {
  const appPath = process.env.ZMANAGER_GUI_APP_PATH ?? resolve("src-tauri", "target", "debug", "zmanager-desktop");
  const child = spawn(appPath, ["--quick-action", "share-lan", "--path", artifactPath], {
    env: {
      ...process.env,
      ZMANAGER_GUI_TEST_MODE: "1",
      ZMANAGER_GUI_TEST_DEEP_LINK: "1",
    },
    stdio: "ignore",
  });

  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Secondary ZManager launch did not finish."));
    }, 15_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) resolvePromise();
      else reject(new Error(`Secondary ZManager launch exited with code ${code ?? "null"} and signal ${signal ?? "none"}.`));
    });
  });
}

async function nativeInboundOutcomeCounts(info: DiagnosticLogInfo): Promise<Readonly<{ acknowledged: number; failed: number }>> {
  if (!info.enabled || !info.path) throw new Error("Native diagnostic log is unavailable.");
  const entries = (await readFile(info.path, "utf8")).split(/\r?\n/u).flatMap((line) => {
    try {
      return line ? [JSON.parse(line) as DiagnosticLogEntry] : [];
    } catch {
      return [];
    }
  });
  const nativeInboundEntries = entries.filter((entry) => entry.sessionId === info.sessionId && entry.scope === "nativeInbound");
  return {
    acknowledged: nativeInboundEntries.filter((entry) => entry.name === "eventAcknowledged" && entry.fields.kind === "shellActionRequest").length,
    failed: nativeInboundEntries.filter((entry) => entry.name === "deliveryFailed").length,
  };
}

async function command<T>(name: string, request?: unknown): Promise<T> {
  return browser.tauri.execute(async ({ core }, cmd, args) => core.invoke(cmd, args), name, request === undefined ? {} : { request }) as Promise<T>;
}
async function rejectedCode(name: string, request: unknown): Promise<string> {
  return browser.tauri.execute(async ({ core }, cmd, args) => {
    try { await core.invoke(cmd, { request: args }); return "accepted"; }
    catch (error) { return (error as { code?: string }).code ?? String(error); }
  }, name, request);
}

describe("native share queue", () => {
  let directory: string;
  let artifact: string;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "zmanager-sharing-"));
    artifact = join(directory, "sharing-proof.txt");
    await writeFile(artifact, "ZManager sharing regression fixture. No private user data.\n");
    await browser.waitUntil(async () => (await browser.$('[data-runtime-bridge-state="ready"]').isExisting()), { timeout: 30_000 });
  });
  afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

  it("rejects stale receiver selection after cancellation through real Rust commands", async () => {
    const result = await command<EnqueueShareResponse>("enqueue_share", { mode: "directShare", clientRequestId: `cancel-${Date.now()}`, senderAlias: "Sharing QA", artifactPath: artifact, receiver: null });
    await command("cancel_share", { shareId: result.item.shareId });
    expect(await rejectedCode("set_share_receiver", { shareId: result.item.shareId, receiver: { alias: "Test", fingerprint: "test", port: 53317, protocol: "https", ip: "127.0.0.1", deviceModel: null } })).toBe("share_invalid_state");
    await command("remove_share", { shareId: result.item.shareId });
  });

  it("restores a minimized window for a native direct-share request without background focus", async () => {
    const diagnosticInfo = await command<DiagnosticLogInfo>("diagnostic_log_info");
    const baselineOutcomes = await nativeInboundOutcomeCounts(diagnosticInfo);
    const previousShareQueue = await command<ShareRegistrySnapshot>("get_share_queue");
    const previousShareIds = new Set(previousShareQueue.items.map((item) => item.shareId));
    await browser.tauri.execute(async ({ core }) => {
      await core.invoke("plugin:window|minimize", { label: "main" });
    });
    await browser.waitUntil(async () => browser.tauri.execute(async ({ core }) => {
      return !!await core.invoke("plugin:window|is_minimized", { label: "main" });
    }));
    await launchNativeShareQuickAction(artifact);
    let shareId = "";
    await browser.waitUntil(async () => {
      const queue = await command<ShareRegistrySnapshot>("get_share_queue");
      shareId = queue.items.find((item) => !previousShareIds.has(item.shareId))?.shareId ?? "";
      return !!shareId;
    });
    await browser.waitUntil(async () => browser.tauri.execute(async ({ core }) => {
      const args = { label: "main" };
      return !!await core.invoke("plugin:window|is_visible", args) && !await core.invoke("plugin:window|is_minimized", args);
    }));
    await browser.$(`[data-share-id="${shareId}"]`).waitForDisplayed();
    await browser.waitUntil(async () => {
      const outcomes = await nativeInboundOutcomeCounts(diagnosticInfo);
      if (outcomes.failed > baselineOutcomes.failed) throw new Error("Native share request delivery failed.");
      return outcomes.acknowledged > baselineOutcomes.acknowledged;
    }, { timeout: 5_000, interval: 100 });
    await command("cancel_share", { shareId });
    await command("remove_share", { shareId });
  });

  let alias = process.env.ZMANAGER_SHARE_TEST_RECEIVER_ALIAS;
  const receiverIp = process.env.ZMANAGER_SHARE_TEST_RECEIVER_IP;
  const modes = process.env.ZMANAGER_SHARE_TEST_COMPRESS ? ["directShare", "compressAndShare"] as const : ["directShare"] as const;
  const manifest: { name: string; bytes: number; sha256: string }[] = [];
  for (const mode of modes) {
  ((alias || receiverIp) ? it : xit)(`sends a generated ${mode} fixture to the real receiver and preserves completion`, async () => {
    const discovered = await command<LocalSendDeviceInfoDto[]>("localsend_discover", { alias: "ZManager Sharing QA", https: true });
    console.log(`SHARE_DISCOVERY ${JSON.stringify(discovered)}`);
    if (receiverIp) alias = discovered.find(device => device.ip === receiverIp)?.alias;
    if (!alias) throw new Error("Requested receiver was not discovered");
    const payload = randomBytes(16 * 1024 * 1024);
    artifact = join(directory, `zmanager-sharing-proof-${Date.now()}.bin`);
    await writeFile(artifact, payload);
    console.log(`SHARE_PROOF ${JSON.stringify({ artifact, sha256: createHash("sha256").update(payload).digest("hex"), bytes: payload.length, receiverAlias: alias })}`);
    const { item } = await command<EnqueueShareResponse>("enqueue_share", mode === "directShare"
      ? { mode, clientRequestId: `interop-${Date.now()}`, senderAlias: "ZManager Sharing QA", artifactPath: artifact, receiver: null }
      : { mode, clientRequestId: `interop-${Date.now()}`, senderAlias: "ZManager Sharing QA", receiver: null, createRequest: { sources: [artifact], destinationPath: artifact + ".zip", format: "zip", cleanSource: false, replaceExisting: false, preserveMetadata: true } });
    const row = await browser.$(`[data-share-id="${item.shareId}"]`);
    await row.waitForDisplayed();
    await row.$('button[aria-label="LAN receiver"]').click();
    const receiverButton = await browser.$(`button*=${alias}`);
    await receiverButton.waitForDisplayed({ timeout: 20_000 });
    await receiverButton.click();
    if (process.env.ZMANAGER_SHARE_TEST_RETRY) {
      await browser.waitUntil(async () => (await command<ShareRegistrySnapshot>("get_share_queue")).items.find(record => record.shareId === item.shareId)?.transferState === "failed", { timeout: 30_000 });
      expect(await row.$('button[aria-label="LAN receiver"]').isExisting()).toBe(false);
      await row.$('button=Retry').click();
      await row.$('button=Retry anyway').waitForDisplayed();
      await row.$('button=Retry anyway').click();
    }
    await browser.waitUntil(async () => {
      const queue = await command<ShareRegistrySnapshot>("get_share_queue");
      const current = queue.items.find(record => record.shareId === item.shareId)!;
      if (current.transferState === "failed") throw new Error(JSON.stringify(current.lastError));
      return current.transferState === "sent";
    }, { timeout: 120_000, interval: 500 });
    const queue = await command<ShareRegistrySnapshot>("get_share_queue");
    const completed = queue.items.find(record => record.shareId === item.shareId)!;
    expect(completed.receiver?.alias).toBe(alias);
    if (process.env.ZMANAGER_SHARE_TEST_RETRY) expect(completed.attempt).toBe(2);
    expect(await row.$('button[aria-label="LAN receiver"]').isExisting()).toBe(false);
    expect(await rejectedCode("set_share_receiver", { shareId: item.shareId, receiver: { ...completed.receiver as LocalSendDeviceInfoDto, fingerprint: "another-device" } })).toBe("share_receiver_locked");
    expect(await rejectedCode("cancel_share", { shareId: item.shareId })).toBe("share_already_completed");
    await mkdir(resolve("test-results"), { recursive: true });
    await browser.saveScreenshot(resolve("test-results/sharing-native-completed.png"));
    const transferred = await readFile(completed.artifactPath!);
    const proof = { name: basename(completed.artifactPath!), sha256: createHash("sha256").update(transferred).digest("hex"), bytes: transferred.length };
    manifest.push(proof);
    if (process.env.ZMANAGER_SHARE_EXPECTATIONS) await writeFile(process.env.ZMANAGER_SHARE_EXPECTATIONS, JSON.stringify(manifest));
    console.log(`SHARE_COMPLETE ${JSON.stringify({ ...proof, mode, shareId: item.shareId, receiver: completed.receiver?.alias, bytesSent: completed.bytesSent, totalBytes: completed.totalBytes })}`);
    await row.$('button=Dismiss').click();
    await row.waitForExist({ reverse: true });
  }, 150_000);
  }
});
