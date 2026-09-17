import { expect, test, type Page } from "@playwright/test";

type ArchiveEntryKind = "file" | "directory" | "symlink" | "hardlink" | "special";

type ArchiveEntryFixture = {
  path: string;
  kind: ArchiveEntryKind;
  size?: number;
  compressedSize?: number;
  modified?: string;
};

type ArchiveFixture = {
  archivePath: string;
  entries: ArchiveEntryFixture[];
  entryCount: number;
  totalSize: number;
};

type IpcCall = {
  cmd: string;
  args: Record<string, unknown>;
};


const archiveFixture: ArchiveFixture = {
  archivePath: "C:/fixtures/drag-proof.zip",
  entryCount: 3,
  totalSize: 61,
  entries: [
    {
      path: "folder/alpha.txt",
      kind: "file",
      size: 23,
      compressedSize: 23,
      modified: "1781085660",
    },
    {
      path: "folder/beta.txt",
      kind: "file",
      size: 18,
      compressedSize: 18,
      modified: "1781085720",
    },
    {
      path: "root.txt",
      kind: "file",
      size: 20,
      compressedSize: 21,
      modified: "1781085780",
    },
  ],
};

test.beforeEach(async ({ page }, testInfo) => {
  if (!testInfo.titlePath.includes("linux native drag arming")) {
    await loadExtractFixture(page);
  }
});

test("synthetic folder rows can be selected from the table row", async ({ page }) => {
  const folderRow = entryRow(page, "folder");

  await expect(folderRow).toHaveAttribute("aria-selected", "false");
  await expect(folderRow.locator("input[type='checkbox']")).not.toBeChecked();

  await folderRow.locator("[data-row-primary]").click();

  await expect(folderRow).toHaveAttribute("aria-selected", "true");
  await expect(folderRow.locator("input[type='checkbox']")).toBeChecked();
});

test("double-clicking a folder row opens the folder after selection", async ({ page }) => {
  await entryRow(page, "folder").locator("[data-row-primary]").dblclick();

  await expect(entryRow(page, "folder/alpha.txt")).toBeVisible();
  await expect(entryRow(page, "folder/beta.txt")).toBeVisible();
  await expect(entryRow(page, "root.txt")).toBeHidden();
});

test("dragging a selected synthetic folder row starts native drag for the folder path", async ({ page }) => {
  const folderRow = entryRow(page, "folder");
  await folderRow.locator("[data-row-primary]").click();

  await dragRowName(page, "folder");

  const [call] = await waitForNativeDragCalls(page);
  expect(call.args).toEqual({
    request: {
      archivePath: archiveFixture.archivePath,
      entryPaths: ["folder"],
      stripComponents: 0,
    },
  });
});

test("additive-click adds rows to the selection without starting native drag-out", async ({ page }) => {
  const folderRow = entryRow(page, "folder");
  const rootRow = entryRow(page, "root.txt");

  await rootRow.locator("[data-row-primary]").click();
  await folderRow.locator("[data-row-primary]").click({ modifiers: ["ControlOrMeta"] });

  await expect(rootRow).toHaveAttribute("aria-selected", "true");
  await expect(folderRow).toHaveAttribute("aria-selected", "true");
  expect(await nativeDragCalls(page)).toEqual([]);
});

test("shift-click selects a visible range without starting native drag-out", async ({ page }) => {
  await entryRow(page, "folder").locator("[data-row-primary]").click();
  await entryRow(page, "root.txt").locator("[data-row-primary]").click({ modifiers: ["Shift"] });

  await expect(entryRow(page, "folder")).toHaveAttribute("aria-selected", "true");
  await expect(entryRow(page, "root.txt")).toHaveAttribute("aria-selected", "true");
  expect(await nativeDragCalls(page)).toEqual([]);
});

test("pressing an unselected file row waits for click or drag intent", async ({ page }) => {
  const rootRow = entryRow(page, "root.txt");
  const box = await rootRow.locator("[data-row-primary]").boundingBox();
  if (!box) {
    throw new Error("Unable to locate root row name");
  }

  await expect(rootRow).toHaveAttribute("aria-selected", "false");

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();

  await expect(rootRow).toHaveAttribute("aria-selected", "false");
  await expect(rootRow.locator("input[type='checkbox']")).not.toBeChecked();
  expect(await nativeDragCalls(page)).toEqual([]);

  await page.mouse.move(box.x + box.width / 2 + 3, box.y + box.height / 2, { steps: 2 });
  await expect(rootRow).toHaveAttribute("aria-selected", "false");
  expect(await nativeDragCalls(page)).toEqual([]);

  await page.mouse.up();

  await expect(rootRow).toHaveAttribute("aria-selected", "true");
  await expect(rootRow.locator("input[type='checkbox']")).toBeChecked();
  expect(await nativeDragCalls(page)).toEqual([]);
});

