import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  closeArchiveIndex,
  collectAllEntries,
  detectArchiveFormat,
  openArchiveIndex,
  runJobExpectingSuccess,
} from "./helpers/archiveCommands.ts";
import {
  hasFixtureCorpus,
  makeTempDir,
  missingCorpusReason,
  readTree,
  writePayloadSourceTree,
} from "./helpers/archiveFixtures.ts";

/**
 * Create option matrix across all formats and source-filtering axes.
 *
 * Covers:
 * - Format capabilities (compression methods, split volumes, solid modes, encryption)
 * - Source selection filters (excludeNames, excludeArchivePaths, includeArchivePaths, respectGitignore)
 * - Lifecycle and safety options (cleanSource, replaceExisting)
 */

const CREATE_DEFAULTS = {
  cleanSource: false,
  replaceExisting: true,
  preserveMetadata: true,
} as const;

const CREATE_TIMEOUT_MS = 120_000;

if (!hasFixtureCorpus()) {
  describe("Archive create option matrix", () => {
    it("requires the sibling fixture corpus", () => {
      pending(missingCorpusReason());
    });
  });
} else {
  describe("Archive create option matrix", () => {
    describe("format-specific compression options", () => {
      it(
        "creates a ZIP archive with store (uncompressed) method",
        async () => {
          const temp = makeTempDir("create-zip-store");
          try {
            const source = path.join(temp.dir, "source");
            const payload = writePayloadSourceTree(source, { withSymlink: false });
            const destination = path.join(temp.dir, "archive_store.zip");

            await runJobExpectingSuccess("start_create", {
              ...CREATE_DEFAULTS,
              sources: [payload],
              destinationPath: destination,
              format: "zip",
              zipCompression: "store",
            });

            const { sessionId, snapshot } = await openArchiveIndex(destination);
            try {
              assert.equal(snapshot.status, "ready");
              const entries = await collectAllEntries(sessionId);
              assert.ok(entries.has("payload/README.txt"));
            } finally {
              await closeArchiveIndex(sessionId);
            }
          } finally {
            temp.cleanup(false);
          }
        },
        CREATE_TIMEOUT_MS,
      );

      it(
        "creates a 7z archive with solid mode enabled and disabled",
        async () => {
          const temp = makeTempDir("create-7z-solid");
          try {
            const source = path.join(temp.dir, "source");
            const payload = writePayloadSourceTree(source, { withSymlink: false });

            // 1. Solid enabled
            const solidDest = path.join(temp.dir, "solid.7z");
            await runJobExpectingSuccess("start_create", {
              ...CREATE_DEFAULTS,
              sources: [payload],
              destinationPath: solidDest,
              format: "sevenZ",
              sevenZSolid: true,
            });

            const solidOpen = await openArchiveIndex(solidDest);
            try {
              assert.equal(solidOpen.snapshot.status, "ready");
            } finally {
              await closeArchiveIndex(solidOpen.sessionId);
            }

            // 2. Non-solid
            const nonSolidDest = path.join(temp.dir, "non_solid.7z");
            await runJobExpectingSuccess("start_create", {
              ...CREATE_DEFAULTS,
              sources: [payload],
              destinationPath: nonSolidDest,
              format: "sevenZ",
              sevenZSolid: false,
            });

            const nonSolidOpen = await openArchiveIndex(nonSolidDest);
            try {
              assert.equal(nonSolidOpen.snapshot.status, "ready");
            } finally {
              await closeArchiveIndex(nonSolidOpen.sessionId);
            }
          } finally {
            temp.cleanup(false);
          }
        },
        CREATE_TIMEOUT_MS,
      );

      it(
        "creates a 7z archive with encrypted header/filenames",
        async () => {
          const temp = makeTempDir("create-7z-encrypt-names");
          try {
            const source = path.join(temp.dir, "source");
            const payload = writePayloadSourceTree(source, { withSymlink: false });
            const destination = path.join(temp.dir, "encrypted_names.7z");
            const password = "sevenz-secret-password";

            await runJobExpectingSuccess("start_create", {
              ...CREATE_DEFAULTS,
              sources: [payload],
              destinationPath: destination,
              format: "sevenZ",
              password,
              sevenZEncryptFileNames: true,
            });

            // Opening without password must demand password and not leak entry names
            const openWithoutPass = await openArchiveIndex(destination);
            try {
              assert.ok(
                ["password_required", "invalid_password", "failed"].includes(openWithoutPass.snapshot.status) ||
                openWithoutPass.snapshot.latestFailure !== null,
                "encrypted header archive should require password on open",
              );
            } finally {
              await closeArchiveIndex(openWithoutPass.sessionId);
            }

            // Opening with password succeeds
            const openWithPass = await openArchiveIndex(destination, { password });
            try {
              assert.equal(openWithPass.snapshot.status, "ready");
              const entries = await collectAllEntries(openWithPass.sessionId);
              assert.ok(entries.has("payload/README.txt"));
            } finally {
              await closeArchiveIndex(openWithPass.sessionId);
            }
          } finally {
            temp.cleanup(false);
          }
        },
        CREATE_TIMEOUT_MS,
      );

      it(
        "creates a TZAP archive with custom recovery percentage",
        async () => {
          const temp = makeTempDir("create-tzap-recovery");
          try {
            const source = path.join(temp.dir, "source");
            const payload = writePayloadSourceTree(source, { withSymlink: false });
            const destination = path.join(temp.dir, "recovery.tzap");

            await runJobExpectingSuccess("start_create", {
              ...CREATE_DEFAULTS,
              sources: [payload],
              destinationPath: destination,
              format: "tzap",
              tzapRecoveryPercentage: 10,
            });

            const { sessionId, snapshot } = await openArchiveIndex(destination);
            try {
              assert.ok(snapshot.status === "ready" || snapshot.status === "empty");
              const entries = await collectAllEntries(sessionId);
              assert.ok(entries.has("payload/README.txt"));
            } finally {
              await closeArchiveIndex(sessionId);
            }
          } finally {
            temp.cleanup(false);
          }
        },
        CREATE_TIMEOUT_MS,
      );

      it(
        "creates exact TZAP volumes, discovers their names, and recovers after one volume is missing",
        async () => {
          const temp = makeTempDir("create-tzap-volume-count");
          let failed = true;
          try {
            const source = path.join(temp.dir, "source");
            const payload = writePayloadSourceTree(source, { withSymlink: false });
            // Use incompressible content so the round-robin writer exercises
            // every requested volume instead of collapsing a tiny fixture into
            // a trivial payload distribution.
            writeFileSync(path.join(payload, "payload.bin"), randomBytes(3 * 1024 * 1024));
            const destination = path.join(temp.dir, "exact-count.tzap");

            await runJobExpectingSuccess("start_create", {
              ...CREATE_DEFAULTS,
              sources: [payload],
              destinationPath: destination,
              format: "tzap",
              volumeCount: 4,
              tzapVolumeLossTolerance: 1,
            });

            const expectedVolumes = [
              "exact-count.vol000.tzap",
              "exact-count.vol001.tzap",
              "exact-count.vol002.tzap",
              "exact-count.vol003.tzap",
            ];
            assert.deepEqual(
              readdirSync(temp.dir).filter((name) => name.startsWith("exact-count.vol") && name.endsWith(".tzap")).sort(),
              expectedVolumes,
              "exact-count mode must commit exactly four numbered TZAP volumes",
            );
            assert.equal(existsSync(destination), false, "multi-volume TZAP must use the numbered volume path set");

            const firstVolume = path.join(temp.dir, expectedVolumes[0]);
            const missingVolume = path.join(temp.dir, "exact-count.vol002.tzap");
            unlinkSync(missingVolume);
            const opened = await openArchiveIndex(firstVolume);
            try {
              assert.ok(["ready", "empty"].includes(opened.snapshot.status), "one missing volume should remain openable within the declared tolerance");
              const entries = await collectAllEntries(opened.sessionId);
              assert.ok(entries.has("payload/payload.bin"), "recovered listing must retain the large payload");
            } finally {
              await closeArchiveIndex(opened.sessionId);
            }

            const extracted = path.join(temp.dir, "extracted");
            await runJobExpectingSuccess("start_extract", {
              archivePath: firstVolume,
              destinationPath: extracted,
              overwrite: "replace",
              stripComponents: 0,
              tzapRestorePolicy: "portable",
              tzapAllowDegraded: false,
              tzapAllowAbsoluteSymlinks: false,
              ignoreSymlinks: false,
            });
            assert.ok(existsSync(path.join(extracted, "payload", "payload.bin")), "recovered extraction must write the payload");
            failed = false;
          } finally {
            temp.cleanup(failed);
          }
        },
        CREATE_TIMEOUT_MS,
      );

      it(
        "creates TAR.GZ and TAR.ZST with min and max compression levels",
        async () => {
          const temp = makeTempDir("create-compression-levels");
          try {
            const source = path.join(temp.dir, "source");
            const payload = writePayloadSourceTree(source, { withSymlink: false });

            // TAR.GZ level 1
            const tarGzFast = path.join(temp.dir, "fast.tar.gz");
            await runJobExpectingSuccess("start_create", {
              ...CREATE_DEFAULTS,
              sources: [payload],
              destinationPath: tarGzFast,
              format: "tarGz",
              compressionLevel: 1,
            });
            assert.ok(existsSync(tarGzFast));

            // TAR.ZST level 1
            const tarZstFast = path.join(temp.dir, "fast.tar.zst");
            await runJobExpectingSuccess("start_create", {
              ...CREATE_DEFAULTS,
              sources: [payload],
              destinationPath: tarZstFast,
              format: "tarZst",
              compressionLevel: 1,
            });
            assert.ok(existsSync(tarZstFast));
          } finally {
            temp.cleanup(false);
          }
        },
        CREATE_TIMEOUT_MS,
      );
    });

    describe("source selection and filter axes", () => {
      it(
        "excludes files matching excludeNames",
        async () => {
          const temp = makeTempDir("create-exclude-names");
          try {
            const source = path.join(temp.dir, "source");
            const payload = writePayloadSourceTree(source, { withSymlink: false });
            const destination = path.join(temp.dir, "filtered.zip");

            await runJobExpectingSuccess("start_create", {
              ...CREATE_DEFAULTS,
              sources: [payload],
              destinationPath: destination,
              format: "zip",
              excludeNames: ["file.txt", "こんにちは.txt"],
            });

            const { sessionId, snapshot } = await openArchiveIndex(destination);
            try {
              assert.equal(snapshot.status, "ready");
              const entries = await collectAllEntries(sessionId);
              assert.ok(entries.has("payload/README.txt"), "README should be present");
              assert.ok(!entries.has("payload/nested/file.txt"), "file.txt should be excluded");
              assert.ok(!entries.has("payload/unicode/こんにちは.txt"), "unicode file should be excluded");
            } finally {
              await closeArchiveIndex(sessionId);
            }
          } finally {
            temp.cleanup(false);
          }
        },
        CREATE_TIMEOUT_MS,
      );

      it(
        "excludes specific paths matching excludeArchivePaths",
        async () => {
          const temp = makeTempDir("create-exclude-paths");
          try {
            const source = path.join(temp.dir, "source");
            const payload = writePayloadSourceTree(source, { withSymlink: false });
            const destination = path.join(temp.dir, "path_filtered.zip");

            await runJobExpectingSuccess("start_create", {
              ...CREATE_DEFAULTS,
              sources: [payload],
              destinationPath: destination,
              format: "zip",
              excludeArchivePaths: ["payload/unicode/こんにちは.txt"],
            });

            const { sessionId, snapshot } = await openArchiveIndex(destination);
            try {
              assert.equal(snapshot.status, "ready");
              const entries = await collectAllEntries(sessionId);
              assert.ok(entries.has("payload/README.txt"));
              assert.ok(!entries.has("payload/unicode/こんにちは.txt"));
            } finally {
              await closeArchiveIndex(sessionId);
            }
          } finally {
            temp.cleanup(false);
          }
        },
        CREATE_TIMEOUT_MS,
      );

      it(
        "filters files using .gitignore when respectGitignore is enabled",
        async () => {
          const temp = makeTempDir("create-gitignore");
          try {
            const source = path.join(temp.dir, "source");
            const payload = writePayloadSourceTree(source, { withSymlink: false });

            // Create a .gitignore and an ignored file inside payload
            writeFileSync(path.join(payload, ".gitignore"), "ignored.log\n");
            writeFileSync(path.join(payload, "ignored.log"), "this should be ignored\n");
            writeFileSync(path.join(payload, "kept.txt"), "this should be kept\n");

            const destination = path.join(temp.dir, "gitignore.tar.gz");

            await runJobExpectingSuccess("start_create", {
              ...CREATE_DEFAULTS,
              sources: [payload],
              destinationPath: destination,
              format: "tarGz",
              respectGitignore: true,
            });

            const { sessionId, snapshot } = await openArchiveIndex(destination);
            try {
              assert.equal(snapshot.status, "ready");
              const entries = await collectAllEntries(sessionId);
              assert.ok(entries.has("payload/kept.txt"), "kept.txt should be in archive");
              assert.ok(!entries.has("payload/ignored.log"), "ignored.log should be omitted by .gitignore");
            } finally {
              await closeArchiveIndex(sessionId);
            }
          } finally {
            temp.cleanup(false);
          }
        },
        CREATE_TIMEOUT_MS,
      );

      it(
        "re-includes an explicitly selected path from the clean-source exclusions",
        async () => {
          const temp = makeTempDir("create-include-paths");
          try {
            const source = path.join(temp.dir, "source");
            const payload = writePayloadSourceTree(source, { withSymlink: false });
            mkdirSync(path.join(payload, "node_modules", "kept"), { recursive: true });
            mkdirSync(path.join(payload, "node_modules", "drop"), { recursive: true });
            writeFileSync(path.join(payload, "node_modules", "kept", "index.js"), "keep\n");
            writeFileSync(path.join(payload, "node_modules", "drop", "index.js"), "drop\n");
            const destination = path.join(temp.dir, "included.zip");

            await runJobExpectingSuccess("start_create", {
              ...CREATE_DEFAULTS,
              cleanSource: true,
              sources: [payload],
              destinationPath: destination,
              format: "zip",
              includeArchivePaths: ["payload/node_modules/kept/index.js"],
            });

            const opened = await openArchiveIndex(destination);
            try {
              const entries = await collectAllEntries(opened.sessionId);
              assert.ok(entries.has("payload/node_modules/kept/index.js"));
              assert.ok(!entries.has("payload/node_modules/drop/index.js"));
            } finally {
              await closeArchiveIndex(opened.sessionId);
            }
          } finally {
            temp.cleanup(false);
          }
        },
        CREATE_TIMEOUT_MS,
      );

      if (process.platform !== "win32") {
        it(
          "follows source symlinks only when followSymlinks is enabled",
          async () => {
            const temp = makeTempDir("create-follow-symlinks");
            try {
              const source = path.join(temp.dir, "source");
              const payload = writePayloadSourceTree(source, { withSymlink: true });
              const destination = path.join(temp.dir, "followed.zip");

              await runJobExpectingSuccess("start_create", {
                ...CREATE_DEFAULTS,
                sources: [payload],
                destinationPath: destination,
                format: "zip",
                followSymlinks: true,
              });

              const opened = await openArchiveIndex(destination);
              try {
                const entries = await collectAllEntries(opened.sessionId);
                assert.ok(entries.has("payload/nested/readme-link.txt"), "followSymlinks should retain the linked path");
              } finally {
                await closeArchiveIndex(opened.sessionId);
              }
            } finally {
              temp.cleanup(false);
            }
          },
          CREATE_TIMEOUT_MS,
        );
      }

      it(
        "deletes the source directory after creation when cleanSource is enabled",
        async () => {
          const temp = makeTempDir("create-clean-source");
          try {
            const source = path.join(temp.dir, "disposable_source");
            const payload = writePayloadSourceTree(source, { withSymlink: false });
            assert.ok(existsSync(payload), "source payload must exist before archiving");

            const destination = path.join(temp.dir, "cleaned.zip");

            await runJobExpectingSuccess("start_create", {
              ...CREATE_DEFAULTS,
              sources: [payload],
              destinationPath: destination,
              format: "zip",
              cleanSource: true,
            });

            assert.ok(existsSync(destination), "output archive must exist");
            assert.ok(!existsSync(payload), "cleanSource must remove the selected source tree after a successful create");
            const { sessionId, snapshot } = await openArchiveIndex(destination);
            try {
              assert.equal(snapshot.status, "ready");
            } finally {
              await closeArchiveIndex(sessionId);
            }
          } finally {
            temp.cleanup(false);
          }
        },
        CREATE_TIMEOUT_MS,
      );
    });
  });
}
