import assert from "node:assert/strict";
import { chmodSync, copyFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  assertEntriesAreExactly,
  assertEntriesPresent,
  assertArchiveIndexTotals,
  closeArchiveIndex,
  collectAllEntries,
  detectArchiveFormat,
  getArchiveChildren,
  invokeExpectingError,
  invokeOk,
  openArchiveIndex,
} from "./helpers/archiveCommands.ts";
import {
  fixtureManifest,
  fixturePath,
  assertFixtureIntegrity,
  fixtureSupportedOnPlatform,
  hasFixtureCorpus,
  makeTempDir,
  missingCorpusReason,
  payloadTree,
} from "./helpers/archiveFixtures.ts";

/**
 * Opening and listing real archives through the running application.
 *
 * Until this spec existed, no automated test opened an archive in the real
 * app: the archive engine is covered in the zmanager repository and the window
 * is covered by the other native specs, but the seam between them — the whole
 * product — was verified by hand.
 */

/** Generous per-spec budgets: CI runners are far slower than dev machines. */
const CORPUS_SWEEP_TIMEOUT_MS = 180_000;
const MULTI_ARCHIVE_TIMEOUT_MS = 120_000;
const SINGLE_ARCHIVE_TIMEOUT_MS = 60_000;

/**
 * Formats carrying the complete shared payload tree, with the kind each is
 * expected to report for the symlink member. Held to an exact listing so a
 * regression that drops the empty directory, the spaces-in-name file, or the
 * Unicode file fails rather than surviving a subset check.
 */
const FULL_PAYLOAD_TREE_FIXTURES: ReadonlyArray<{ filename: string; symlinkKind: "file" | "symlink" }> = [
  // The ZIP, 7z and TZAP v1 writers materialize the symlink as a regular file.
  { filename: "basic.zip", symlinkKind: "file" },
  { filename: "basic.7z", symlinkKind: "file" },
  { filename: "basic.tzap", symlinkKind: "file" },
  // TAR-family and CPIO preserve it.
  { filename: "basic.tar", symlinkKind: "symlink" },
  { filename: "basic.tar.gz", symlinkKind: "symlink" },
  { filename: "basic.tar.xz", symlinkKind: "symlink" },
  { filename: "basic.tar.zst", symlinkKind: "symlink" },
  { filename: "basic.cpio", symlinkKind: "symlink" },
];

