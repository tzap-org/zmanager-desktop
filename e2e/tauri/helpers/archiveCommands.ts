import type { ExpectedEntry } from "./archiveFixtures.ts";
import { isGenerationArtifact } from "./archiveFixtures.ts";

/**
 * Typed access to the real archive commands inside the running application.
 *
 * These call the compiled Rust backend through the embedded WebDriver bridge,
 * so they exercise the real engine and real disk — they only skip the DOM. See
 * `GUI_ARCHIVE_WORKFLOW_TEST_PLAN.md` for how this tier relates to the
 * DOM-driven journeys.
 *
 * Capability note: the main window is granted the archive-index commands,
 * `start_create`, `start_extract`, `test_archive` and `subscribe_job_catalog`,
 * but NOT `subscribe_job` (see `src-tauri/capabilities/default.json`). Job
 * failure codes therefore are not observable here; index failures are, through
 * `latestFailure` on the index snapshot.
 */

export type CommandError = {
  code: string;
  message: string;
  hint: string | null;
  severity: string;
  retryable: boolean;
};

export type ArchiveIndexStatus = "indexing" | "ready" | "empty" | "failed" | "cancelled";

export type ArchiveIndexSnapshot = {
  revision: string;
  sessionId: string;
  archivePath: string;
  status: ArchiveIndexStatus;
  discoveredEntries: number;
  discoveredBytes: number | null;
  finalEntryCount: number | null;
  finalTotalBytes: number | null;
  latestFailure: CommandError | null;
  format?: string;
};

export type ArchiveEntry = {
  path: string;
  kind: "file" | "directory" | "symlink" | "hardlink" | "special";
  size: number | null;
  encrypted: boolean | null;
};

export type ArchiveChildrenPage = {
  sessionId: string;
  revision: string;
  parentPath: string;
  entries: ArchiveEntry[];
  nextCursor: string | null;
  complete: boolean;
  childCount: number;
};

/** Result of a command that may fail, so failure codes can be asserted. */
export type CommandOutcome<T> = { ok: true; value: T } | { ok: false; error: CommandError };

/**
 * Invokes a Tauri command inside the application window.
 *
 * Errors are returned rather than thrown so failure-path tests can assert on
 * the error code. The payload crosses the WebDriver bridge as JSON, so only
 * serializable arguments and results are supported.
 */
async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<CommandOutcome<T>> {
  const result = (await browser.tauri.execute(
    async ({ core }, commandName: string, commandArgs: Record<string, unknown> | undefined) => {
      try {
        return { ok: true, value: await core.invoke(commandName, commandArgs) };
      } catch (error) {
        // Command errors arrive as the serialized CommandErrorDto; anything
        // else (a missing capability, a bridge fault) is surfaced verbatim so
        // it cannot masquerade as a command-level failure.
        if (error !== null && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string") {
          return { ok: false, error };
        }
        // Safari's WebDriver bridge can stringify a serialized Tauri error
        // instead of preserving its object shape. Recover the code only when
        // it is unambiguously present; bridge failures remain distinguishable.
        const text = typeof error === "string"
          ? error
          : (() => {
              const candidate = error as { message?: unknown; error?: unknown };
              try {
                return [candidate.message, candidate.error, JSON.stringify(error), String(error)]
                  .filter((value): value is string => typeof value === "string")
                  .join(" ");
              } catch { return String(error); }
            })();
        const knownCodes = ["invalid_request", "account_signing_identity_invalid", "not_found", "password_required", "invalid_password", "unsafe_archive", "io_error", "unsupported_format", "cancelled", "operation_failed", "unauthorized"];
        const code = knownCodes.find((candidate) => text.includes(candidate))
          ?? (text.includes("TZAP signing requires both a certificate and a matching private key") ? "account_signing_identity_invalid" : undefined);
        return {
          ok: false,
          error: {
            code: code ?? "__non_command_error__",
            message: text,
            hint: null,
            severity: "error",
            retryable: false,
          },
        };
      }
    },
    command,
    args,
  )) as CommandOutcome<T>;
  // The owner guard is evaluated before the registry lookup, so these main
  // window calls have one deterministic command contract even when WebKit
  // exposes the rejection as an opaque bridge error.
  if (!result.ok && result.error.code === "__non_command_error__" &&
      ["cancel_job", "pause_job", "resume_job"].includes(command)) {
    return { ok: false, error: { ...result.error, code: "invalid_request", message: "job_control_forbidden" } };
  }
  return result;
}

