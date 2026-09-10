import { expect, test, type Page } from "@playwright/test";
import type { ShareRecordSnapshot, LocalSendDeviceInfoDto } from "../src/api/types";
import { shareFixture } from "../src/app/shareQueueTestFixtures";

type IpcCall = {
  cmd: string;
  args: Record<string, unknown>;
};

type QuickActionStartupState = {
  launchedForQuickAction: boolean;
  windowDisposition?: "mainWindow" | "disposableTask" | null;
  error: null;
};

type NativeInboundEvent = {
  version: 1;
  eventId: string;
  kind: "shellActionRequest";
  timestampUnixMs: number;
  payload: {
    request: { kind: string; paths: string[] };
  };
};

type QuickActionStubOptions = {
  shareItems?: ShareRecordSnapshot[];
  discoveries?: LocalSendDeviceInfoDto[][];
  rejectWindowCommands?: string[];
  completeOnPoll?: boolean;
  startupStateDelayMs?: number;
  catalogJobs?: { jobId: string; kind: string; status: string; createdAt: string }[];
  nativeInboundEvents?: NativeInboundEvent[];
};


const notRequestedState: QuickActionStartupState = {
  launchedForQuickAction: false,
  error: null,
};

const epochSecondsAgo = (seconds: number) => String(Math.floor(Date.now() / 1000) - seconds);