test("dragging an unselected file row selects it when native drag-out starts", async ({ page }) => {
  const rootRow = entryRow(page, "root.txt");
  const box = await rootRow.locator("[data-row-primary]").boundingBox();
  if (!box) {
    throw new Error("Unable to locate root row name");
  }

  await expect(rootRow).toHaveAttribute("aria-selected", "false");

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(rootRow).toHaveAttribute("aria-selected", "false");

  await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2, { steps: 3 });
  const [call] = await waitForNativeDragCalls(page);
  expect(call.args).toEqual({
    request: {
      operationId: "native-drag-1",
      request: {
        archivePath: archiveFixture.archivePath,
        entryPaths: ["root.txt"],
        stripComponents: 0,
      },
    },
  });

  await page.mouse.up();
});

test("dragging one selected row starts native drag-out for the selected set", async ({ page }) => {
  await entryRow(page, "root.txt").locator("[data-row-primary]").click();
  await entryRow(page, "folder").locator("[data-row-primary]").click({ modifiers: ["ControlOrMeta"] });

  await dragRowName(page, "root.txt");

  const [call] = await waitForNativeDragCalls(page);
  expect(call.args).toEqual({
    request: {
      archivePath: archiveFixture.archivePath,
      entryPaths: ["root.txt", "folder"],
      stripComponents: 0,
    },
  });
});

test("dragging a search result keeps full archive path structure", async ({ page }) => {
  await entryRow(page, "folder").locator("[data-row-primary]").dblclick();
  await expect(entryRow(page, "root.txt")).toBeHidden();

  await page.locator("#search-entries").fill("root");
  await expect(entryRow(page, "root.txt")).toBeVisible();

  await dragRowName(page, "root.txt");

  const [call] = await waitForNativeDragCalls(page);
  expect(call.args).toEqual({
    request: {
      archivePath: archiveFixture.archivePath,
      entryPaths: ["root.txt"],
      stripComponents: 0,
    },
  });
});

test("dragging blank table space marquee-selects intersecting rows", async ({ page }) => {
  const folderRow = entryRow(page, "folder");
  const rootRow = entryRow(page, "root.txt");
  const folderBox = await folderRow.boundingBox();
  const rootBox = await rootRow.boundingBox();
  const rootSizeCellBox = await rootRow.locator("td").nth(2).boundingBox();
  if (!folderBox || !rootBox || !rootSizeCellBox) {
    throw new Error("Unable to locate table geometry");
  }

  const startX = rootSizeCellBox.x + rootSizeCellBox.width - 8;
  const startY = rootSizeCellBox.y + rootSizeCellBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(folderBox.x + 2, folderBox.y + 2, { steps: 5 });

  await expect(page.locator("[data-marquee-selection]")).toBeVisible();
  await expect(folderRow).toHaveAttribute("aria-selected", "true");
  await expect(rootRow).toHaveAttribute("aria-selected", "true");
  expect(await nativeDragCalls(page)).toEqual([]);

  await page.mouse.up();
  await expect(page.locator("[data-marquee-selection]")).toBeHidden();
});

test("dragging empty list-view space starts marquee selection", async ({ page }) => {
  const folderRow = entryRow(page, "folder");
  const rootRow = entryRow(page, "root.txt");
  const tableShellBox = await page.locator("[data-archive-table-shell]").boundingBox();
  const folderBox = await folderRow.boundingBox();
  const rootBox = await rootRow.boundingBox();
  if (!tableShellBox || !folderBox || !rootBox) {
    throw new Error("Unable to locate list-view geometry");
  }

  const startX = tableShellBox.x + tableShellBox.width / 2;
  const startY = Math.min(rootBox.y + rootBox.height + 60, tableShellBox.y + tableShellBox.height - 16);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(folderBox.x + 2, folderBox.y + 2, { steps: 8 });

  await expect(page.locator("[data-marquee-selection]")).toBeVisible();
  await expect(folderRow).toHaveAttribute("aria-selected", "true");
  await expect(rootRow).toHaveAttribute("aria-selected", "true");
  expect(await nativeDragCalls(page)).toEqual([]);

  await page.mouse.up();
  await expect(page.locator("[data-marquee-selection]")).toBeHidden();
});

