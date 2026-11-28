import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { DesktopJobSnapshotDto, JobCatalogEnvelopeDto } from "../../src/api/types.ts";
import { closeTaskWindow, runJobExpectingSuccess } from "./helpers/archiveCommands.ts";
import { makeTempDir } from "./helpers/archiveFixtures.ts";

/**
 * Tier A DOM-driven GUI journeys in the native desktop shell.
 *
 * Drives user interactions against real UI components, verifying mode
 * switching, format capability control presentation in Compress mode, and
 * Extract workspace controls.
 */

describe("Tier A GUI archive journeys", () => {
  it("switches cleanly between Compress and Extract workspace modes", async () => {
    const compressTab = await $("#mode-compress");
    const extractTab = await $("#mode-extract");

    await compressTab.waitForExist();
    await extractTab.waitForExist();

    // Switch to Extract mode
    await extractTab.click();
    assert.equal(await extractTab.getAttribute("aria-selected"), "true");
    assert.equal(await compressTab.getAttribute("aria-selected"), "false");
    assert.ok(await $("main[data-mode='extract']").isExisting());

    // Switch to Compress mode
    await compressTab.click();
    assert.equal(await compressTab.getAttribute("aria-selected"), "true");
    assert.equal(await extractTab.getAttribute("aria-selected"), "false");
    assert.ok(await $("main[data-mode='compress']").isExisting());
  });

  it("renders format selector and options in Compress mode", async () => {
    const compressTab = await $("#mode-compress");
    await compressTab.click();

    // Verify format dropdown trigger exists
    const formatTrigger = await $("#create-format");
    await formatTrigger.waitForExist();
    assert.ok(await formatTrigger.isDisplayed());

    // Verify compression level control exists
    const levelControl = await $("#create-compression-level");
    assert.ok(await levelControl.isExisting());

    // Verify clean source and gitignore checkboxes exist
    assert.ok(await $("#create-clean-source").isExisting());
    assert.ok(await $("#create-respect-gitignore").isExisting());
  });

  it("renders Extract workspace table, navigation, and details pane", async () => {
    const extractTab = await $("#mode-extract");
    await extractTab.click();

    // Empty state or entry table
    const emptyState = await $("#archive-empty-state");
    const entryTable = await $("#entry-table");
    assert.ok((await emptyState.isExisting()) || (await entryTable.isExisting()));

    // Search and navigation controls
    assert.ok(await $("#search-entries").isExisting());
    assert.ok(await $("#tree-content").isExisting());

    // Details / Options pane
    assert.ok(await $("#extract-path-mode").isExisting());
    assert.ok(await $("#extract-overwrite").isExisting());
  });

  for (const [title, action, destinationIsFile] of [
    ["Extract All with Rename preserves the existing file at the destination", "extractAll", true],
    ["Extract All with Rename preserves the existing file inside the destination", "extractAll", false],
    ["file-manager Extract to Folder uses saved Rename when a file blocks the destination", "extractToFolder", true],
  ] as const) {
    it(title, async () => {
      const temp = makeTempDir("extract-all-rename");
      const fixtureDir = process.env.ZMANAGER_GUI_EXTRACT_FIXTURE_DIR;
      const name = fixtureDir ? "IMG_4367.PNG" : "image.png";
      const sourceDir = join(temp.dir, "source");
      const source = join(sourceDir, name);
      const archive = join(temp.dir, `${name}.tzap`);
      const destination = join(temp.dir, name);
      const existingFile = destinationIsFile ? destination : join(destination, name);
      const output = destinationIsFile ? `${destination} 2` : destination;
      const extractedFile = join(output, destinationIsFile ? name : name.replace(/(\.[^.]+)$/u, " 2$1"));
      mkdirSync(sourceDir);
      if (fixtureDir) {
        copyFileSync(join(fixtureDir, name), source);
        copyFileSync(join(fixtureDir, `${name}.tzap`), archive);
      } else {
        writeFileSync(source, "archive payload");
      }
      if (!destinationIsFile) mkdirSync(destination);
      const original = Buffer.from("existing file");
      writeFileSync(existingFile, original);

      let passed = false;
      let jobId: string | undefined;
      let previousOverwrite: string | undefined;
      try {
        if (!fixtureDir) {
          await runJobExpectingSuccess("start_create", {
            sources: [source], destinationPath: archive, format: "tzap",
          });
        }
        if (action === "extractAll") {
          await browser.tauri.execute(async ({ core }, archivePath: string) => {
            await core.invoke("plugin:event|emit", { event: "zmanager-native-inbound-event", payload: {
              version: 1, eventId: `open-${archivePath}`, kind: "openPaths", timestampUnixMs: Date.now(),
              payload: { paths: [archivePath] },
            } });
          }, archive);
          await $(`[data-entry-path="${name}"]`).waitForDisplayed();
          await browser.waitUntil(async () => (await $("#extract-destination-bar").getValue()) === destination);
          await $("#extract-overwrite").click();
          await $('[role="option"]=Rename').click();
        } else {
          const overwrite = await openOverwritePreference();
          previousOverwrite = await overwrite.getText();
          await overwrite.click();
          await $('[role="option"]=Rename').click();
          await $("#preferences-save").click();
        }

        const job = await runGuiExtraction(action, archive);
        jobId = job.jobId;
        assert.equal(job.status, "completed", job.latestFailure?.message);
        assert.equal(job.outputArtifacts[0]?.path, output);
        assert.deepEqual(readFileSync(existingFile), original);
        assert.deepEqual(readFileSync(extractedFile), readFileSync(source));
        if (fixtureDir) console.log(`${title}: verified bytes in ${extractedFile}`);
        passed = true;
      } finally {
        if (jobId) await closeTaskWindow(`task-${jobId}`);
        if (previousOverwrite && previousOverwrite !== "Rename") {
          await (await openOverwritePreference()).click();
          await $(`[role="option"]=${previousOverwrite}`).click();
          await $("#preferences-save").click();
        }
        const closeArchive = await $("#close-archive");
        if (await closeArchive.isEnabled()) await closeArchive.click();
        temp.cleanup(!passed || fixtureDir !== undefined);
      }
    });
  }
});