test("restored main window reconciles terminal jobs from the catalog without per-Job subscriptions", async ({ page }) => {
  await installQuickActionTauriStub(page, [notRequestedState], {
    catalogJobs: [{
      jobId: "job-from-task-window",
      kind: "zipExtract",
      status: "completed",
      createdAt: epochSecondsAgo(10),
    }],
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect.poll(async () => (await ipcCalls(page)).some((call) => call.cmd === "subscribe_job_catalog")).toBe(true);
  const calls = await ipcCalls(page);
  expect(calls.some((call) => call.cmd === "subscribe_job")).toBe(false);
});

test("cold fixed create requests use the Native Inbox, keep Main hidden, and hand off once", async ({ page }) => {
  await installQuickActionTauriStub(page, [
    {
      launchedForQuickAction: true,
      windowDisposition: "disposableTask",
      error: null,
    },
    notRequestedState,
  ], {
    nativeInboundEvents: [shellActionEvent(
      "create-event-123456",
      "compressTzap",
      ["/tmp/source"],
    )],
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expectWindowCommand(page, "plugin:webview|create_webview_window");

  const calls = await ipcCalls(page);
  expect(calls.filter((call) => call.cmd === "start_create")).toHaveLength(1);
  expect(calls.some((call) => call.cmd === "subscribe_job")).toBe(false);
  expect(calls.some((call) => call.cmd === "plugin:window|show")).toBe(false);
});

test("cold extract-here requests start without listing or revealing Main", async ({ page }) => {
  await installQuickActionTauriStub(page, [
    {
      launchedForQuickAction: true,
      windowDisposition: "disposableTask",
      error: null,
    },
    notRequestedState,
  ], {
    nativeInboundEvents: [shellActionEvent(
      "extract-event-123456",
      "extractHere",
      ["/tmp/archive.tzap"],
    )],
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expectWindowCommand(page, "plugin:webview|create_webview_window");

  const calls = await ipcCalls(page);
  expect(calls.filter((call) => call.cmd === "start_extract")).toHaveLength(1);
  expect(calls.some((call) => call.cmd === "list_archive")).toBe(false);
  expect(calls.some((call) => call.cmd === "subscribe_job")).toBe(false);
  expect(calls.some((call) => call.cmd === "plugin:window|show")).toBe(false);
});

test("two fixed requests receive two independent task windows", async ({ page }) => {
  await installQuickActionTauriStub(page, [
    {
      launchedForQuickAction: true,
      windowDisposition: "disposableTask",
      error: null,
    },
    notRequestedState,
  ], {
    nativeInboundEvents: [
      shellActionEvent("create-event-one-123", "compressZip", ["/tmp/one"]),
      shellActionEvent("create-event-two-123", "compressZip", ["/tmp/two"]),
    ],
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect.poll(async () => (
    await ipcCalls(page)
  ).filter((call) => call.cmd === "plugin:webview|create_webview_window").length).toBe(2);
  const calls = await ipcCalls(page);
  expect(calls.filter((call) => call.cmd === "start_create")).toHaveLength(2);
  expect(calls.some((call) => call.cmd === "plugin:window|show")).toBe(false);
});

test("replayed Native Inbox delivery does not start a duplicate Job", async ({ page }) => {
  const replay = shellActionEvent(
    "replayed-create-event-123",
    "compressZip",
    ["/tmp/source"],
  );
  await installQuickActionTauriStub(page, [
    {
      launchedForQuickAction: true,
      windowDisposition: "disposableTask",
      error: null,
    },
    notRequestedState,
  ], {
    nativeInboundEvents: [replay, replay],
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expectWindowCommand(page, "plugin:webview|create_webview_window");
  await expect.poll(async () => (
    await ipcCalls(page)
  ).filter((call) => call.cmd === "acknowledge_native_event").length).toBe(2);
  const calls = await ipcCalls(page);
  expect(calls.filter((call) => call.cmd === "start_create")).toHaveLength(1);
});

function shellActionEvent(
  eventId: string,
  kind: string,
  paths: string[],
): NativeInboundEvent {
  return {
    version: 1,
    eventId,
    kind: "shellActionRequest",
    timestampUnixMs: 1,
    payload: { request: { kind, paths } },
  };
}

async function installQuickActionTauriStub(
  page: Page,
  startupStates: QuickActionStartupState[],
  options: QuickActionStubOptions = {},
) {
  await page.addInitScript((payload: {
    startupStates: QuickActionStartupState[];
    options: QuickActionStubOptions;
  }) => {
    const states = payload.startupStates;
    const rejectedWindowCommands = new Set(payload.options.rejectWindowCommands ?? []);
    const completeOnPoll = payload.options.completeOnPoll ?? true;
    const startupStateDelayMs = payload.options.startupStateDelayMs ?? 0;
    const ipcCalls: IpcCall[] = [];
    const jobStatuses = new Map<string, string>();
    const jobKinds = new Map<string, string>();
    const jobCreatedAts = new Map<string, string>();
    const callbacks = new Map<number, { callback: unknown; once: boolean }>();
    let callbackId = 1;
    let startedJobCount = 0;
    let startupDelayConsumed = false;
    let subscriptionCount = 0;
    let nativeInboundHandlerId: number | null = null;
    let shareHandler: number | null = null;
    let shareItems = payload.options.shareItems ?? [];
    let shareRevision = 1;
    const discoveries = [...(payload.options.discoveries ?? [[]])];
    const shareChanged = () => {
      shareRevision++;
      if (shareHandler !== null) window.__TAURI_INTERNALS__?.runCallback(shareHandler, { event: "zmanager-share-queue-changed", id: 1, payload: String(shareRevision) });
    };
    const jobChannels = new Map<string, { callbackId: number; subscriptionId: string; revision: number }>();
    const catalogJobs = payload.options.catalogJobs ?? [];
    for (const job of catalogJobs) {
      jobStatuses.set(job.jobId, job.status);
      jobKinds.set(job.jobId, job.kind);
      jobCreatedAts.set(job.jobId, job.createdAt);
    }

    const channelCallbackId = (value: unknown): number => {
      if (typeof value === "number") return value;
      const serialized = typeof value === "string" ? value : JSON.stringify(value);
      return Number(serialized?.match(/(\d+)/)?.[1] ?? 0);
    };
    const deliverJob = (jobId: string, requestedStatus?: string) => {
      const channel = jobChannels.get(jobId); if (!channel) return;
      const previous = jobStatuses.get(jobId) ?? "queued";
      const status = requestedStatus ?? (["paused", "completed", "failed", "cancelled"].includes(previous) ? previous : "running");
      jobStatuses.set(jobId, status); channel.revision += 1;
      const terminal = status === "completed" || status === "failed" || status === "cancelled";
      const createdAt = jobCreatedAts.get(jobId) ?? String(Math.floor(Date.now() / 1000));
      const payload = { revision: String(channel.revision), jobId, kind: jobKinds.get(jobId) ?? "tzapCreate", status, createdAt, updatedAt: createdAt,
        canPause: status === "running", canResume: status === "paused", canCancel: status === "running" || status === "paused", canDismiss: terminal,
        progressFacts: { processedBytes: terminal ? 128 : 32, totalBytes: 128, processedEntries: terminal ? 4 : 2, totalEntries: 4, currentPath: "fixture.bin", recentPaths: ["fixture.bin"], activePhase: "emittingPayload", phaseProcessedBytes: terminal ? 128 : 32, phaseTotalBytes: 128, warningCount: 0, activeElapsedMillis: 1000, phaseElapsedMillis: 1000 },
        latestFailure: null, boundedNotices: [],
        availableActions: terminal ? [{ actionId: "open-output", kind: "open", artifactId: "output" }] : [],
        outputArtifacts: terminal ? [{ artifactId: "output", kind: "directory", path: "/tmp/output" }] : [], retryDescriptor: null,
        terminalSummary: status === "completed" ? { writtenEntries: 1, writtenBytes: 32, warnings: [] } : null };
      queueMicrotask(() => window.__TAURI_INTERNALS__?.runCallback(channel.callbackId, {
        index: channel.revision - 1,
        message: { subscriptionId: channel.subscriptionId, revision: payload.revision, payload },
      }));
    };

    Object.defineProperty(window, "isTauri", {
      configurable: true,
      value: true,
    });

    window.__zmanagerE2E = { ipcCalls };

    const invoke = async (cmd: string, args: Record<string, unknown> = {}) => {
      ipcCalls.push({ cmd, args });

      if (rejectedWindowCommands.has(cmd)) {
        throw new Error(`Rejected ${cmd}`);
      }

      if (cmd === "get_share_queue") return { queueRevision: String(shareRevision), items: structuredClone(shareItems) };
      if (cmd === "enqueue_share") return { item: shareItems[0], deduplicated: false };
      if (cmd === "localsend_discover") {
        await new Promise(resolve => setTimeout(resolve, 250));
        return discoveries.shift() ?? [];
      }
      if (cmd === "set_share_receiver") {
        const request = args.request as { shareId: string; receiver: LocalSendDeviceInfoDto };
        const item = shareItems.find(item => item.shareId === request.shareId)!;
        item.receiver = request.receiver; item.transferState = "sending"; item.bytesSent = 20; item.totalBytes = 100;
        shareChanged();
        window.setTimeout(() => { item.bytesSent = 100; shareChanged(); }, 600);
        window.setTimeout(() => { item.transferState = "sent"; shareChanged(); }, 2000);
        return item;
      }
      if (cmd === "remove_share") {
        shareItems = shareItems.filter(item => item.shareId !== (args.request as { shareId: string }).shareId);
        shareChanged(); return;
      }
      if (cmd === "healthcheck") {
        return {
          engine: "zmanager-core",
          version: "e2e",
          ready: true,
          summary: "E2E backend stub",
          shell: "playwright",
          status: "ok",
        };
      }

      if (cmd === "project_contract") {
        return {
          commands: ["start_create", "start_extract", "subscribe_job", "subscribe_job_catalog", "cancel_job", "pause_job", "resume_job"],
          platformStrategy: "e2e",
          coreDependency: "stub",
          platformIntegration: {
            platform: "linux",
            packageKind: "development",
            capabilities: [
              "shellSelectedItemActions",
              "shellBackgroundActions",
              "fileAssociations",
              "defaultHandlerControl",
            ].map((id) => ({ id, availability: "available" })),

          },
        };
      }

      if (cmd === "quick_action_startup_state") {
        if (startupStateDelayMs > 0 && !startupDelayConsumed) {
          startupDelayConsumed = true;
          await new Promise((resolve) => setTimeout(resolve, startupStateDelayMs));
        }
        const state = states.shift() ?? {
          launchedForQuickAction: false,
          error: null,
        };
        return state;
      }

      if (cmd === "native_frontend_ready") {
        if (nativeInboundHandlerId !== null) {
          for (const nativeEvent of payload.options.nativeInboundEvents ?? []) {
            queueMicrotask(() => window.__TAURI_INTERNALS__?.runCallback(
              nativeInboundHandlerId as number,
              {
                event: "zmanager-native-inbound-event",
                id: nativeEvent.eventId,
                payload: nativeEvent,
              },
            ));
          }
        }
        return 0;
      }

      if (cmd === "acknowledge_native_event") {
        return undefined;
      }

      if (cmd === "replacement_migration_prepare") {
        return {
          schemaVersion: 1,
          completed: true,
          requiresCompletion: false,
          preferences: {},
          diagnostics: [],
          rollback: {
            legacyStateRetained: true,
            reversibleKeys: [],
            irreversibleOperations: [],
          },
        };
      }

      if (cmd === "start_create" || cmd === "start_extract") {
        startedJobCount += 1;
        const jobId = `started-job-${startedJobCount}`;
        const kind = cmd === "start_create" ? "zipCreate" : "zipExtract";
        const createdAt = String(Math.floor(Date.now() / 1000));
        jobStatuses.set(jobId, "queued");
        jobKinds.set(jobId, kind);
        jobCreatedAts.set(jobId, createdAt);
        return {
          jobId,
          kind,
          status: "queued",
          createdAt,
        };
      }

      if (cmd === "subscribe_job_catalog") {
        const subscriptionId = `catalog-${++subscriptionCount}`;
        const callbackId = channelCallbackId(args.onSnapshot);
        const jobs = catalogJobs.map((job) => ({
          jobId: job.jobId,
          revision: "1",
          kind: job.kind,
          status: job.status,
          terminal: ["completed", "failed", "cancelled"].includes(job.status),
        }));
        if (payload.options.catalogJobs) {
          window.setTimeout(() => window.__TAURI_INTERNALS__?.runCallback(callbackId, {
            index: 0,
            message: {
              subscriptionId,
              revision: "1",
              payload: { catalogRevision: "1", jobs },
            },
          }), 0);
        }
        return subscriptionId;
      }
      if (cmd === "subscribe_job") {
        const request = args.request as { jobId: string }; const subscriptionId = `job-${++subscriptionCount}`;
        jobChannels.set(request.jobId, { callbackId: channelCallbackId(args.onSnapshot), subscriptionId, revision: 0 }); deliverJob(request.jobId); return subscriptionId;
      }
      if (cmd === "ack_subscription") {
        const subscriptionId = (args.request as { subscriptionId?: string } | undefined)?.subscriptionId;
        const entry = [...jobChannels.entries()].find(([, channel]) => channel.subscriptionId === subscriptionId);
        if (completeOnPoll && entry && jobStatuses.get(entry[0]) === "running") {
          window.setTimeout(() => deliverJob(entry[0], "completed"), 1_500);
        }
        return undefined;
      }
      if (cmd === "unsubscribe_job") return undefined;

      if (cmd === "cancel_job") {
        const request = args.request as { jobId: string };
        jobStatuses.set(request.jobId, "cancelled");
        deliverJob(request.jobId, "cancelled");
        return {
          jobId: request.jobId,
          status: "cancelled",
        };
      }

      if (cmd === "pause_job") {
        const request = args.request as { jobId: string };
        jobStatuses.set(request.jobId, "paused");
        deliverJob(request.jobId, "paused");
        return {
          jobId: request.jobId,
          status: "paused",
        };
      }

      if (cmd === "resume_job") {
        const request = args.request as { jobId: string };
        jobStatuses.set(request.jobId, "running");
        deliverJob(request.jobId, "running");
        return {
          jobId: request.jobId,
          status: "running",
        };
      }

      if (cmd === "start_archive_index") {
        const request = args.request as { archivePath: string };
        return {
          sessionId: "archive-e2e",
          snapshot: {
            revision: "1",
            sessionId: "archive-e2e",
            archivePath: request.archivePath,
            status: "indexing",
            discoveredEntries: 0,
          },
        };
      }

      if (cmd === "wait_archive_index") {
        return {
          revision: "2",
          sessionId: "archive-e2e",
          archivePath: "C:/fixtures/archive.zip",
          status: "empty",
          discoveredEntries: 0,
          finalEntryCount: 0,
          finalTotalBytes: 0,
        };
      }

      if (cmd === "get_archive_children" || cmd === "search_archive_index") {
        return {
          sessionId: "archive-e2e",
          revision: "2",
          parentPath: "",
          entries: [],
          complete: true,
          childCount: 0,
        };
      }

      if (cmd === "close_archive_index") return undefined;

      if (cmd === "system_file_icons") {
        const request = args.request as { entries?: Array<{ key: string }> };
        return {
          icons: (request.entries ?? []).map((entry) => ({
            key: entry.key,
            dataUrl: null,
          })),
        };
      }

      if (cmd === "cleanup_preview_roots") {
        return undefined;
      }

      if (cmd === "plugin:window|inner_size") {
        return { width: 1280, height: 800 };
      }

      if (cmd === "plugin:window|inner_position") {
        return { x: 20, y: 20 };
      }

      if (cmd === "plugin:event|listen") {
        if (args.event === "zmanager-share-queue-changed") shareHandler = channelCallbackId(args.handler);
        if (args.event === "zmanager-native-inbound-event") {
          nativeInboundHandlerId = channelCallbackId(args.handler);
        }
        return args.handler;
      }

      if (cmd === "plugin:event|unlisten" || cmd.startsWith("plugin:window|") || cmd.startsWith("plugin:webview|")) {
        return undefined;
      }

      if (cmd.startsWith("plugin:")) {
        return undefined;
      }

      throw new Error(`Unhandled Tauri command in quick-action stub: ${cmd}`);
    };

    const transformCallback = (callback: unknown, once = false) => {
      const id = callbackId++;
      callbacks.set(id, { callback, once });
      return id;
    };

    const unregisterCallback = (id: number) => {
      callbacks.delete(id);
    };

    const runCallback = (id: number, data: unknown) => {
      const registration = callbacks.get(id);
      if (!registration || typeof registration.callback !== "function") {
        return;
      }
      if (registration.once) {
        callbacks.delete(id);
      }
      registration.callback(data);
    };

    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: (_event: string, id: number) => unregisterCallback(id),
    };

    window.__TAURI_INTERNALS__ = {
      callbacks,
      convertFileSrc: (path: string) => path,
      invoke,
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
      runCallback,
      transformCallback,
      unregisterCallback,
    };
  }, { startupStates, options });
}

async function ipcCalls(page: Page): Promise<IpcCall[]> {
  return page.evaluate(() => window.__zmanagerE2E?.ipcCalls ?? []);
}

async function expectWindowCommand(page: Page, command: string) {
  await expect.poll(async () => {
    const calls = await ipcCalls(page);
    return calls.some((call) => call.cmd === command);
  }, { timeout: 15_000 }).toBe(true);
}


test("LAN share discovers from picker, shows progress, and locks completed receiver", async ({ page }) => {
  const peer = { alias: "Same name", fingerprint: "peer", port: 53317, protocol: "https", ip: "192.168.1.5", deviceModel: "Windows" };
  await installQuickActionTauriStub(page, [notRequestedState], { shareItems: [shareFixture()], discoveries: [[], [peer, { ...peer, fingerprint: "other", ip: "192.168.1.6" }]] });
  await page.goto("/");
  const panel = page.getByRole("region", { name: "Share queue" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: "Refresh receivers" })).toHaveCount(0);
  await panel.getByRole("button", { name: "LAN receiver" }).click();
  await expect(page.getByText(/No devices found/)).toBeVisible();
  await page.getByRole("button", { name: "Search again" }).click();
  await page.getByRole("button", { name: "Same name Windows · 192.168.1.5", exact: true }).click();
  await expect(panel.getByRole("button", { name: "LAN receiver" })).toHaveCount(0);
  await expect(panel.getByRole("progressbar")).toBeVisible();
  await expect(panel.getByRole("status")).toContainText("Finishing");
  await expect(panel.getByRole("status")).toContainText("Shared");
  await page.screenshot({ path: "test-results/sharing-completed.png" });
  await expect(panel.getByRole("button", { name: "Cancel transfer" })).toHaveCount(0);
  await panel.getByRole("button", { name: "Dismiss" }).click();
  await expect(panel).toHaveCount(0);
});

test("direct LAN request explicitly restores and focuses the main window", async ({ page }) => {
  await installQuickActionTauriStub(page, [notRequestedState], { shareItems: [shareFixture()], nativeInboundEvents: [shellActionEvent("share-native", "shareOnLan", ["/tmp/fixture.txt"])] });
  await page.goto("/");
  await expectWindowCommand(page, "plugin:window|unminimize");
  await expectWindowCommand(page, "plugin:window|set_focus");
  await expect(page.getByRole("region", { name: "Share queue" })).toBeVisible();
});