test("archive list suppresses WebView text selection gestures", async ({ page }) => {
  const rootRow = entryRow(page, "root.txt");
  const sizeCell = rootRow.locator("td").nth(2);
  const box = await sizeCell.boundingBox();
  if (!box) {
    throw new Error("Unable to locate root size cell");
  }

  await expect(page.locator("[data-archive-table-shell]")).toHaveCSS(
    "user-select",
    "none",
  );

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 120, box.y - 32, { steps: 6 });

  await expect(page.locator("[data-marquee-selection]")).toBeVisible();
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");

  await page.mouse.up();
});

test("checkbox selection does not start native drag-out", async ({ page }) => {
  const rootRow = entryRow(page, "root.txt");
  const checkbox = rootRow.locator("input[type='checkbox']");
  const box = await checkbox.boundingBox();
  if (!box) {
    throw new Error("Unable to locate root checkbox");
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 14, box.y + box.height / 2, { steps: 3 });
  await page.mouse.up();

  expect(await nativeDragCalls(page)).toEqual([]);
});

test("dragging a file row starts native drag for the file and suppresses browser icon drag", async ({
  page,
}) => {
  const rootRow = entryRow(page, "root.txt");

  await expect(rootRow.locator("[data-row-icon]")).toHaveAttribute("draggable", "false");
  await expect(await dispatchDragStartFromIcon(rootRow)).toBe(true);

  await dragRowName(page, "root.txt");

  const [call] = await waitForNativeDragCalls(page);
  expect(call.args).toEqual({
    request: {
      archivePath: archiveFixture.archivePath,
      entryPaths: ["root.txt"],
      stripComponents: 0,
    },
  });
  await expect(rootRow).toHaveAttribute("aria-selected", "true");
});

test.describe("linux native drag arming", () => {
  test.beforeEach(async ({ page }) => {
    await loadExtractFixture(page, { platform: "linux" });
  });

  test("pressing and holding a row does not prepare or start native drag-out", async ({ page }) => {
    const rootRow = entryRow(page, "root.txt");
    const box = await rootRow.locator("[data-row-primary]").boundingBox();
    if (!box) {
      throw new Error("Unable to locate root row name");
    }

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(150);

    await expect(rootRow).toHaveAttribute("aria-selected", "false");
    expect(await nativeDragCalls(page)).toEqual([]);

    await page.mouse.up();
  });

  test("linux starts direct native drag only after real drag movement", async ({ page }) => {
    const rootRow = entryRow(page, "root.txt");
    const box = await rootRow.locator("[data-row-primary]").boundingBox();
    if (!box) {
      throw new Error("Unable to locate root row name");
    }

    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 3, startY, { steps: 2 });

    expect(await nativeDragCalls(page)).toEqual([]);

    await page.mouse.move(startX + 12, startY + 2, { steps: 3 });

    const [call] = await waitForNativeDragCalls(page);
    expect(call.args).toEqual({
      request: {
        operationId: "native-drag-1",
        request: {
          archivePath: archiveFixture.archivePath,
          entryPaths: ["root.txt"],
          stripComponents: 0,
        },
      },
    });
    await expect(rootRow).toHaveAttribute("aria-selected", "true");

    await page.mouse.up();
  });

  test("linux additive-click and shift-click select without preparing drag-out", async ({ page }) => {
    const folderRow = entryRow(page, "folder");
    const rootRow = entryRow(page, "root.txt");

    await rootRow.locator("[data-row-primary]").click();
    await folderRow.locator("[data-row-primary]").click({ modifiers: ["ControlOrMeta"] });

    await expect(rootRow).toHaveAttribute("aria-selected", "true");
    await expect(folderRow).toHaveAttribute("aria-selected", "true");

    await rootRow.locator("[data-row-primary]").click({ modifiers: ["Shift"] });

    await expect(rootRow).toHaveAttribute("aria-selected", "true");
    await expect(folderRow).toHaveAttribute("aria-selected", "true");
  });

  test("linux table row DOM dragstart is suppressed so WebKit does not start a DOM drag", async ({ page }) => {
    const rootRow = entryRow(page, "root.txt");

    await expect(await dispatchDragStartFromIcon(rootRow)).toBe(true);
  });
});

async function loadExtractFixture(page: Page, options?: { platform?: "windows" | "linux" }) {
  await installTauriStub(page, options);
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__zmanagerDev));
  await page.waitForFunction(() =>
    window.__zmanagerE2E?.ipcCalls.some((call) => call.cmd === "project_contract"),
  );
  if (options?.platform === "linux") {
    await expect(page.locator("body")).toHaveClass(/custom-window-chrome/);
  }
  await page.getByRole("tab", { name: "Extract" }).click();
  await page.evaluate((fixture) => window.__zmanagerDev?.loadArchiveFixture(fixture), archiveFixture);
  await expect(entryRow(page, "folder")).toBeVisible();
  await expect(entryRow(page, "root.txt")).toBeVisible();
  await clearIpcCalls(page);
}