async function openOverwritePreference() {
  await $('[data-menu-group-label="Tools"]').click();
  await $("#menu-command-options").click();
  await $('[data-pref-page-target="extraction"]').click();
  return $("#pref-extract-overwrite");
}

async function runGuiExtraction(action: "extractAll" | "extractToFolder", archive: string): Promise<DesktopJobSnapshotDto> {
  return (await browser.tauri.execute(async ({ core }, action: string, archivePath: string) => {
    const tauriCore = (globalThis as unknown as { __TAURI__: { core: { Channel: new () => { onmessage: (message: JobCatalogEnvelopeDto) => void } } } }).__TAURI__.core;
    const channel = new tauriCore.Channel();
    const initialJobIds = new Set<string>();
    let resolveInitial: () => void = () => undefined;
    let resolveTerminal: (jobId: string) => void = () => undefined;
    const initial = new Promise<void>((resolve) => { resolveInitial = resolve; });
    const terminal = new Promise<string>((resolve) => { resolveTerminal = resolve; });
    let hasInitialSnapshot = false;
    channel.onmessage = ({ subscriptionId, revision, payload }) => {
      void core.invoke("ack_subscription", { request: { subscriptionId, revision } });
      if (!hasInitialSnapshot) {
        for (const job of payload.jobs) initialJobIds.add(job.jobId);
        hasInitialSnapshot = true;
        resolveInitial();
        return;
      }
      const extract = payload.jobs.find((job) => job.kind === "tzapExtract" && job.terminal && !initialJobIds.has(job.jobId));
      if (extract) resolveTerminal(extract.jobId);
    };
    const subscriptionId = await core.invoke("subscribe_job_catalog", { onSnapshot: channel });
    let timeout = 0;
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = window.setTimeout(() => reject(new Error(`${action} did not produce a terminal TZAP job`)), 10_000);
    });
    try {
      await Promise.race([initial, deadline]);
      if (action === "extractAll") {
        const button = document.querySelector<HTMLButtonElement>("#extract-all");
        if (!button || button.disabled) throw new Error("Extract All is unavailable");
        button.click();
      } else {
        await core.invoke("plugin:event|emit", { event: "zmanager-native-inbound-event", payload: {
          version: 1, eventId: `quick-${archivePath}`, kind: "shellActionRequest", timestampUnixMs: Date.now(),
          payload: { request: { kind: action, paths: [archivePath] } },
        } });
      }
      const jobId = await Promise.race([terminal, deadline]);
      return await core.invoke("get_job_snapshot", { request: { jobId } });
    } finally {
      window.clearTimeout(timeout);
      await core.invoke("unsubscribe_job", { request: { subscriptionId } });
    }
  }, action, archive)) as DesktopJobSnapshotDto;
}
