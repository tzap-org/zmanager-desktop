import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { closeArchiveIndex, collectAllEntries, openArchiveIndex, runJobExpectingSuccess, runJobToCompletion } from "./helpers/archiveCommands.ts";
import type { DiskEntry } from "./helpers/archiveFixtures.ts";
import {
  diffTrees,
  fixturePath,
  fixtureManifest,
  fixtureSupportedOnPlatform,
  hasFixtureCorpus,
  makeTempDir,
  missingCorpusReason,
  readTree,
  writePayloadSourceTree,
  symlinkFixturesSupported,
} from "./helpers/archiveFixtures.ts";

/**
 * Extracting and creating real archives through the running application.
 *
 * Where archive-open.spec.ts proves the app can read an archive's listing,
 * this proves the bytes actually land on disk correctly — the thing a user is
 * ultimately doing.
 */

const EXTRACT_TIMEOUT_MS = 120_000;
const ROUND_TRIP_TIMEOUT_MS = 180_000;

/** Defaults for the parts of StartExtractRequest these tests do not vary. */
const EXTRACT_DEFAULTS = {
  password: null,
  recipientKeyId: null,
  overwrite: "replace",
  destinationCollisionStrategy: "refuse",
  entryPaths: null,
  stripComponents: 0,
  tzapRestorePolicy: "content",
  tzapAllowDegraded: false,
  tzapAllowAbsoluteSymlinks: false,
  ignoreSymlinks: false,
} as const;

/** Defaults for the parts of StartCreateRequest these tests do not vary. */
const CREATE_DEFAULTS = {
  cleanSource: false,
  replaceExisting: true,
  preserveMetadata: true,
} as const;

/**
 * What a create format does with a symlink in the source tree, with
 * `followSymlinks` left unset (the request default).
 *
 * `"preserved"` writes it back as a symlink. `"dropped"` omits the entry
 * entirely. `"materialized"` writes the link target's contents as a regular
 * file. Each behavior is asserted explicitly rather than avoided.
 *
 * Every round trip puts a real symlink in its source tree and adjusts the
 * expectation to match. Omitting the symlink from the source instead — the
 * easier option — would mean a writer that changed its handling, in either
 * direction, would go unnoticed.
 */
type SymlinkHandling = "preserved" | "dropped" | "materialized";

/**
 * Formats that both write and read the shared payload tree, and what each does
 * with the symlink. TZAP preserves the source symlink on the Unix platforms
 * covered by the native GUI matrix.
 *
 * These values record measured behaviour, not intent. Notably the committed
 * `basic.7z` and `basic.tzap` fixtures carry the link as a regular *file*,
 * because the CLI that generated them followed it. The application create
 * path drops the 7z link but preserves the TZAP link. Deliberately covering
 * `followSymlinks: true` belongs with the rest of the create-option matrix.
 *
 * `appleArchive` is macOS-only and is added below at runtime rather than being
 * gated with a skip, so the list stays honest about what actually ran.
 */
type RoundTripFormat = {
  format: string;
  extension: string;
  symlinks: SymlinkHandling;
};

const ROUND_TRIP_FORMATS: ReadonlyArray<RoundTripFormat> = [
  {
    format: "zip",
    extension: "zip",
    symlinks: "preserved",
  },
  { format: "sevenZ", extension: "7z", symlinks: "dropped" },
  { format: "tzap", extension: "tzap", symlinks: "preserved" },
  { format: "tarGz", extension: "tar.gz", symlinks: "preserved" },
  { format: "tarZst", extension: "tar.zst", symlinks: "preserved" },
];

/**
 * Guards against a vacuous round trip.
 *
 * `diffTrees` reports no differences when both sides are empty, so a bug in
 * the source-tree builder or the tree reader would make every round trip pass
 * while proving nothing. Pinning the baseline makes that failure loud.
 */