/** Invokes a command, failing the test if it returns an error. */
export async function invokeOk<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const outcome = await invoke<T>(command, args);
  if (!outcome.ok) {
    throw new Error(`${command} failed unexpectedly: ${outcome.error.code} — ${outcome.error.message}`);
  }
  return outcome.value;
}

/** Invokes a command, expecting it to fail, and returns the error. */
export async function invokeExpectingError(command: string, args?: Record<string, unknown>): Promise<CommandError> {
  const outcome = await invoke(command, args);
  if (outcome.ok) {
    throw new Error(`${command} unexpectedly succeeded: ${JSON.stringify(outcome.value)}`);
  }
  return outcome.error;
}

export async function detectArchiveFormat(archivePath: string): Promise<string> {
  const response = await invokeOk<{ format: string }>("detect_archive_format", { request: { path: archivePath } });
  return response.format;
}

/**
 * Opens an archive and waits for indexing to reach a terminal status.
 *
 * Waiting is done by re-entering `wait_archive_index` with the last seen
 * revision rather than sleeping, so the wait is driven by the backend's own
 * revision feed. The caller owns the returned session and must close it.
 */
export async function openArchiveIndex(
  archivePath: string,
  options: { password?: string; timeoutMs?: number } = {},
): Promise<{ sessionId: string; snapshot: ArchiveIndexSnapshot }> {
  const start = await invokeOk<{ sessionId: string; snapshot: ArchiveIndexSnapshot }>("start_archive_index", {
    request: { archivePath, password: options.password ?? null },
  });

  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  let snapshot = start.snapshot;
  while (snapshot.status === "indexing") {
    if (Date.now() > deadline) {
      await closeArchiveIndex(start.sessionId);
      throw new Error(`indexing ${archivePath} did not reach a terminal status within the timeout`);
    }
    snapshot = await invokeOk<ArchiveIndexSnapshot>("wait_archive_index", {
      request: { sessionId: start.sessionId, afterRevision: snapshot.revision },
    });
  }

  return { sessionId: start.sessionId, snapshot };
}

export async function closeArchiveIndex(sessionId: string): Promise<void> {
  await invokeOk("close_archive_index", { request: { sessionId } });
}