if (!hasFixtureCorpus()) {
  // Pending, never silently green: a run that skipped every archive assertion
  // must be visible as such in the report.
  describe("Archive opening and listing in the native shell", () => {
    it("requires the sibling fixture corpus", () => {
      pending(missingCorpusReason());
    });
  });
} else {
  describe("Archive opening and listing in the native shell", () => {
    it(
      "opens and indexes every fixture in the corpus",
      async () => {
        const failures: string[] = [];
        for (const fixture of fixtureManifest().filter(fixtureSupportedOnPlatform)) {
          const archivePath = fixturePath(fixture.filename);
          let session: string | null = null;
          try {
            assertFixtureIntegrity(fixture);
            const { sessionId, snapshot } = await openArchiveIndex(archivePath);
            session = sessionId;
            if (snapshot.status !== "ready" && snapshot.status !== "empty") {
              failures.push(`${fixture.filename} (${fixture.format}) reached status ${snapshot.status}: ${snapshot.latestFailure?.code ?? "no failure recorded"}`);
            } else {
              const detected = await detectArchiveFormat(archivePath);
              const expected = manifestFormatToDto(fixture.format);
              if (detected !== expected || snapshot.format !== expected) {
                failures.push(`${fixture.filename}: detected=${detected}, snapshot=${snapshot.format ?? "missing"}, expected=${expected}`);
              }
              const entries = await collectAllEntries(sessionId);
              assertArchiveIndexTotals(fixture.filename, snapshot, entries);
            }
          } catch (error) {
            failures.push(`${fixture.filename} (${fixture.format}) threw: ${String(error)}`);
          } finally {
            if (session) {
              await closeArchiveIndex(session);
            }
          }
        }

        assert.deepEqual(failures, [], `fixtures failed to index:\n  ${failures.join("\n  ")}`);
      },
      CORPUS_SWEEP_TIMEOUT_MS,
    );

    it(
      "detects one format across every spelling of its extension",
      async () => {
        const mismatches: string[] = [];
        for (const fixture of fixtureManifest().filter(fixtureSupportedOnPlatform)) {
          assertFixtureIntegrity(fixture);
          const detected = await detectArchiveFormat(fixturePath(fixture.filename));
          const expected = manifestFormatToDto(fixture.format);
          if (detected !== expected) {
            mismatches.push(`${fixture.filename} detected as ${detected}, expected ${expected}`);
          }
        }

        assert.deepEqual(mismatches, [], `format detection mismatches:\n  ${mismatches.join("\n  ")}`);
      },
      MULTI_ARCHIVE_TIMEOUT_MS,
    );

    it(
      "lists the whole payload tree for formats that carry it",
      async () => {
        for (const { filename, symlinkKind } of FULL_PAYLOAD_TREE_FIXTURES) {
          const { sessionId, snapshot } = await openArchiveIndex(fixturePath(filename));
          try {
            assertOpenedSuccessfully(filename, snapshot);
            const entries = await collectAllEntries(sessionId);
            assertEntriesAreExactly(filename, entries, payloadTree(symlinkKind));
          } finally {
            await closeArchiveIndex(sessionId);
          }
        }
      },
      MULTI_ARCHIVE_TIMEOUT_MS,
    );

    it(
      "preserves Unicode, spaces, and nesting when paging children",
      async () => {
        const { sessionId, snapshot } = await openArchiveIndex(fixturePath("basic.tar.gz"));
        try {
          assert.equal(snapshot.status, "ready");

          // A page smaller than the child count exercises the cursor path the
          // GUI uses for large archives.
          const firstPage = await getArchiveChildren(sessionId, "payload", { limit: 2 });
          assert.ok(firstPage.entries.length <= 2, "limit must bound the page size");
          assert.ok(firstPage.childCount >= 4, `expected several children under payload, saw ${firstPage.childCount}`);
          assert.deepEqual(
            firstPage.entries.map((entry) => entry.path),
            [...firstPage.entries].map((entry) => entry.path).sort((left, right) => left.localeCompare(right)),
            "children must be naturally ordered by name",
          );

          const paged = new Map(firstPage.entries.map((entry) => [entry.path, entry]));
          let cursor = firstPage.nextCursor ?? undefined;
          while (cursor) {
            const page = await getArchiveChildren(sessionId, "payload", { cursor, limit: 2 });
            for (const entry of page.entries) {
              paged.set(entry.path, entry);
            }
            cursor = page.nextCursor ?? undefined;
          }

          if (firstPage.nextCursor) {
            const wrongParent = await invokeExpectingError("get_archive_children", {
              request: { sessionId, parentPath: "payload/nested", cursor: firstPage.nextCursor, limit: 2 },
            });
            assert.equal(wrongParent.code, "invalid_request", "a cursor must be scoped to its parent");

            const second = await openArchiveIndex(fixturePath("basic.tar.gz"));
            try {
              const wrongRevision = await invokeExpectingError("get_archive_children", {
                request: { sessionId: second.sessionId, parentPath: "payload", cursor: firstPage.nextCursor, limit: 2 },
              });
              assert.equal(wrongRevision.code, "invalid_request", "a cursor must be scoped to its session/revision");
            } finally {
              await closeArchiveIndex(second.sessionId);
            }
          }

          assertEntriesPresent("basic.tar.gz paged children", paged, [
            { path: "payload/README.txt", kind: "file" },
            { path: "payload/nested", kind: "directory" },
            { path: "payload/dir with spaces", kind: "directory" },
            { path: "payload/unicode", kind: "directory" },
          ]);

          const allEntries = await collectAllEntries(sessionId);
          assertEntriesPresent("basic.tar.gz unicode member", allEntries, [{ path: "payload/unicode/こんにちは.txt", kind: "file" }]);
        } finally {
          await closeArchiveIndex(sessionId);
        }
      },
      SINGLE_ARCHIVE_TIMEOUT_MS,
    );

      it(
        "surfaces the spanning file when opening a multi-volume RAR set",
      async () => {
        const { sessionId, snapshot } = await openArchiveIndex(fixturePath("rar5-multipart.part1.rar"));
        try {
          assert.equal(snapshot.status, "ready", "a multi-volume set must index from its first volume");
          const entries = await collectAllEntries(sessionId);
          const spanning = [...entries.values()].filter((entry) => entry.kind === "file" && (entry.size ?? 0) >= 192 * 1024);
          assert.ok(spanning.length > 0, `expected a file spanning volumes, saw ${JSON.stringify([...entries.keys()])}`);
        } finally {
          await closeArchiveIndex(sessionId);
        }
      },
      SINGLE_ARCHIVE_TIMEOUT_MS,
    );

    it(
      "previews a passworded RAR through the already-open archive session",
      async () => {
        const archivePath = fixturePath("rar5-passworded-multipart.part1.rar");
        const { sessionId, snapshot } = await openArchiveIndex(archivePath, {
          password: "zmanager-rar-fixture-password",
        });
        try {
          assert.equal(snapshot.status, "ready");
          const preview = await invokeOk<{ previewPath: string }>("preview_entry", {
            request: {
              archivePath,
              entryPath: "rar-fixture/docs/readme.txt",
              overwrite: "replace",
              stripComponents: 1,
            },
          });
          assert.match(preview.previewPath.replaceAll("\\", "/"), /\/readme\.txt$/);
        } finally {
          await invokeOk("cleanup_preview_roots");
          await closeArchiveIndex(sessionId);
        }
      },
      SINGLE_ARCHIVE_TIMEOUT_MS,
    );

    it(
      "previews an unencrypted archive entry through the already-open archive session",
      async () => {
        const archivePath = fixturePath("basic.zip");
        const { sessionId, snapshot } = await openArchiveIndex(archivePath);
        try {
          assert.equal(snapshot.status, "ready");
          const preview = await invokeOk<{ previewPath: string }>("preview_entry", {
            request: {
              archivePath,
              entryPath: "payload/README.txt",
              overwrite: "replace",
              stripComponents: 1,
            },
          });
          assert.match(preview.previewPath.replaceAll("\\", "/"), /\/README\.txt$/);
        } finally {
          await invokeOk("cleanup_preview_roots");
          await closeArchiveIndex(sessionId);
        }
      },
      SINGLE_ARCHIVE_TIMEOUT_MS,
    );

    describe("failure paths", () => {
      it(
        "reports a distinct code for each way opening can fail",
        async () => {
          // Synchronous request rejection, before any filesystem access.
          const empty = await invokeExpectingError("start_archive_index", { request: { archivePath: "", password: null } });
          assert.equal(empty.code, "invalid_request", `empty path: ${empty.message}`);

          const missing = await openExpectingFailure(fixturePath("definitely-not-here.zip"));
          assert.equal(missing.code, "not_found", `missing archive: ${missing.message}`);

          // A real file that is not an archive: the corpus README is plain text.
          const notAnArchive = await openExpectingFailure(fixturePath("README.md"));
          assert.equal(notAnArchive.code, "unsupported_format", `non-archive should be rejected as unsupported, got ${notAnArchive.code}: ${notAnArchive.message}`);

          // A directory passed where an archive file is expected.
          const temp = makeTempDir("dir-as-archive");
          try {
            const dirOutcome = await openExpectingFailure(temp.dir);
            assert.ok(
              ["io_error", "invalid_request", "unsupported_format", "operation_failed"].includes(dirOutcome.code),
              `directory passed as archive should be rejected, got ${dirOutcome.code}: ${dirOutcome.message}`,
            );
          } finally {
            temp.cleanup(false);
          }
        },
        SINGLE_ARCHIVE_TIMEOUT_MS,
      );

      it(
        "fails a multi-volume RAR set when a middle volume is missing",
        async () => {
          const temp = makeTempDir("rar-missing-volume");
          try {
            for (const part of [1, 2, 3, 4]) {
              const source = fixturePath(`rar5-multipart.part${part}.rar`);
              const target = path.join(temp.dir, `rar5-multipart.part${part}.rar`);
              copyFileSync(source, target);
            }
            unlinkSync(path.join(temp.dir, "rar5-multipart.part2.rar"));
            const outcome = await openExpectingFailure(path.join(temp.dir, "rar5-multipart.part1.rar"));
            assert.ok(
              ["io_error", "operation_failed", "not_found"].includes(outcome.code),
              `missing RAR volume should fail with a storage/archive error, got ${outcome.code}: ${outcome.message}`,
            );
          } finally {
            temp.cleanup(false);
          }
        },
        SINGLE_ARCHIVE_TIMEOUT_MS,
      );

      it(
        "reports an error when opening a truncated or header-corrupted archive",
        async () => {
          const temp = makeTempDir("corrupt-archive");
          try {
            const corruptZip = path.join(temp.dir, "corrupt.zip");
            // Write invalid/truncated bytes
            writeFileSync(corruptZip, Buffer.from("PK\x03\x04corrupted_header_data_garbage"));
            const outcome = await openExpectingFailure(corruptZip);
            assert.equal(outcome.code, "operation_failed", `corrupt archive should fail indexing, got ${outcome.code}: ${outcome.message}`);
          } finally {
            temp.cleanup(false);
          }
        },
        SINGLE_ARCHIVE_TIMEOUT_MS,
      );

      if (process.platform !== "win32") {
        it(
          "reports io_error when opening a file with unreadable permissions",
          async () => {
            const temp = makeTempDir("unreadable-archive");
            const unreadable = path.join(temp.dir, "unreadable.tar.gz");
            copyFileSync(fixturePath("basic.tar.gz"), unreadable);
            chmodSync(unreadable, 0o000);
            try {
              const outcome = await openExpectingFailure(unreadable);
              assert.equal(outcome.code, "io_error", `unreadable file should report io_error, got ${outcome.code}: ${outcome.message}`);
            } finally {
              chmodSync(unreadable, 0o644);
              temp.cleanup(false);
            }
          },
          SINGLE_ARCHIVE_TIMEOUT_MS,
        );
      }


      it(
        "requires the correct password for an encrypted archive",
        async () => {
          const encrypted = fixturePath("rar5-passworded-multipart.part1.rar");

          const withoutPassword = await openExpectingFailure(encrypted);
          assert.ok(
            ["password_required", "invalid_password"].includes(withoutPassword.code),
            `opening without a password should demand one, got ${withoutPassword.code}: ${withoutPassword.message}`,
          );

          const attempted = "definitely-the-wrong-password";
          const wrongPassword = await openExpectingFailure(encrypted, attempted);
          assert.ok(
            ["invalid_password", "password_required"].includes(wrongPassword.code),
            `a wrong password should be rejected, got ${wrongPassword.code}: ${wrongPassword.message}`,
          );

          // The attempted password must never reach diagnostics the app surfaces.
          const surfaced = `${wrongPassword.message} ${wrongPassword.hint ?? ""}`;
          assert.ok(!surfaced.includes(attempted), `the attempted password leaked into diagnostics: ${surfaced}`);

          const { sessionId, snapshot } = await openArchiveIndex(encrypted, { password: "zmanager-rar-fixture-password" });
          try {
            assert.equal(snapshot.status, "ready", `the documented fixture password should open the archive: ${snapshot.latestFailure?.message ?? ""}`);
          } finally {
            await closeArchiveIndex(sessionId);
          }
        },
        SINGLE_ARCHIVE_TIMEOUT_MS,
      );
    });
  });
}