function assertPayloadBaseline(tree: Map<string, DiskEntry>, requireSymlink = symlinkFixturesSupported()): void {
  for (const required of [
    "payload/README.txt",
    "payload/nested/file.txt",
    "payload/dir with spaces/file with spaces.txt",
    "payload/unicode/こんにちは.txt",
    "payload/nested/empty-dir",
  ]) {
    assert.ok(tree.has(required), `source baseline is missing ${required}; saw ${JSON.stringify([...tree.keys()])}`);
  }
  if (requireSymlink) {
    assert.ok(tree.has("payload/nested/readme-link.txt"), "source baseline should contain a real symlink");
    assert.equal(tree.get("payload/nested/readme-link.txt")?.kind, "symlink", "source baseline should contain a real symlink");
  }
}

/** Adjusts an expected tree for a writer that omits symlinks entirely. */
function withSymlinksDropped(tree: Map<string, DiskEntry>): Map<string, DiskEntry> {
  const adjusted = new Map(tree);
  let removed = 0;
  for (const [entryPath, entry] of tree) {
    if (entry.kind === "symlink") {
      adjusted.delete(entryPath);
      removed += 1;
    }
  }
  if (tree.size > 0 && symlinkFixturesSupported()) {
    assert.ok(removed > 0, "expected the source tree to contain a symlink to drop");
  }
  return adjusted;
}

/** Adjusts an expected tree for a writer that materializes symlinks. */
function withSymlinksMaterialized(tree: Map<string, DiskEntry>): Map<string, DiskEntry> {
  const adjusted = new Map(tree);
  let materialized = 0;
  for (const [entryPath, entry] of tree) {
    if (entry.kind !== "symlink") continue;

    assert.ok(entry.target, `symlink ${entryPath} should have a target`);
    const targetPath = path.posix.normalize(path.posix.join(path.posix.dirname(entryPath), entry.target));
    const target = tree.get(targetPath);
    assert.ok(target?.kind === "file", `symlink target ${targetPath} should be a regular file in the source tree`);
    adjusted.set(entryPath, { path: entryPath, kind: "file", contents: target.contents });
    materialized += 1;
  }
  if (tree.size > 0 && symlinkFixturesSupported()) {
    assert.ok(materialized > 0, "expected the source tree to contain a symlink to materialize");
  }
  return adjusted;
}

/** Builds the expected extracted tree for a format's symlink handling. */
function expectedTreeFor(sourceTree: Map<string, DiskEntry>, format: Pick<RoundTripFormat, "symlinks">): Map<string, DiskEntry> {
  switch (format.symlinks) {
    case "dropped":
      return withSymlinksDropped(sourceTree);
    case "materialized":
      return withSymlinksMaterialized(sourceTree);
    case "preserved":
      return sourceTree;
  }
}

function diffRoundTrip(expected: Map<string, DiskEntry>, extracted: Map<string, DiskEntry>): string[] {
  return diffTrees(expected, extracted);
}