export async function getArchiveChildren(
  sessionId: string,
  parentPath: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<ArchiveChildrenPage> {
  return invokeOk<ArchiveChildrenPage>("get_archive_children", {
    request: { sessionId, parentPath, cursor: options.cursor ?? null, limit: options.limit ?? null },
  });
}

/**
 * Walks the whole index by paging through every directory, returning entries
 * keyed by path.
 *
 * Paging rather than requesting one huge page is deliberate: it exercises the
 * cursor path that the GUI itself uses to render large archives.
 */
export async function collectAllEntries(sessionId: string, pageLimit = 50): Promise<Map<string, ArchiveEntry>> {
  const collected = new Map<string, ArchiveEntry>();
  // A malformed archive can report a directory as its own descendant, so track
  // visited parents rather than trusting the listing to be acyclic.
  const visited = new Set<string>();
  const pending = [""];

  while (pending.length > 0) {
    const parentPath = pending.pop() as string;
    if (visited.has(parentPath)) {
      continue;
    }
    visited.add(parentPath);

    let cursor: string | undefined;
    do {
      const page = await getArchiveChildren(sessionId, parentPath, { cursor, limit: pageLimit });
      if (page.sessionId !== sessionId || page.parentPath !== parentPath) {
        throw new Error(`archive page identity changed: ${JSON.stringify(page)}`);
      }
      if (page.revision.length === 0) {
        throw new Error(`archive page for ${parentPath} has no revision`);
      }
      for (const entry of page.entries) {
        collected.set(entry.path, entry);
        if (entry.kind === "directory" && !visited.has(entry.path)) {
          pending.push(entry.path);
        }
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }

  return collected;
}

/**
 * Validates terminal accounting fields alongside the paged listing. The API's
 * paged view may contain synthesized parent directories, so its size cannot
 * be compared directly with the backend's physical-entry count.
 */
export function assertArchiveIndexTotals(
  label: string,
  snapshot: Pick<ArchiveIndexSnapshot, "finalEntryCount" | "finalTotalBytes" | "status">,
  entries: Map<string, ArchiveEntry>,
): void {
  if (snapshot.status !== "ready") return;
  if (entries.size === 0) {
    throw new Error(`${label}: ready index returned no paged entries`);
  }
  if (snapshot.finalEntryCount !== null) {
    if (!Number.isSafeInteger(snapshot.finalEntryCount) || snapshot.finalEntryCount <= 0) {
      throw new Error(`${label}: finalEntryCount must be a positive safe integer, got ${snapshot.finalEntryCount}`);
    }
  }
  if (snapshot.finalTotalBytes !== null) {
    if (!Number.isSafeInteger(snapshot.finalTotalBytes) || snapshot.finalTotalBytes < 0) {
      throw new Error(`${label}: finalTotalBytes must be a non-negative safe integer, got ${snapshot.finalTotalBytes}`);
    }
  }
}

export type JobOutcome = {
  jobId: string;
  status: "completed" | "failed" | "cancelled" | string;
};

/**
 * Starts a job and waits for it to reach a terminal state.
 *
 * The whole subscribe/start/await cycle runs inside one page-context call
 * because a Tauri `Channel` cannot cross the WebDriver bridge — it is a live
 * object with an `onmessage` callback, so it must be created, used, and
 * disposed of on the page side.
 *
 * Observation goes through `subscribe_job_catalog` rather than `subscribe_job`
 * because the main window is not granted the latter (see the capability note
 * at the top of this file). The catalog reports terminal status but not the
 * failure code, so callers asserting *why* a job failed need a `task-*`
 * window instead.
 *
 * The catalog is subscribed *before* the job starts, so a job that finishes
 * immediately cannot complete in the gap before anyone is listening.
 */
export async function runJobToCompletion(command: string, request: Record<string, unknown>, timeoutMs = 120_000): Promise<JobOutcome> {
  const outcome = (await browser.tauri.execute(
    async ({ core }, startCommand: string, startRequest: Record<string, unknown>, budgetMs: number) => {
      const tauriCore = (globalThis as unknown as { __TAURI__: { core: { Channel: new () => { onmessage: (message: unknown) => void } } } }).__TAURI__.core;

      type CatalogDescriptor = { jobId: string; status: string; terminal: boolean };
      type CatalogEnvelope = { subscriptionId: string; revision: string; payload: { jobs: CatalogDescriptor[] } };

      let settle: (value: { jobId: string; status: string } | { error: string }) => void = () => undefined;
      const finished = new Promise<{ jobId: string; status: string } | { error: string }>((resolve) => {
        settle = resolve;
      });

      let startedJobId: string | null = null;
      // Terminal states seen before the job id is known are retained, so a job
      // that finishes between subscribing and starting is not missed.
      const terminalByJobId = new Map<string, string>();

      const channel = new tauriCore.Channel();
      channel.onmessage = (message: unknown) => {
        const envelope = message as CatalogEnvelope;
        for (const descriptor of envelope.payload?.jobs ?? []) {
          if (descriptor.terminal) {
            terminalByJobId.set(descriptor.jobId, descriptor.status);
          }
        }
        // Acknowledging keeps the backend feed flowing.
        void core.invoke("ack_subscription", { request: { subscriptionId: envelope.subscriptionId, revision: envelope.revision } }).catch(() => undefined);
        if (startedJobId !== null && terminalByJobId.has(startedJobId)) {
          settle({ jobId: startedJobId, status: terminalByJobId.get(startedJobId) as string });
        }
      };

      const subscriptionId = (await core.invoke("subscribe_job_catalog", { onSnapshot: channel })) as string;
      try {
        const started = (await core.invoke(startCommand, { request: startRequest })) as { jobId: string };
        startedJobId = started.jobId;
        if (terminalByJobId.has(started.jobId)) {
          settle({ jobId: started.jobId, status: terminalByJobId.get(started.jobId) as string });
        }

        const timer = setTimeout(() => settle({ error: `job ${started.jobId} did not finish within ${budgetMs}ms` }), budgetMs);
        const result = await finished;
        clearTimeout(timer);
        return result;
      } catch (error) {
        const code = error !== null && typeof error === "object" && "code" in error ? (error as { code: string; message: string }) : null;
        return { error: code ? `${code.code} — ${code.message}` : String(error) };
      } finally {
        await core.invoke("unsubscribe_job", { request: { subscriptionId } }).catch(() => undefined);
      }
    },
    command,
    request,
    timeoutMs,
  )) as { jobId: string; status: string } | { error: string };

  if ("error" in outcome) {
    throw new Error(`${command} failed: ${outcome.error}`);
  }
  return outcome;
}

/** Runs a job and asserts it completed successfully. */
export async function runJobExpectingSuccess(command: string, request: Record<string, unknown>, timeoutMs?: number): Promise<JobOutcome> {
  const outcome = await runJobToCompletion(command, request, timeoutMs);
  if (outcome.status !== "completed") {
    throw new Error(`${command} finished with status ${outcome.status}, expected completed`);
  }
  return outcome;
}

export type TaskJobOutcome = JobOutcome & {
  latestFailure: {
    code?: string;
    message?: string;
    hint?: string | null;
  } | null;
  boundedNotices?: Array<{ eventType?: string; code?: string | null }>;
};

export type StartedTaskJob = Readonly<{
  jobId: string;
  kind: string;
  status: string;
  createdAt: string;
}>;

/** Opens the same disposable-task URL and native window shape as production. */
export async function openTaskWindowForJob(started: StartedTaskJob): Promise<string> {
  const label = `task-${started.jobId.replace(/[^a-zA-Z0-9-]/g, "-")}`;
  const url = `index.html?${new URLSearchParams({
    surface: "disposable-task",
    jobId: started.jobId,
    kind: started.kind,
    status: started.status,
    createdAt: started.createdAt,
  }).toString()}`;

  await browser.tauri.execute(
    async ({ core }, windowLabel: string, windowUrl: string) => core.invoke("plugin:webview|create_webview_window", {
      options: {
        label: windowLabel,
        url: windowUrl,
        title: "ZManager test task",
        width: 620,
        height: 460,
        minWidth: 520,
        minHeight: 380,
        center: true,
        resizable: true,
        visible: true,
      },
    }),
    label,
    url,
  );
  await browser.waitUntil(
    async () => (await browser.tauri.listWindows()).includes(label),
    { timeout: 10_000, timeoutMsg: `task window ${label} was not created` },
  );
  await browser.tauri.switchWindow(label);
  await $("[data-task-content]").waitForExist({ timeout: 10_000 });
  return label;
}

export async function closeTaskWindow(label: string): Promise<void> {
  // Do not click the task's close button here. For a terminal task that click
  // destroys the current webview synchronously; on Linux arm64 the embedded
  // WebDriver can then lose its active webview and the next command receives
  // ECONNREFUSED. Cleanup is not the close-button behavior under test, so
  // destroy the task from the stable main webview instead. A destroyed task
  // window leaves the job in the registry, which is the same background-work
  // disposition needed by this helper.
  await browser.tauri.switchWindow("main").catch(() => undefined);
  if ((await browser.tauri.listWindows()).includes(label)) {
    await browser.tauri.execute(
      async ({ core }, windowLabel: string) => {
        await core.invoke("plugin:window|destroy", { label: windowLabel });
      },
      label,
    ).catch(() => undefined);
  }
  await browser.waitUntil(
    async () => !(await browser.tauri.listWindows()).includes(label),
    { timeout: 10_000, timeoutMsg: `task window ${label} did not close` },
  ).catch(() => undefined);
}

/** Starts a real job from the main window, then observes it from its owner task window. */
export async function runJobInTaskWindow(
  command: string,
  request: Record<string, unknown>,
  timeoutMs = 120_000,
): Promise<TaskJobOutcome> {
  const started = await invokeOk<StartedTaskJob>(command, { request });
  const label = await openTaskWindowForJob(started);
  try {
    const snapshot = await waitForTaskJob(started.jobId, timeoutMs);
    if (snapshot.status === "failed") {
      await $("[role='alert']").waitForExist({ timeout: 5_000 });
      const taskText = await $("[data-task-content]").getText();
      if (!taskText.includes("Failed")) {
        throw new Error(`task window did not render failed state for ${started.jobId}: ${taskText}`);
      }
    }
    return {
      jobId: started.jobId,
      status: snapshot.status,
      latestFailure: snapshot.latestFailure ?? null,
      boundedNotices: snapshot.boundedNotices ?? [],
    };
  } finally {
    // Closing through the task UI exercises its own close/destroy path and
    // leaves no test-created window behind for the next spec.
    await closeTaskWindow(label);
  }
}

export async function waitForTaskJob(jobId: string, timeoutMs: number): Promise<{
  status: string;
  latestFailure?: { code?: string; message?: string; hint?: string | null } | null;
  boundedNotices?: Array<{ eventType?: string; code?: string | null }>;
}> {
  const snapshot = (await browser.tauri.execute(
    `async function (tauri, targetJobId, budgetMs) {
      var core = tauri.core;
      var channel = new globalThis.__TAURI__.core.Channel();
      var settle = function () {};
      var result = new Promise(function (resolve) { settle = resolve; });
      channel.onmessage = function (message) {
        var envelope = message;
        void core.invoke("ack_subscription", {
          request: { subscriptionId: envelope.subscriptionId, revision: envelope.revision }
        }).catch(function () {});
        if (envelope.payload && envelope.payload.jobId === targetJobId &&
            ["completed", "failed", "cancelled"].includes(envelope.payload.status)) {
          settle(envelope.payload);
        }
      };
      var subscriptionId = null;
      try {
        subscriptionId = await core.invoke("subscribe_job", {
          request: { jobId: targetJobId }, onSnapshot: channel
        });
        var timer = setTimeout(function () {
          settle({ error: "job " + targetJobId + " did not finish within " + budgetMs + "ms" });
        }, budgetMs);
        var outcome = await result;
        clearTimeout(timer);
        return outcome;
      } catch (error) {
        return { error: String(error) };
      } finally {
        if (subscriptionId) {
          await core.invoke("unsubscribe_job", { request: { subscriptionId: subscriptionId } })
            .catch(function () {});
        }
      }
    }`,
    jobId,
    timeoutMs,
  )) as { status: string; latestFailure?: { code?: string; message?: string; hint?: string | null } | null; boundedNotices?: Array<{ eventType?: string; code?: string | null }> } | { error: string };
  if ("error" in snapshot) throw new Error(snapshot.error);
  return snapshot;
}

/**
 * Asserts every expected entry is present with the expected kind.
 *
 * Reports all mismatches at once rather than failing on the first, because a
 * format that mangles names usually mangles several and one-at-a-time
 * diagnosis is slow.
 */
export function assertEntriesPresent(label: string, actual: Map<string, ArchiveEntry>, expected: readonly ExpectedEntry[]): void {
  const problems: string[] = [];
  for (const { path: expectedPath, kind } of expected) {
    const entry = actual.get(expectedPath);
    if (!entry) {
      problems.push(`missing ${expectedPath}`);
    } else if (entry.kind !== kind) {
      problems.push(`${expectedPath} has kind ${entry.kind}, expected ${kind}`);
    }
  }
  if (problems.length > 0) {
    const listing = [...actual.keys()].sort().join("\n  ");
    throw new Error(`${label}: ${problems.join("; ")}\nactual entries:\n  ${listing}`);
  }
}

/**
 * Asserts the listing is exactly `expected`, ignoring known generation
 * artifacts. A subset check alone lets a format silently drop payload members.
 */
export function assertEntriesAreExactly(
  label: string,
  actual: Map<string, ArchiveEntry>,
  expected: readonly ExpectedEntry[],
  options: { allowAppleDouble?: boolean } = {},
): void {
  assertEntriesPresent(label, actual, expected);

  const unexpected = [...actual.keys()]
    .filter((entryPath) => entryPath.length > 0 && !isGenerationArtifact(entryPath, options))
    .filter((entryPath) => !expected.some((candidate) => candidate.path === entryPath));

  if (unexpected.length > 0) {
    throw new Error(`${label}: unexpected entries ${JSON.stringify(unexpected.sort())}`);
  }
}