/**
 * Asserts an archive opened successfully, accepting either terminal status.
 *
 * `ready` and `empty` both mean "opened without error". Formats that support
 * on-demand directory listing (TZAP among them) deliberately finish indexing
 * with zero discovered entries and serve children lazily instead — see the
 * `supports_on_demand_directories` branch in `src-tauri/src/archive_index.rs`.
 * For those, `empty` is the expected status even for a populated archive, and
 * the real proof of content is what `get_archive_children` returns.
 */
function assertOpenedSuccessfully(label: string, snapshot: { status: string; latestFailure: { code: string; message: string } | null }): void {
  assert.ok(
    snapshot.status === "ready" || snapshot.status === "empty",
    `${label} should open successfully, got status ${snapshot.status}: ${snapshot.latestFailure?.message ?? "no failure recorded"}`,
  );
  assert.equal(snapshot.latestFailure, null, `${label} opened but recorded a failure: ${snapshot.latestFailure?.message ?? ""}`);
}

/**
 * Opens an archive expecting it to fail, returning the recorded error.
 *
 * Opening reports failure two ways: `start_archive_index` can reject the
 * request outright, or indexing can fail afterwards and record the cause in
 * the snapshot's `latestFailure`. Both are genuine open failures, so this
 * normalizes them into one error shape.
 */