if (!hasFixtureCorpus()) {
  describe("Archive extraction and creation in the native shell", () => {
    it(
      "extracts every supported corpus fixture and preserves its indexed shape",
      async () => {
        const failures: string[] = [];
        for (const fixture of fixtureManifest().filter(fixtureSupportedOnPlatform).filter((candidate) => candidate.extract)) {
          const temp = makeTempDir(`extract-${fixture.filename.replace(/[^a-zA-Z0-9]+/g, "-")}`);
          let sessionId: string | null = null;
          try {
            const opened = await openArchiveIndex(fixturePath(fixture.filename));
            sessionId = opened.sessionId;
            const listed = await collectAllEntries(sessionId);
            if (listed.size === 0) {
              throw new Error("index contained no entries");
            }
            await closeArchiveIndex(sessionId);
            sessionId = null;

            await runJobExpectingSuccess("start_extract", {
              ...EXTRACT_DEFAULTS,
              archivePath: fixturePath(fixture.filename),
              destinationPath: temp.dir,
            });
            const extracted = readTree(temp.dir);
            assert.ok(extracted.size > 0, `${fixture.filename} extracted no filesystem entries`);
            assertIndexedShapeExtracted(fixture.filename, listed, extracted);
            temp.cleanup(false);
          } catch (error) {
            failures.push(`${fixture.filename} (${fixture.format}): ${String(error)}`);
            temp.cleanup(true);
          } finally {
            if (sessionId) await closeArchiveIndex(sessionId).catch(() => undefined);
          }
        }
        assert.deepEqual(failures, [], `fixture extraction failures:\n  ${failures.join("\n  ")}`);
      },
      240_000,
    );

    it("requires the sibling fixture corpus", () => {
      pending(missingCorpusReason());
    });
  });
} else {
  describe("Archive extraction and creation in the native shell", () => {
    it(
      "extracts a fixture archive and writes the whole payload tree to disk",
      async () => {
        const temp = makeTempDir("extract-tar-gz");
        let failed = true;
        try {
          await runJobExpectingSuccess("start_extract", {
            ...EXTRACT_DEFAULTS,
            archivePath: fixturePath("basic.tar.gz"),
            destinationPath: temp.dir,
          });

          const extracted = readTree(temp.dir);
          const expected = new Map(
            [
              { path: "payload", kind: "directory" as const },
              { path: "payload/README.txt", kind: "file" as const, contents: "ZManager fixture payload\n" },
              { path: "payload/dir with spaces", kind: "directory" as const },
              { path: "payload/dir with spaces/file with spaces.txt", kind: "file" as const, contents: "spaces in path\n" },
              { path: "payload/nested", kind: "directory" as const },
              { path: "payload/nested/empty-dir", kind: "directory" as const },
              { path: "payload/nested/file.txt", kind: "file" as const, contents: "nested fixture file\n" },
              { path: "payload/nested/readme-link.txt", kind: "symlink" as const, target: "../README.txt" },
              { path: "payload/unicode", kind: "directory" as const },
              { path: "payload/unicode/こんにちは.txt", kind: "file" as const, contents: "unicode path fixture\n" },
            ]
              // Windows cannot materialise the link without elevation, so the
              // extractor legitimately omits it there.
              .filter((entry) => entry.kind !== "symlink" || symlinkFixturesSupported())
              .map((entry) => [entry.path, entry]),
          );

          const differences = diffTrees(expected, extracted);
          assert.deepEqual(differences, [], `extracted tree differs:\n  ${differences.join("\n  ")}`);
          failed = false;
        } finally {
          temp.cleanup(failed);
        }
      },
      EXTRACT_TIMEOUT_MS,
    );

    it(
      "extracts only the selected entries when given an entry subset",
      async () => {
        const temp = makeTempDir("extract-subset");
        let failed = true;
        try {
          await runJobExpectingSuccess("start_extract", {
            ...EXTRACT_DEFAULTS,
            archivePath: fixturePath("basic.tar.gz"),
            destinationPath: temp.dir,
            entryPaths: ["payload/README.txt", "payload/unicode/こんにちは.txt"],
          });

          const extracted = readTree(temp.dir);
          const files = [...extracted.values()].filter((entry) => entry.kind === "file").map((entry) => entry.path);
          assert.deepEqual(
            files.sort(),
            ["payload/README.txt", "payload/unicode/こんにちは.txt"],
            `partial extract wrote the wrong files: ${JSON.stringify([...extracted.keys()])}`,
          );
          failed = false;
        } finally {
          temp.cleanup(failed);
        }
      },
      EXTRACT_TIMEOUT_MS,
    );

    it(
      "drops the leading directory when stripComponents is set",
      async () => {
        const temp = makeTempDir("extract-strip");
        let failed = true;
        try {
          await runJobExpectingSuccess("start_extract", {
            ...EXTRACT_DEFAULTS,
            archivePath: fixturePath("basic.tar.gz"),
            destinationPath: temp.dir,
            stripComponents: 1,
          });

          const extracted = readTree(temp.dir);
          assert.ok(extracted.has("README.txt"), `stripComponents:1 should hoist payload/ contents to the root, saw ${JSON.stringify([...extracted.keys()])}`);
          assert.ok(!extracted.has("payload"), "stripComponents:1 should not leave the payload/ prefix");
          failed = false;
        } finally {
          temp.cleanup(failed);
        }
      },
      EXTRACT_TIMEOUT_MS,
    );

    it(
      "extracts an encrypted archive with the correct password",
      async () => {
        const temp = makeTempDir("extract-encrypted");
        let failed = true;
        try {
          await runJobExpectingSuccess("start_extract", {
            ...EXTRACT_DEFAULTS,
            archivePath: fixturePath("rar5-passworded-multipart.part1.rar"),
            destinationPath: temp.dir,
            password: "zmanager-rar-fixture-password",
          });

          const extracted = readTree(temp.dir);
          const files = [...extracted.values()].filter((entry) => entry.kind === "file");
          assert.ok(files.length > 0, "an encrypted multi-volume archive should extract its files");
          failed = false;
        } finally {
          temp.cleanup(failed);
        }
      },
      EXTRACT_TIMEOUT_MS,
    );

    it(
      "honors replace, refuse, and rename overwrite policies",
      async () => {
        const temp = makeTempDir("extract-overwrite-policies");
        try {
          const replaceDestination = path.join(temp.dir, "replace");
          const replaceTarget = path.join(replaceDestination, "payload", "README.txt");
          await runJobExpectingSuccess("start_extract", {
            ...EXTRACT_DEFAULTS,
            archivePath: fixturePath("basic.tar.gz"),
            destinationPath: replaceDestination,
          });
          writeFileSync(replaceTarget, "old contents\n");
          await runJobExpectingSuccess("start_extract", {
            ...EXTRACT_DEFAULTS,
            archivePath: fixturePath("basic.tar.gz"),
            destinationPath: replaceDestination,
            overwrite: "replace",
          });
          assert.equal(readTree(replaceDestination).get("payload/README.txt")?.contents, "ZManager fixture payload\n");

          const refuseDestination = path.join(temp.dir, "refuse");
          const refuseTarget = path.join(refuseDestination, "payload", "README.txt");
          mkdirForFile(refuseTarget);
          writeFileSync(refuseTarget, "must survive\n");
          const refused = await runJobToCompletion("start_extract", {
            ...EXTRACT_DEFAULTS,
            archivePath: fixturePath("basic.tar.gz"),
            destinationPath: refuseDestination,
            overwrite: "refuse",
          });
          // Refuse is a safety failure, not a successful no-op.  The job must
          // leave the pre-existing destination untouched and surface the
          // collision through its terminal status.
          assert.equal(refused.status, "failed");
          assert.equal(readTree(refuseDestination).get("payload/README.txt")?.contents, "must survive\n");

          const renameDestination = path.join(temp.dir, "rename");
          const renameTarget = path.join(renameDestination, "payload", "README.txt");
          mkdirForFile(renameTarget);
          writeFileSync(renameTarget, "must survive\n");
          await runJobExpectingSuccess("start_extract", {
            ...EXTRACT_DEFAULTS,
            archivePath: fixturePath("basic.tar.gz"),
            destinationPath: renameDestination,
            overwrite: "rename",
          });
          const renamedFiles = [...readTree(renameDestination).values()]
            .filter((entry) => entry.kind === "file" && entry.contents === "ZManager fixture payload\n");
          assert.equal(readTree(renameDestination).get("payload/README.txt")?.contents, "must survive\n");
          assert.equal(renamedFiles.length, 1, "rename must preserve the original and create one renamed archive member");
        } finally {
          temp.cleanup(false);
        }
      },
      EXTRACT_TIMEOUT_MS * 2,
    );

    describe("round trips", () => {
      const formats = [...ROUND_TRIP_FORMATS];
      if (process.platform === "darwin") {
        formats.push({ format: "appleArchive", extension: "aar", symlinks: "preserved" });
      }

      for (const roundTrip of formats) {
        const { format, extension } = roundTrip;
        it(
          `creates and reads back a ${format} archive without losing the payload tree`,
          async () => {
            const temp = makeTempDir(`round-trip-${format}`);
            let failed = true;
            try {
              const source = path.join(temp.dir, "source");
              const payload = writePayloadSourceTree(source, { withSymlink: symlinkFixturesSupported() });
              const sourceTree = readTree(source);
              // A tree comparison passes vacuously if both sides are empty, so
              // pin the baseline before relying on it.
              assertPayloadBaseline(sourceTree);
              const expected = expectedTreeFor(sourceTree, roundTrip);
              const destination = path.join(temp.dir, `archive.${extension}`);

              await runJobExpectingSuccess("start_create", {
                ...CREATE_DEFAULTS,
                sources: [payload],
                destinationPath: destination,
                format,
              });

              // Reading the archive back proves it is a real archive of the
              // right format, not merely a file that was written.
              const { sessionId, snapshot } = await openArchiveIndex(destination);
              try {
                assert.equal(snapshot.latestFailure, null, `created ${format} archive failed to open: ${snapshot.latestFailure?.message ?? ""}`);
                const listed = await collectAllEntries(sessionId);
                assert.ok(listed.has("payload/README.txt"), `created ${format} archive should list its members, saw ${JSON.stringify([...listed.keys()])}`);
              } finally {
                await closeArchiveIndex(sessionId);
              }

              const extractedInto = path.join(temp.dir, "extracted");
              await runJobExpectingSuccess("start_extract", {
                ...EXTRACT_DEFAULTS,
                archivePath: destination,
                destinationPath: extractedInto,
              });

              const differences = diffRoundTrip(expected, readTree(extractedInto));
              assert.deepEqual(differences, [], `${format} round trip lost data:\n  ${differences.join("\n  ")}`);
              failed = false;
            } finally {
              temp.cleanup(failed);
            }
          },
          ROUND_TRIP_TIMEOUT_MS,
        );

      }

      it(
        "round trips a password-protected archive",
        async () => {
          const temp = makeTempDir("round-trip-password");
          let failed = true;
          try {
            const source = path.join(temp.dir, "source");
              const payload = writePayloadSourceTree(source, { withSymlink: symlinkFixturesSupported() });
            const sourceTree = readTree(source);
            assertPayloadBaseline(sourceTree);
            // Uses the same ZIP handling as the plain ZIP round trip above.
            const zipFormat = ROUND_TRIP_FORMATS.find((candidate) => candidate.format === "zip") as RoundTripFormat;
            const expected = expectedTreeFor(sourceTree, zipFormat);
            const destination = path.join(temp.dir, "secret.zip");
            const password = "round-trip-password";

            await runJobExpectingSuccess("start_create", {
              ...CREATE_DEFAULTS,
              sources: [payload],
              destinationPath: destination,
              format: "zip",
              password,
            });

            const extractedInto = path.join(temp.dir, "extracted");
            await runJobExpectingSuccess("start_extract", {
              ...EXTRACT_DEFAULTS,
              archivePath: destination,
              destinationPath: extractedInto,
              password,
            });

            const differences = diffRoundTrip(expected, readTree(extractedInto));
            assert.deepEqual(differences, [], `encrypted round trip lost data:\n  ${differences.join("\n  ")}`);
            failed = false;
          } finally {
            temp.cleanup(failed);
          }
        },
        ROUND_TRIP_TIMEOUT_MS,
      );
    });
  });
}

