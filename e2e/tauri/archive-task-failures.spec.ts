import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { closeTaskWindow, invokeExpectingError, invokeOk, openTaskWindowForJob, runJobInTaskWindow, waitForTaskJob } from "./helpers/archiveCommands.ts";
import {
  fixturePath,
  hasFixtureCorpus,
  makeTempDir,
  missingCorpusReason,
} from "./helpers/archiveFixtures.ts";

/**
 * Task-window capability isolation and asynchronous job failure paths.
 *
 * Demonstrates that:
 * 1. The capability model strictly forbids job control from the main window.
 * 2. Synchronous request errors reject with invalid_request.
 * 3. Asynchronous in-job failures (wrong password, missing password, missing
 *    entry, read-only destination) transition the job to the failed terminal
 *    status observable via the catalog feed.
 */

const EXTRACT_DEFAULTS = {
  password: null,
  recipientKeyId: null,
  overwrite: "replace",
  destinationCollisionStrategy: "refuse",
  entryPaths: null,
  stripComponents: 0,
  tzapRestorePolicy: "content",
  tzapAllowDegraded: false,
  ignoreSymlinks: false,
} as const;

const TASK_TIMEOUT_MS = 60_000;

if (!hasFixtureCorpus()) {
  describe("Archive task failures and capability isolation", () => {
    it("requires the sibling fixture corpus", () => {
      pending(missingCorpusReason());
    });
  });
} else {
  describe("Archive task failures and capability isolation", () => {
    describe("window capability isolation", () => {
      it(
        "rejects job control commands when called from the main window",
        async () => {
          const cancelOutcome = await invokeExpectingError("cancel_job", {
            request: { jobId: "non-existent-job" },
          });
          assert.equal(cancelOutcome.code, "invalid_request");
          assert.equal(cancelOutcome.message, "job_control_forbidden");

          const pauseOutcome = await invokeExpectingError("pause_job", {
            request: { jobId: "non-existent-job" },
          });
          assert.equal(pauseOutcome.code, "invalid_request");
          assert.equal(pauseOutcome.message, "job_control_forbidden");
        },
        TASK_TIMEOUT_MS,
      );
    });

    describe("synchronous extract request validation", () => {
      it(
        "rejects empty archive path or destination path synchronously",
        async () => {
          const emptyArchive = await invokeExpectingError("start_extract", {
            request: {
              ...EXTRACT_DEFAULTS,
              archivePath: "",
              destinationPath: "/tmp/dest",
            },
          });
          assert.equal(emptyArchive.code, "invalid_request", `empty archivePath: ${emptyArchive.message}`);

          const emptyDest = await invokeExpectingError("start_extract", {
            request: {
              ...EXTRACT_DEFAULTS,
              archivePath: fixturePath("basic.tar.gz"),
              destinationPath: "",
            },
          });
          assert.equal(emptyDest.code, "invalid_request", `empty destinationPath: ${emptyDest.message}`);
        },
        TASK_TIMEOUT_MS,
      );

      it(
        "rejects create requests whose source has already disappeared",
        async () => {
          const missingSource = path.join(process.cwd(), "e2e", "fixtures", "source-that-does-not-exist");
          const outcome = await invokeExpectingError("start_create", {
            request: {
              sources: [missingSource],
              destinationPath: path.join(process.cwd(), "e2e", "missing-source-output.zip"),
              format: "zip",
              cleanSource: false,
              replaceExisting: true,
              preserveMetadata: true,
            },
          });
          assert.equal(outcome.code, "not_found");
        },
        TASK_TIMEOUT_MS,
      );
    });

    describe("asynchronous extract failure paths", () => {
      it(
        "transitions to failed when extracting an encrypted archive with a wrong password",
        async () => {
          const temp = makeTempDir("task-wrong-pass");
          const attemptedPassword = "super-secret-wrong-password";
          try {
            const outcome = await runJobInTaskWindow("start_extract", {
              ...EXTRACT_DEFAULTS,
              archivePath: fixturePath("rar5-passworded-multipart.part1.rar"),
              destinationPath: temp.dir,
              password: attemptedPassword,
            });

            assert.equal(outcome.status, "failed", `wrong password extract should fail, got ${outcome.status}`);
            assert.equal(outcome.latestFailure?.code, "invalid_password");
            await assertNoSecretInDiagnostics(attemptedPassword);
          } finally {
            temp.cleanup(false);
          }
        },
        TASK_TIMEOUT_MS,
      );

      it(
        "transitions to failed when extracting an encrypted archive without a password",
        async () => {
          const temp = makeTempDir("task-missing-pass");
          try {
            const outcome = await runJobInTaskWindow("start_extract", {
              ...EXTRACT_DEFAULTS,
              archivePath: fixturePath("rar5-passworded-multipart.part1.rar"),
              destinationPath: temp.dir,
              password: null,
            });

            assert.equal(outcome.status, "failed", `missing password extract should fail, got ${outcome.status}`);
            assert.ok(
              ["password_required", "invalid_password"].includes(outcome.latestFailure?.code ?? ""),
              `missing password should be rejected as a password error, got ${outcome.latestFailure?.code}`,
            );
          } finally {
            temp.cleanup(false);
          }
        },
        TASK_TIMEOUT_MS,
      );

      it(
        "transitions to failed when extracting with entryPaths naming a missing member",
        async () => {
          const temp = makeTempDir("task-missing-entry");
          try {
            const outcome = await runJobInTaskWindow("start_extract", {
              ...EXTRACT_DEFAULTS,
              archivePath: fixturePath("basic.tar.gz"),
              destinationPath: temp.dir,
              entryPaths: ["payload/definitely_not_in_archive.txt"],
            });

            assert.equal(outcome.status, "failed", `missing entryPaths extract should fail, got ${outcome.status}`);
            assert.equal(outcome.latestFailure?.code, "not_found");
          } finally {
            temp.cleanup(false);
          }
        },
        TASK_TIMEOUT_MS,
      );

      if (process.platform !== "win32") {
        it(
          "transitions to failed when extracting into a read-only destination directory",
          async () => {
            const temp = makeTempDir("task-readonly-dest");
            const readOnlyDest = path.join(temp.dir, "readonly");
            mkdirSync(readOnlyDest, { recursive: true });
            chmodSync(readOnlyDest, 0o555);

            try {
              const outcome = await runJobInTaskWindow("start_extract", {
                ...EXTRACT_DEFAULTS,
                archivePath: fixturePath("basic.tar.gz"),
                destinationPath: readOnlyDest,
              });

              assert.equal(outcome.status, "failed", `read-only destination extract should fail, got ${outcome.status}`);
              assert.equal(outcome.latestFailure?.code, "io_error");
            } finally {
              chmodSync(readOnlyDest, 0o755);
              temp.cleanup(false);
            }
          },
          TASK_TIMEOUT_MS,
        );
      }

      it(
        "cancels an in-flight create from its owning task window",
        async () => {
          const temp = makeTempDir("task-cancel-create");
          let taskLabel: string | null = null;
          try {
            const source = path.join(temp.dir, "source");
            mkdirSync(source, { recursive: true });
            // Incompressible input plus single-threaded maximum 7z compression
            // keeps the job live long enough for the task control to be used.
            writeFileSync(path.join(source, "large.bin"), randomBytes(128 * 1024 * 1024));
            const started = await invokeOk<{
              jobId: string;
              kind: string;
              status: string;
              createdAt: string;
            }>("start_create", {
              request: {
                sources: [source],
                destinationPath: path.join(temp.dir, "cancelled.7z"),
                format: "sevenZ",
                cleanSource: false,
                replaceExisting: true,
                preserveMetadata: false,
                compressionLevel: 9,
                sevenZSolid: true,
                sevenZThreads: 1,
                sevenZChunkSize: 1024 * 1024,
                sevenZEncryptFileNames: false,
              },
            });
            taskLabel = await openTaskWindowForJob(started);
            const cancel = await $("button=Cancel");
            await cancel.waitForDisplayed({ timeout: 10_000 });
            await cancel.click();
            const outcome = await waitForTaskJob(started.jobId, TASK_TIMEOUT_MS);
            assert.equal(outcome.status, "cancelled", `cancelled create reached ${outcome.status}`);
            assert.equal(outcome.latestFailure, null, "cancelled create must not be surfaced as a failed job");
          } finally {
            if (taskLabel) await closeTaskWindow(taskLabel);
            temp.cleanup(false);
          }
        },
        TASK_TIMEOUT_MS * 2,
      );
    });
  });
}

async function assertNoSecretInDiagnostics(secret: string): Promise<void> {
  const info = await invokeOk<{ enabled: boolean; path: string | null }>("diagnostic_log_info");
  if (!info.enabled || !info.path || !existsSync(info.path)) return;
  const log = readFileSync(info.path, "utf8");
  assert.ok(!log.includes(secret), "password appeared in the diagnostic log");
}