async function installTauriStub(page: Page, options?: { platform?: "windows" | "linux" }) {
  const platform = options?.platform ?? "windows";
  await page.addInitScript((platform: "windows" | "linux") => {
    const ipcCalls: IpcCall[] = [];
    const callbacks = new Map<number, { callback: unknown; once: boolean }>();
    let callbackId = 1;

    Object.defineProperty(window, "isTauri", {
      configurable: true,
      value: true,
    });

    window.__zmanagerE2E = { ipcCalls };

    const invoke = async (cmd: string, args: Record<string, unknown> = {}) => {
      ipcCalls.push({ cmd, args });

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
          commands: ["accept_native_file_drag", "start_native_file_drag"],
          platformStrategy: "e2e",
          coreDependency: "stub",
          platformIntegration: {
            platform,
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
        return {
          launchedForQuickAction: false,
          quickAction: null,
          error: null,
        };
      }

      if (cmd === "native_frontend_ready") {
        return 0;
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

      if (cmd === "system_file_icons") {
        const request = args.request as { entries?: { key: string }[] } | undefined;
        return {
          icons: (request?.entries ?? []).map((entry) => ({
            key: entry.key,
            dataUrl: null,
          })),
        };
      }

      if (cmd === "accept_native_file_drag") {
        return {
          acceptedJob: {
            acceptanceRevision: "1",
            job: {
              jobId: "job-native-drag-1",
              kind: "zipExtract",
              status: "queued",
              createdAt: "2026-01-01T00:00:00Z",
            },
            origin: "nativeDrag",
          },
          operationId: "native-drag-1",
        };
      }

      if (cmd === "start_native_file_drag") {
        const request = args.request as { request: { entryPaths: string[] } };
        return {
          outcome: "dropped",
          sessionId: null,
          jobId: "job-native-drag-1",
          draggedEntries: request.request.entryPaths,
        };
      }

      if (cmd === "clear_native_file_drag") {
        return undefined;
      }

      if (cmd === "cleanup_preview_roots") {
        return undefined;
      }

      if (cmd === "subscribe_job_catalog") {
        return "catalog-1";
      }

      if (cmd === "ack_subscription" || cmd === "unsubscribe_job") {
        return undefined;
      }

      if (cmd === "plugin:window|inner_size") {
        return { width: 1280, height: 800 };
      }

      if (cmd === "plugin:window|inner_position") {
        return { x: 0, y: 0 };
      }

      if (cmd === "plugin:event|listen") {
        return args.handler;
      }

      if (cmd === "plugin:event|unlisten" || cmd.startsWith("plugin:window|")) {
        return undefined;
      }

      if (cmd.startsWith("plugin:")) {
        return undefined;
      }

      throw new Error(`Unhandled Tauri command in e2e stub: ${cmd}`);
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
  }, platform);
}

function entryRow(page: Page, entryPath: string) {
  return page.locator(`tbody tr[data-entry-path="${entryPath}"]`);
}

async function clearIpcCalls(page: Page) {
  await page.evaluate(() => {
    if (window.__zmanagerE2E) {
      window.__zmanagerE2E.ipcCalls.length = 0;
    }
  });
}

async function nativeDragCalls(page: Page): Promise<IpcCall[]> {
  return page.evaluate(() =>
    (window.__zmanagerE2E?.ipcCalls ?? []).filter(
      (call) => call.cmd === "start_native_file_drag",
    ),
  );
}

async function waitForNativeDragCalls(page: Page): Promise<IpcCall[]> {
  await expect.poll(async () => (await nativeDragCalls(page)).length).toBe(1);
  return nativeDragCalls(page);
}

async function dragRowName(page: Page, entryPath: string) {
  const rowName = entryRow(page, entryPath).locator("[data-row-primary]");
  const box = await rowName.boundingBox();
  if (!box) {
    throw new Error(`Unable to locate row name for ${entryPath}`);
  }

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 12, startY + 2, { steps: 3 });
  await page.mouse.up();
}

async function dispatchDragStartFromIcon(row: ReturnType<typeof entryRow>): Promise<boolean> {
  return row.locator("[data-row-icon]").evaluate((icon) => {
    const event = new DragEvent("dragstart", {
      bubbles: true,
      cancelable: true,
    });
    icon.dispatchEvent(event);
    return event.defaultPrevented;
  });
}