function assertIndexedShapeExtracted(
  label: string,
  indexed: Map<string, { path: string; kind: string }>,
  extracted: Map<string, DiskEntry>,
): void {
  const problems: string[] = [];
  for (const [entryPath, entry] of indexed) {
    if (entryPath.startsWith("/") || entryPath.split("/").includes("..")) {
      problems.push(`${entryPath}: unsafe indexed path`);
      continue;
    }
    // A symlink-bearing archive is not portable to Windows without developer
    // mode. The Unix run asserts the exact link kind; Windows still asserts
    // that the member is not silently written outside the destination.
    if (entry.kind === "symlink" && !symlinkFixturesSupported()) continue;
    const actual = extracted.get(entryPath);
    if (!actual) {
      problems.push(`missing extracted ${entryPath}`);
      continue;
    }
    if (entry.kind === "directory" && actual.kind !== "directory") {
      problems.push(`${entryPath}: extracted as ${actual.kind}, expected directory`);
    }
    if (entry.kind === "symlink" && actual.kind !== "symlink") {
      problems.push(`${entryPath}: extracted as ${actual.kind}, expected symlink`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`${label}: indexed/extracted shape mismatch:\n  ${problems.join("\n  ")}`);
  }
}

function mkdirForFile(filePath: string): void {
  const directory = path.dirname(filePath);
  if (!existsSync(directory)) {
    // The parent is intentionally created through the same filesystem path
    // used by the extraction request, so collision behavior is not masked.
    mkdirSync(directory, { recursive: true });
  }
}