async function openExpectingFailure(archivePath: string, password?: string): Promise<{ code: string; message: string; hint: string | null }> {
  let sessionId: string | null = null;
  try {
    const opened = await openArchiveIndex(archivePath, { password });
    sessionId = opened.sessionId;
    assert.notEqual(opened.snapshot.status, "ready", `expected opening ${archivePath} to fail, but it indexed successfully`);
    assert.ok(opened.snapshot.latestFailure, `expected a recorded failure for ${archivePath}, snapshot: ${JSON.stringify(opened.snapshot)}`);
    return opened.snapshot.latestFailure;
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error) {
      return error as { code: string; message: string; hint: string | null };
    }
    // `invokeOk` reports command errors as an Error whose message carries the code.
    const message = String(error);
    const match = /failed unexpectedly: (\w+) —/.exec(message);
    if (match) {
      return { code: match[1], message, hint: null };
    }
    throw error;
  } finally {
    if (sessionId) {
      await closeArchiveIndex(sessionId);
    }
  }
}

function manifestFormatToDto(format: string): string {
  const normalized = format.toUpperCase();
  const mapping: Record<string, string> = {
    ZIP: "zip",
    "7Z": "sevenZ",
    RAR: "rar",
    TAR: "tar",
    "TAR.GZ": "tarGz",
    "TAR.BZ2": "tarBz2",
    "TAR.XZ": "tarXz",
    "TAR.LZMA": "tarLzma",
    "TAR.LZ": "tarLz",
    "TAR.LZO": "tarLzo",
    "TAR.Z": "tarCompress",
    "TAR.LZ4": "tarLz4",
    "TAR.ZST": "tarZst",
    CPIO: "cpio",
    CAB: "cab",
    LHA: "lha",
    RPM: "rpm",
    XAR: "xar",
    WARC: "warc",
    ISO: "iso",
    DEB: "deb",
    AR: "ar",
    DMG: "dmg",
    PKG: "pkg",
    MSI: "msi",
    VHD: "vhd",
    VMDK: "vmdk",
    UDF: "udf",
    SQUASHFS: "squashfs",
    APPIMAGE: "appImage",
    WIM: "wim",
    VDI: "vdi",
    NRG: "nrg",
    MDF: "mdf",
    ISZ: "isz",
    CCD: "ccd",
    CUE: "cue",
    CDI: "cdi",
    VHDX: "vhdx",
    QCOW2: "qcow2",
    EWF: "ewf",
    AD1: "ad1",
    DAR: "dar",
    AFF4: "aff4",
    RAWDISK: "rawDisk",
    MTREE: "mtree",
    TZAP: "tzap",
    AAR: "appleArchive",
    RAW: "rawStream",
    "TAR.UU": "tarUu",
    "TAR.B64": "tarUu",
  };
  const result = mapping[normalized];
  if (!result) throw new Error(`no DTO mapping for fixture format ${format}`);
  return result;
}
