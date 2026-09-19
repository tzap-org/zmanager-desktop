import { expect, test, type Page } from "@playwright/test";

import {
  auditDesktopDialogLayout,
  auditWorkspaceContentLayout,
  measureDesktopDialogLayout,
} from "./helpers/desktopDialogLayout";

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


const auditDir = "docs/gui-audit";

const nativeImageIcon =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256'%3E%3Crect width='256' height='256' fill='%23f9fafb'/%3E%3Crect x='32' y='32' width='192' height='192' rx='18' fill='%2393c5fd'/%3E%3Ccircle cx='180' cy='82' r='24' fill='%23eff6ff'/%3E%3Cpath d='M48 208l60-78 42 48 28-34 34 64z' fill='%230284c7'/%3E%3C/svg%3E";
const nativeFileIcon =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256'%3E%3Cpath d='M56 20h94l50 50v166H56z' fill='%23ffffff' stroke='%236b7280' stroke-width='14'/%3E%3Cpath d='M150 20v58h50' fill='%23e5e7eb'/%3E%3C/svg%3E";
const nativeFolderIcon =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256'%3E%3Cpath d='M18 72h84l22 28h114v112H18z' fill='%23fbbf24'/%3E%3Cpath d='M18 92h220v120H18z' fill='%23f59e0b'/%3E%3C/svg%3E";

async function selectRadixOption(page: Page, trigger: string, option: string) {
  await page.locator(trigger).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

const archiveFixture: ArchiveFixture = {
  archivePath: "C:/fixtures/visual-scan.zip",
  entryCount: 5,
  totalSize: 151_296,
  entries: [
    {
      path: "documents/quarterly-review.pdf",
      kind: "file",
      size: 81_920,
      compressedSize: 42_008,
      modified: "1781085660",
    },
    {
      path: "documents/notes.txt",
      kind: "file",
      size: 1_024,
      compressedSize: 512,
      modified: "1781085720",
    },
    {
      path: "images/product-screenshot.png",
      kind: "file",
      size: 61_440,
      compressedSize: 55_200,
      modified: "1781085780",
    },
    {
      path: "documents",
      kind: "directory",
      size: 0,
      compressedSize: 0,
      modified: "1781085600",
    },
    {
      path: "images",
      kind: "directory",
      size: 0,
      compressedSize: 0,
      modified: "1781085600",
    },
  ],
};

test.beforeEach(async ({ page }) => {
  await installTauriStub(page);
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__zmanagerDev));
});

test("native file icons keep clear visual spacing from file names", async ({ page }) => {
  await page.getByRole("tab", { name: "Extract" }).click();
  await loadArchiveWithIcons(page);

  await page.locator('tr[data-entry-path="documents"] [data-row-primary]').dblclick();
  const fileRow = page.locator('tr[data-entry-path="documents/notes.txt"]');
  await expect(fileRow).toBeVisible();

  const spacing = await fileRow.evaluate((element) => {
    const icon = element.querySelector<HTMLElement>("[data-row-icon]")?.getBoundingClientRect();
    const name = element.querySelector<HTMLElement>("[data-row-name]")?.getBoundingClientRect();
    if (!icon || !name) {
      throw new Error("Native file icon and name must both render.");
    }
    return name.left - icon.right;
  });

  await fileRow.screenshot({ path: `${auditDir}/37-native-file-icon-spacing.png` });
  await expect(fileRow).toHaveScreenshot("37-native-file-icon-spacing.png");
  expect(spacing).toBeGreaterThanOrEqual(8);
});

test("folder panes suppress the WebView context menu", async ({ page }) => {
  const compressContextMenuNotCancelled = await page.locator("#navigation-pane").evaluate((element) =>
    element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
  );
  expect(compressContextMenuNotCancelled).toBe(false);

  await page.getByRole("tab", { name: "Extract" }).click();
  const extractContextMenuNotCancelled = await page.locator("#navigation-pane").evaluate((element) =>
    element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
  );
  expect(extractContextMenuNotCancelled).toBe(false);
});

test("table views suppress the WebView context menu", async ({ page }) => {
  const compressTableContextMenuNotCancelled = await page.locator("[data-create-table-shell]").evaluate((element) =>
    element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
  );
  expect(compressTableContextMenuNotCancelled).toBe(false);

  await page.getByRole("tab", { name: "Extract" }).click();
  const extractTableContextMenuNotCancelled = await page.locator("[data-archive-table-shell]").evaluate((element) =>
    element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
  );
  expect(extractTableContextMenuNotCancelled).toBe(false);
});

test("compress table header context menu toggles visible columns and keeps colgroup aligned", async ({ page }) => {
  await dropFiles(page, ["column-menu-source.txt"]);

  await page.locator("th[data-compress-column-id='size']").click({ button: "right" });
  await expect(page.locator("#context-menu")).toBeVisible();
  await expect(page.locator("#context-menu")).toContainText("Reset columns");

  await page.locator("#context-menu button").filter({ hasText: "Source Path" }).click();
  await expect(page.locator("th[data-compress-column-id='sourcePath']")).toBeVisible();

  const colCount = await page.locator("#compress-source-table colgroup col").count();
  const thCount = await page.locator("#compress-source-table th").count();
  expect(colCount).toBe(thCount);

  await page.locator("th[data-compress-column-id='size']").click({ button: "right" });
  await page.locator("#context-menu button").filter({ hasText: "Reset Columns" }).click();
  await expect(page.locator("th[data-compress-column-id='sourcePath']")).toBeHidden();
});

test("compress table columns reorder by dragging left and right", async ({ page }) => {
  await dropFiles(page, ["one.txt", "two.txt"]);

  const headers = page.locator("th[data-compress-column-id]");
  const columnOrder = () =>
    headers.evaluateAll((cells) =>
      cells.map((cell) => cell.getAttribute("data-compress-column-id")),
    );

  await expect.poll(columnOrder).toEqual(["name", "kind", "size", "modified"]);
  await expect(page.locator("[data-column-drag-grip]")).toHaveCount(3);

  await startTableColumnDrag(
    page,
    "th[data-compress-column-id='kind']",
    "th[data-compress-column-id='modified']",
  );
  await expect(
    page.locator("th[data-compress-column-id='kind']"),
  ).toHaveAttribute("data-column-drag-source", "true");
  await expect(
    page.locator("th[data-compress-column-id='modified']"),
  ).toHaveAttribute("data-column-drop-position", "after");
  await page.mouse.up();
  await expect.poll(columnOrder).toEqual(["name", "size", "modified", "kind"]);
  await expect(page.locator("#drop-overlay")).toHaveAttribute(
    "aria-hidden",
    "true",
  );

  await startTableColumnDrag(
    page,
    "th[data-compress-column-id='kind']",
    "th[data-compress-column-id='size']",
  );
  await expect(
    page.locator("th[data-compress-column-id='size']"),
  ).toHaveAttribute("data-column-drop-position", "before");
  await page.mouse.up();
  await expect.poll(columnOrder).toEqual(["name", "kind", "size", "modified"]);
});

test("extract table header context menu toggles visible columns and supports keyboard shortcut", async ({ page }) => {
  await page.getByRole("tab", { name: "Extract" }).click();
  await loadArchiveWithIcons(page);

  await page.locator("th[data-column-id='size']").focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.locator("#context-menu")).toBeVisible();
  await expect(page.locator("#context-menu")).toContainText("Sort Ascending");

  await page.keyboard.press("Escape");
  await expect(page.locator("#context-menu")).toBeHidden();
});

test("extract table columns reorder by dragging left and right", async ({ page }) => {
  await page.getByRole("tab", { name: "Extract" }).click();
  await loadArchiveWithIcons(page);

  const headers = page.locator("th[data-column-id]");
  const columnOrder = () =>
    headers.evaluateAll((cells) =>
      cells.map((cell) => cell.getAttribute("data-column-id")),
    );

  await expect.poll(columnOrder).toEqual([
    "name",
    "kind",
    "size",
    "modified",
    "compressedSize",
  ]);

  await startTableColumnDrag(
    page,
    "th[data-column-id='kind']",
    "th[data-column-id='compressedSize']",
  );
  await expect(
    page.locator("th[data-column-id='kind']"),
  ).toHaveAttribute("data-column-drag-source", "true");
  await expect(
    page.locator("th[data-column-id='compressedSize']"),
  ).toHaveAttribute("data-column-drop-position", "after");
  await page.mouse.up();
  await expect.poll(columnOrder).toEqual([
    "name",
    "size",
    "modified",
    "compressedSize",
    "kind",
  ]);

  await startTableColumnDrag(
    page,
    "th[data-column-id='kind']",
    "th[data-column-id='size']",
  );
  await expect(
    page.locator("th[data-column-id='kind']"),
  ).toHaveAttribute("data-column-drag-source", "true");
  await expect(
    page.locator("th[data-column-id='size']"),
  ).toHaveAttribute("data-column-drop-position", "before");
  await page.mouse.up();
  await expect.poll(columnOrder).toEqual([
    "name",
    "kind",
    "size",
    "modified",
    "compressedSize",
  ]);
});

test("column gestures preserve resizing and Extract sorting", async ({ page }) => {
  await dropFiles(page, ["resize-source.txt"]);

  const compressSizeHeader = page.locator(
    "th[data-compress-column-id='size']",
  );
  const compressOrder = () =>
    page.locator("th[data-compress-column-id]").evaluateAll((cells) =>
      cells.map((cell) => cell.getAttribute("data-compress-column-id")),
    );
  const compressWidthBefore = (await compressSizeHeader.boundingBox())?.width;
  expect(compressWidthBefore).toBeTruthy();

  await resizeTableColumn(
    page,
    "[data-column-resizer='size']",
    36,
  );
  await expect
    .poll(async () => (await compressSizeHeader.boundingBox())?.width)
    .toBeGreaterThan(compressWidthBefore ?? 0);
  await expect.poll(compressOrder).toEqual([
    "name",
    "kind",
    "size",
    "modified",
  ]);

  await page.getByRole("tab", { name: "Extract" }).click();
  await loadArchiveWithIcons(page);

  const extractSizeHeader = page.locator("th[data-column-id='size']");
  await extractSizeHeader.click({ position: { x: 24, y: 12 } });
  await expect(extractSizeHeader).toHaveAttribute("aria-sort", "ascending");
  await extractSizeHeader.click({ position: { x: 24, y: 12 } });
  await expect(extractSizeHeader).toHaveAttribute("aria-sort", "descending");

  const compressedSizeHeader = page.locator(
    "th[data-column-id='compressedSize']",
  );
  const extractWidthBefore = (await compressedSizeHeader.boundingBox())?.width;
  expect(extractWidthBefore).toBeTruthy();

  await resizeTableColumn(
    page,
    "[data-column-resizer='compressedSize']",
    36,
  );
  await expect
    .poll(async () => (await compressedSizeHeader.boundingBox())?.width)
    .toBeGreaterThan(extractWidthBefore ?? 0);
  await expect(extractSizeHeader).toHaveAttribute("aria-sort", "descending");
  await expect
    .poll(() =>
      page.locator("th[data-column-id]").evaluateAll((cells) =>
        cells.map((cell) => cell.getAttribute("data-column-id")),
      ),
    )
    .toEqual(["name", "kind", "size", "modified", "compressedSize"]);
});

test("Close Archive resets Extract to its empty state", async ({ page }) => {
  await page.getByRole("tab", { name: "Extract" }).click();
  await loadArchiveWithIcons(page);

  await expect(page.locator("#close-archive")).toBeEnabled();
  await expect(page.locator("#archive-empty-state")).toBeHidden();

  await page.locator("#close-archive").click();

  await expect(page.locator("#archive-empty-state")).toBeVisible();
  await expect(page.locator("#extract-destination")).toBeDisabled();
  await expect(page.locator("#extract-destination")).toHaveValue("");
  await expect(page.locator("#close-archive")).toBeDisabled();
});

test("primary GUI states have visible, non-overlapping controls", async ({ page }) => {
  await expect(page.locator("main[data-mode='compress'] [data-shell-chrome='path']")).toBeVisible();
  await expect(page.locator("main[data-mode='compress'] [data-shell-chrome='path'] #create-destination")).toBeVisible();
  await expect(page.locator("main[data-mode='compress'] [data-shell-chrome='path'] #search-entries")).toHaveAttribute("placeholder", "Search sources");
  await expect(page.locator("main[data-mode='compress'] [data-shell-chrome='path'] #browse-create-destination")).toHaveCount(0);
  await expect(page.locator("[data-command-group='compress'] #browse-create-destination")).toBeVisible();
  await expect(page.locator("[data-command-group='compress'] #browse-create-destination")).toContainText("Output Folder...");
  await expect(page.locator("[data-command-group='compress'] #start-create")).toBeVisible();
  await expect(page.locator("[data-command-group='table'] #include-all-sources")).toBeVisible();
  await expect(page.locator("[data-command-group='table'] #exclude-all-sources")).toBeVisible();
  await expect(page.locator("[data-command-group='table'] #clear-sources")).toBeVisible();
  await expect(page.locator("#new-archive")).toHaveCount(0);
  await expect(page.locator("[data-command-group='compress'] #create-destination-recent")).toHaveCount(0);
  await expect(page.locator("#zmanager-runtime-bridge-root > [data-workspace-browser]")).toBeHidden();
  await page.locator("#add-archive").click();
  await expect(page.locator("#context-menu [data-context-action='add-source-files']")).toContainText("Files...");
  await expect(page.locator("#context-menu [data-context-action='add-source-folder']")).toContainText("Folder...");
  await page.keyboard.press("Escape");
  await expect(page.locator("#context-menu")).toBeHidden();

  await captureAndScan(page, "03-compress-empty");
  await captureReadmeHero(page, "00-readme-hero", "main[data-mode]");

  await dragFiles(page, ["draft.zip"]);
  await expect(page.locator("#drop-overlay")).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator("#drop-overlay-title")).toHaveText("Add sources to archive");
  await expect(page.locator("#drop-overlay-message")).toContainText("Copy");
  await expect(page.locator("#drop-overlay-actions")).toBeHidden();
  await expectOverlayInsideWorkspaceBody(page);
  await captureAndScan(page, "25-compress-drop-overlay");
  await dragLeave(page);
  await expect(page.locator("#drop-overlay")).toHaveAttribute("aria-hidden", "true");

  await dragFilesThroughNestedTargets(page, ["nested-draft.zip"]);
  await expect(page.locator("#drop-overlay")).toHaveAttribute("aria-hidden", "true");

  await dropFiles(page, ["desktop-archive-source.zip", "quarterly-report.pdf", "photos-folder"]);
  await expect(page.locator("#compress-source-body tr")).toHaveCount(3);
  await captureAndScan(page, "04-compress-with-sources");

  await page.locator("#compress-source-body tr[data-compress-path]").first().click({ button: "right" });
  await expect(page.locator("#context-menu")).toBeVisible();
  await expect(page.locator("#context-menu [data-context-action='remove-source']")).toContainText("Remove Source");
  await captureAndScan(page, "26-create-source-context-menu");
  await page.keyboard.press("Escape");
  await expect(page.locator("#context-menu")).toBeHidden();

  await expect(page.locator("#compress-options-panel")).toBeVisible();
  await captureAndScan(page, "05-create-dialog");

  await selectRadixOption(page, "#create-format", "7Z");
  await expect(page.locator("#create-advanced-options summary")).toBeVisible();
  await page.locator("#create-advanced-options summary").click();
  await selectRadixOption(page, "#create-volume", "1 MB");
  await page.locator("#create-password").fill("correct horse battery staple");
  await page.locator("#create-password-confirm").fill("correct horse battery staple");
  await expect(page.locator("#create-password")).toHaveAttribute("type", "password");
  await expect(page.locator("#create-password-confirm")).toHaveAttribute("type", "password");
  await expect(page.locator("#create-show-password")).not.toBeChecked();
  await captureAndScan(page, "27-create-dialog-advanced-options");

  await page.getByRole("tab", { name: "Extract" }).click();
  await expect(page.locator("#open-archive")).toBeEnabled();
  await expect(page.locator("#search-entries")).toBeDisabled();
  await expect(page.locator("#details-content")).toContainText("No archive open");
  await expect(page.locator("#details-content [data-details-action='open-archive']")).toBeVisible();
  await expect(page.locator("#archive-empty-state [data-empty-action='open-archive']")).toBeVisible();
  await captureAndScan(page, "06-extract-empty");

  await dragFiles(page, ["sample.zip", "loose-notes.txt"]);
  await expect(page.locator("#drop-overlay")).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator("#drop-overlay-title")).toHaveText("Choose a mode");
  await expect(page.locator("#drop-overlay-actions")).toBeVisible();
  await expect(page.locator("#drop-open-archive")).toHaveText("Open Archive");
  await expect(page.locator("#drop-add-compress")).toHaveText("Add to Compress");
  await expectOverlayInsideWorkspaceBody(page);
  await captureAndScan(page, "28-extract-drop-overlay");
  await dragLeave(page);

  await dropFiles(page, ["sample.zip", "loose-notes.txt"]);
  await expect(page.locator("#drop-overlay")).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator("#drop-open-archive")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("#drop-add-compress")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#drop-overlay")).toHaveAttribute("aria-hidden", "true");
  await expect(page.getByRole("tab", { name: "Compress" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#compress-source-body tr")).toHaveCount(5);
  await page.getByRole("tab", { name: "Extract" }).click();

  await page.evaluate((fixture) => window.__zmanagerDev?.loadArchiveFixture(fixture), archiveFixture);
  await page.evaluate((fixtures) => window.__zmanagerDev?.setSystemIconFixtures(fixtures), {
    directory: nativeFolderIcon,
    "file:.pdf": nativeFileIcon,
    "file:.png": nativeImageIcon,
    "file:.txt": nativeFileIcon,
    "file:.zip": nativeFileIcon,
  });
  await expect(page.locator('tr[data-entry-path="documents"]')).toBeVisible();
  await expect(page.locator("[data-row-icon] img").first()).toBeVisible();
  await expect(page.locator("#search-entries")).toBeEnabled();
  await expect(page.locator("#details-content [data-copy-value='C:/fixtures/visual-scan.zip']")).toBeVisible();
  await captureAndScan(page, "07-extract-with-archive");

  await page.locator("#tree-content [data-tree-path='images']").click();
  await expect(page.locator('tr[data-entry-path="images/product-screenshot.png"]')).toBeVisible();
  await expect(page.locator("#details-content")).toContainText("images");
  await expect(page.locator("#status-selection-count")).toContainText("0 / 1");

  await loadArchiveWithIcons(page);
  await expect(page.locator('tr[data-entry-path="documents"]')).toBeVisible();

  await page.locator('tr[data-entry-path="documents"] [data-row-primary]').click();
  await expect(page.locator("#extract-all")).toBeVisible();

  await page.locator('tr[data-entry-path="documents"]').click({ button: "right" });
  await expect(page.locator("#context-menu")).toBeVisible();
  const entryMenuLabels = page.locator("#context-menu [data-context-action]:visible");
  await expect(entryMenuLabels.nth(0)).toHaveText("Open");
  await expect(entryMenuLabels.nth(1)).toHaveText("Extract...");
  await expect(entryMenuLabels.nth(2)).toHaveText("Extract Here");
  await expect(entryMenuLabels.nth(3)).toHaveText("Test");
  await expect(entryMenuLabels.nth(4)).toHaveText("Properties");
  await captureAndScan(page, "09-entry-context-menu");

  await page.keyboard.press("Escape");
  await expect(page.locator("#context-menu")).toBeHidden();
  await page.locator('tr[data-entry-path="documents"]').focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.locator("#context-menu")).toBeVisible();
  await expect(page.locator("#context-menu [data-context-action]").first()).toContainText("Open");
});

test("create workspace rows preserve keyboard selection and delete removal", async ({ page }) => {
  await dropFiles(page, ["desktop-archive-source.zip", "quarterly-report.pdf", "photos-folder"]);
  const rows = page.locator("#compress-source-body tr[data-compress-path]");
  await expect(rows).toHaveCount(3);

  const firstRow = rows.first();
  const removedSourcePath = await firstRow.getAttribute("data-compress-source-path");
  expect(removedSourcePath).toBeTruthy();

  await firstRow.locator("[data-row-primary]").click();
  await expect(firstRow).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("Delete");
  await expect(rows).toHaveCount(2);
  await expect(page.locator(`#compress-source-body tr[data-compress-source-path="${removedSourcePath}"]`)).toHaveCount(0);
});

test("create workspace rows support drag-window multi-selection", async ({ page }) => {
  await dropFiles(page, ["desktop-archive-source.zip", "quarterly-report.pdf", "photos-folder"]);
  const rows = page.locator("#compress-source-body tr[data-compress-path]");
  await expect(rows).toHaveCount(3);

  const firstRow = rows.nth(0);
  const secondRow = rows.nth(1);
  const firstBox = await firstRow.boundingBox();
  const secondKindCellBox = await secondRow.locator("td").nth(4).boundingBox();
  if (!firstBox || !secondKindCellBox) {
    throw new Error("Unable to locate compress table geometry");
  }

  const startX = secondKindCellBox.x + secondKindCellBox.width - 8;
  const startY = secondKindCellBox.y + secondKindCellBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(firstBox.x + 2, firstBox.y + 2, { steps: 5 });

  await expect(page.locator("[data-marquee-selection]")).toBeVisible();
  await expect(firstRow).toHaveAttribute("aria-selected", "true");
  await expect(secondRow).toHaveAttribute("aria-selected", "true");
  await expect(rows.nth(2)).toHaveAttribute("aria-selected", "false");

  await page.mouse.up();
  await expect(page.locator("[data-marquee-selection]")).toBeHidden();
});

test("create password fields clear when hidden or submitted", async ({ page }) => {
  await dropFiles(page, ["secret-source.txt"]);
  await waitForCompressSources(page);

  await selectRadixOption(page, "#create-format", "7Z");
  await waitForCompressSources(page);
  await expect(page.locator("#create-advanced-options summary")).toBeVisible();
  await page.locator("#create-advanced-options summary").click();
  await page.locator("#create-password").fill("first-secret");
  await page.locator("#create-password-confirm").fill("second-secret");
  await page.locator("#create-show-password").check();
  await expect(page.locator("#create-password")).toHaveAttribute("type", "text");

  await selectRadixOption(page, "#create-format", "TZST");
  await waitForCompressSources(page);
  await expect(page.locator("#create-password")).toHaveCount(0);
  await page.locator("#start-create").click();
  await expect(page.locator("main")).not.toContainText("Password confirmation does not match.");

  await selectRadixOption(page, "#create-format", "7Z");
  await waitForCompressSources(page);
  await page.locator("#create-advanced-options").evaluate((element) => { (element as HTMLDetailsElement).open = true; });
  await expect(page.locator("#create-password")).toHaveValue("");
  await expect(page.locator("#create-password-confirm")).toHaveValue("");
  await expect(page.locator("#create-password")).toHaveAttribute("type", "password");
  await expect(page.locator("#create-show-password")).not.toBeChecked();

  await page.locator("#create-password").fill("matching-secret");
  await page.locator("#create-password-confirm").fill("matching-secret");
  await page.locator("#create-show-password").check();
  await expect(page.locator("#create-password")).toHaveAttribute("type", "text");
  await page.locator("#start-create").click();
  await expect(page.locator("#create-password")).toHaveValue("");
  await expect(page.locator("#create-password-confirm")).toHaveValue("");
  await expect(page.locator("#create-password")).toHaveAttribute("type", "password");
  await expect(page.locator("#create-show-password")).not.toBeChecked();
});

test("secondary GUI surfaces have visible, bounded controls", async ({ page }) => {
  test.setTimeout(120_000);

  await openDevSurface(page, "preferences");
  await expect(page.getByRole("dialog", { name: "Options" })).toBeVisible();
  await expect(page.locator("[data-pref-page='folders']")).toBeVisible();
  await expect(page.locator("[data-pref-page-target='folders']")).toHaveAttribute("aria-selected", "true");
  await captureAndScan(page, "10-preferences-dialog");

  await selectRadixOption(page, "#pref-output-location", "Specified path");
  await expect(page.locator("#preferences-save")).toBeDisabled();
  const longCustomOutputPath = "C:/Users/frankzhu/Documents/Projects/ZManager/Exports/Quarterly/Archive Output";
  await page.locator("#pref-custom-output").fill(longCustomOutputPath);
  await expect(page.locator("#pref-custom-output")).toHaveValue(longCustomOutputPath);
  await expect(page.locator("#preferences-save")).toBeEnabled();
  await page.locator("#pref-custom-output").blur();
  await expect(page.locator("#pref-custom-output")).not.toHaveValue(longCustomOutputPath);
  await captureAndScan(page, "30-preferences-custom-output");
  await closeDevSurface(page);

  await openDevSurface(page, "about");
  await expect(page.getByRole("dialog", { name: "About ZManager" })).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as Window & { __copiedDiagnostics?: string }).__copiedDiagnostics = text;
        },
      },
    });
  });
  await page.locator("#copy-diagnostics").click();
  const copiedDiagnostics = await page.evaluate(() => (window as Window & { __copiedDiagnostics?: string }).__copiedDiagnostics ?? "");
  const visibleDiagnostics = await page.locator("#about-diagnostics").evaluate((element) => {
    const lines: string[] = [];
    for (const group of element.querySelectorAll<HTMLElement>("[data-diagnostics-group]")) {
      const title = group.querySelector("h3")?.textContent?.trim();
      if (title) {
        lines.push(title);
      }
      for (const row of group.querySelectorAll("dl > div")) {
        const label = row.querySelector("dt")?.textContent?.trim();
        const value = row.querySelector("dd")?.textContent?.trim();
        if (label && value) {
          lines.push(`${label}: ${value}`);
        }
      }
      lines.push("");
    }
    return lines.join("\n").trim();
  });
  expect(copiedDiagnostics).toBe(visibleDiagnostics);
  expect(copiedDiagnostics).not.toContain("customOutputFolderPath");
  expect(copiedDiagnostics).not.toContain("password");
  expect(copiedDiagnostics).not.toContain("C:/Users/");
  await expect(page.locator("#copy-diagnostics")).toHaveText("Copy Diagnostics", { timeout: 2000 });
  await captureAndScan(page, "11-about-dialog");
  await closeDevSurface(page);

  await page.getByRole("tab", { name: "Extract" }).click();
  await page.locator("#archive-empty-state").click({ button: "right", position: { x: 20, y: 20 } });
  await expect(page.locator("#context-menu")).toBeVisible();
  await expect(page.locator("#context-menu [data-context-action='open-archive']")).toContainText("Open Archive");
  await captureAndScan(page, "13-extract-empty-context-menu");
  await page.locator("#context-menu [data-context-action='open-archive']").click();
  await expect(page.locator("#workspace-status")).toContainText("Native dialogs are unavailable in browser preview.");

  await loadArchiveWithIcons(page);
  await expect(page.locator('tr[data-entry-path="documents"]')).toBeVisible();
  await expect(page.locator("#details-content [data-copy-value='ZIP']")).toBeVisible();
  await expect(page.locator("#details-content [data-copy-value='5']")).toBeVisible();
  await captureAndScan(page, "14-extract-archive-details");

  await page.locator("th[data-column-id='name']").click({ button: "right" });
  await expect(page.locator("#context-menu")).toBeVisible();
  await expect(page.locator("#context-menu")).toContainText("Sort Ascending");
  await expect(page.locator("#context-menu")).toContainText("Choose Columns");
  await expect(page.locator("#context-menu [data-context-action='reset-columns']")).toContainText("Reset columns");
  await captureAndScan(page, "15-column-context-menu");
  await page.keyboard.press("Escape");
  await expect(page.locator("#context-menu")).toBeHidden();

  // Use a real context-menu gesture here. Shift+F10 is a Windows-specific
  // keyboard chord and is not emitted consistently by macOS Chromium.
  await page.locator("th[data-column-id='modified']").click({ button: "right" });
  await expect(page.locator("#context-menu")).toBeVisible();
  await page.locator("#context-menu [data-context-action='toggle-column'][data-column-id='mode']").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("th[data-column-id='mode']")).toBeVisible();
  await page.locator("th[data-column-id='mode']").click({ button: "right" });
  await page.locator("#context-menu [data-context-action='reset-columns']").click();
  await expect(page.locator("#context-menu")).toBeHidden();

  await page.locator('tr[data-entry-path="documents"] [data-row-primary]').click();
  await page.locator('tr[data-entry-path="images"] [data-row-primary]').click({ modifiers: ["ControlOrMeta"] });
  await expect(page.locator('tr[data-entry-path="documents"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('tr[data-entry-path="images"]')).toHaveAttribute("aria-selected", "true");
  await page.locator('tr[data-entry-path="documents"]').click({ button: "right" });
  await expect(page.locator("#context-menu")).toBeVisible();
  const multiMenuLabels = page.locator("#context-menu [data-context-action]:visible");
  await expect(multiMenuLabels.nth(0)).toHaveText("Extract Selected");
  await expect(multiMenuLabels.nth(1)).toHaveText("Extract Here");
  await expect(multiMenuLabels.nth(2)).toHaveText("Test");
  await expect(multiMenuLabels.nth(3)).toHaveText("Properties");
  await page.keyboard.press("Escape");
  await captureAndScan(page, "16-multi-selection-details");

  await openDevSurface(page, "info");
  const selectionPropertiesDialog = page.getByRole("dialog", { name: "Selection Properties" });
  await expect(selectionPropertiesDialog).toBeVisible();
  await expect(selectionPropertiesDialog.getByRole("button", { name: "Archive Info" })).toBeVisible();
  await captureAndScan(page, "17-multi-selection-info-dialog");
  await page.keyboard.press("Escape");
  await expect(selectionPropertiesDialog).toBeHidden();
  await expect(page.locator('tr[data-entry-path="images"]')).toBeFocused();

  await page.locator('tr[data-entry-path="images"] [data-row-primary]').dblclick();
  await expect(page.locator('tr[data-entry-path="images/product-screenshot.png"]')).toBeVisible();
  await page.locator('tr[data-entry-path="images/product-screenshot.png"] [data-row-primary]').click();
  await captureAndScan(page, "18-image-entry-details");

  await openDevSurface(page, "info");
  const entryInfoDialog = page.getByRole("dialog", { name: "Entry Info" });
  await expect(entryInfoDialog).toBeVisible();
  await captureAndScan(page, "19-image-entry-info-dialog");
  await entryInfoDialog.getByRole("button", { name: "Close" }).click();
  await expect(entryInfoDialog).toBeHidden();
  await expect(page.locator('tr[data-entry-path="images/product-screenshot.png"]')).toBeFocused();

  await page.locator("#search-entries").fill("missing-entry");
  await expect(page.locator("#search-submit")).toBeVisible();
  await expect(page.locator("#clear-search")).toBeEnabled();
  await expect(page.locator("#search-count")).toHaveText("0 results");
  await expect(page.locator("#entry-table-body [data-empty-table-row]")).toContainText('No entries match "missing-entry".');
  await expect(page.locator("#details-content")).toContainText("Selection not visible in current search");
  await captureAndScan(page, "20-search-empty-results");

  await page.locator("#clear-search").click();
  await expect(page.locator("#search-entries")).toHaveValue("");
  await expect(page.locator('tr[data-entry-path="images/product-screenshot.png"]')).toBeVisible();
  await expect(page.locator('tr[data-entry-path="images/product-screenshot.png"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#details-content")).toContainText("product-screenshot.png");
  await expect(page.locator("#status-selection-count")).toContainText("1 / 1");
  await expect(page.locator("#toolbar-flatView")).toHaveAttribute("aria-pressed", "false");
  await page.locator("summary", { hasText: "View" }).click();
  await expect(page.locator("#menu-command-flatView")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#menu-command-flatView").click();
  await expect(page.locator("#toolbar-flatView")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#menu-command-flatView")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('tr[data-entry-path="documents/notes.txt"] [data-row-secondary]')).toContainText("documents/notes.txt");
  await captureAndScan(page, "31-flat-view-with-icons");
  await page.locator('tr[data-entry-path="documents"] [data-row-primary]').dblclick();
  await expect(page.locator('tr[data-entry-path="documents/notes.txt"]')).toBeVisible();
});

test("Preferences invalid output keeps scroll ownership at tall and compact sizes", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 1000 });
  await openDevSurface(page, "preferences");
  const tallBefore = await measureDesktopDialogLayout(page);
  await page.locator("#pref-output-location").click();
  await page.locator('[role="option"][data-value="customFolder"]').click();
  await expect(page.locator("#pref-custom-output-validation")).toBeVisible();
  const tallAfter = await measureDesktopDialogLayout(page);
  expect(tallAfter.surface.height).toBeGreaterThan(tallBefore.surface.height);
  expect(tallAfter.content.scrollHeight).toBeLessThanOrEqual(tallAfter.content.clientHeight + 2);
  await page.screenshot({ path: `${auditDir}/38-preferences-invalid-tall.png`, fullPage: false });
  await expect(page).toHaveScreenshot("38-preferences-invalid-tall.png");
  await auditDesktopDialogLayout(page);
  await closeDevSurface(page);

  await page.setViewportSize({ width: 760, height: 540 });
  await openDevSurface(page, "preferences");
  await page.locator("#pref-output-location").click();
  await page.locator('[role="option"][data-value="customFolder"]').click();
  await expect(page.locator("#pref-custom-output-validation")).toBeVisible();
  const compact = await measureDesktopDialogLayout(page);
  expect(compact.surface.bottom).toBeLessThanOrEqual(540 + 2);
  expect(compact.surface.height).toBeLessThanOrEqual(492 + 2);
  expect(compact.content.overflowY).toMatch(/auto|scroll/);
  await page.screenshot({ path: `${auditDir}/39-preferences-invalid-compact.png`, fullPage: false });
  await expect(page).toHaveScreenshot("39-preferences-invalid-compact.png");
  await auditDesktopDialogLayout(page);

  await closeDevSurface(page);
  await page.setViewportSize({ width: 1000, height: 700 });
  await openDevSurface(page, "preferences");
  await page.locator("#pref-output-location").click();
  await page.locator('[role="option"][data-value="customFolder"]').click();
  await expect(page.locator("#pref-custom-output-validation")).toBeVisible();
  const medium = await measureDesktopDialogLayout(page);
  expect(medium.surface.bottom).toBeLessThanOrEqual(700 + 2);
  expect(medium.content.overflowY).toMatch(/auto|scroll/);
  await auditDesktopDialogLayout(page);

  await closeDevSurface(page);
  await page.setViewportSize({ width: 1200, height: 1000 });
  await openDevSurface(page, "preferences");
  await page.locator('[data-pref-page-target="interface"]').click();
  await page.locator("#pref-language").click();
  await page.locator('[role="option"][data-value="zh-CN"]').click();
  await page.locator("#preferences-save").click();
  await expect(page.locator('[data-dialog-surface]')).toBeHidden();
  await expect(page.locator('[data-locale="zh-CN"]')).toHaveCount(1);

  await openDevSurface(page, "preferences");
  await page.locator("#pref-output-location").click();
  await page.locator('[role="option"][data-value="customFolder"]').click();
  await expect(page.locator("#pref-custom-output-validation")).toBeVisible();
  const zhTall = await measureDesktopDialogLayout(page);
  expect(zhTall.surface.bottom).toBeLessThanOrEqual(1000 + 2);
  expect(zhTall.content.scrollHeight).toBeLessThanOrEqual(zhTall.content.clientHeight + 2);
  await auditDesktopDialogLayout(page);
});

test("Preferences live validation preserves selector focus and accessible error wiring", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await openDevSurface(page, "preferences");

  const outputLocation = page.locator("#pref-output-location");
  await outputLocation.click();
  await page.locator('[role="option"][data-value="customFolder"]').click();

  const customOutput = page.locator("#pref-custom-output");
  await expect(customOutput).toHaveAttribute("aria-invalid", "true");
  await expect(customOutput).toHaveAttribute("aria-describedby", /pref-custom-output-validation/);
  await expect(page.locator("#pref-custom-output-validation")).toBeVisible();
  await expect(outputLocation).toBeFocused();
  await auditDesktopDialogLayout(page);
});

test("Account modal keeps its tab content inside the shared shell", async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 540 });
  await page.getByRole("button", { name: "TZAP Account" }).click();

  const dialog = page.getByRole("dialog", { name: /TZAP Account & Identity/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("[data-account-tab-navigation]")).toBeVisible();
  await expect(dialog.getByRole("tab", { name: /Contacts & Keys/ })).toBeVisible();

  const initial = await measureDesktopDialogLayout(page);
  expect(initial.surface.bottom).toBeLessThanOrEqual(540 + 2);
  expect(initial.content.overflowY).toMatch(/auto|scroll/);
  await auditDesktopDialogLayout(page);

  await dialog.getByRole("tab", { name: /Contacts & Keys/ }).click();
  await expect(dialog.locator("[data-account-tab-navigation]")).toBeVisible();
  await auditDesktopDialogLayout(page);
});

test("Account Escape restores focus to the launching toolbar control", async ({ page }) => {
  const accountButton = page.getByRole("button", { name: "TZAP Account" });
  await accountButton.focus();
  await accountButton.click();

  const dialog = page.getByRole("dialog", { name: /TZAP Account & Identity/ });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(accountButton).toBeFocused();
});

test("error-surface fixtures cover account, create, and archive ownership", async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 540 });

  await setErrorSurfaceFixture(page, "account-notice-long-contacts");
  const accountDialog = page.getByRole("dialog", { name: /TZAP Account & Identity/ });
  await expect(accountDialog).toBeVisible();
  await expect(accountDialog.getByRole("status")).toContainText("Fixture notice");
  await accountDialog.getByRole("tab", { name: /Contacts & Keys/ }).click();
  await expect(accountDialog.getByText(/Fixture contact 18/)).toBeVisible();
  await auditDesktopDialogLayout(page);
  await accountDialog.getByRole("button", { name: "Close account" }).click();
  await expect(accountDialog).toBeHidden();

  await setErrorSurfaceFixture(page, "create-plan-error");
  await expect(page.locator("#create-plan-summary")).toHaveAttribute("role", "alert");
  await expect(page.locator("#create-plan-summary")).toContainText("Refresh the plan");
  await expect(page.locator("[data-dialog-surface]")).toHaveCount(0);
  await auditWorkspaceContentLayout(page);

  await setErrorSurfaceFixture(page, "archive-listing-error");
  await expect(page.locator("#browse-message")).toHaveAttribute("role", "alert");
  await expect(page.locator("#browse-message")).toContainText("Fixture error");
  await expect(page.locator("[data-dialog-surface]")).toHaveCount(0);
  await auditWorkspaceContentLayout(page);
});

test("core surfaces remain bounded in a compact viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await expect(page.locator("#create-format")).toBeVisible();
  await expect(page.locator("#create-compression-level")).toBeVisible();
  await captureAndScan(page, "21-compact-compress-empty");

  await dropFiles(page, ["quarterly-report.pdf", "photos-folder"]);
  await waitForCompressSources(page);
  await expect(page.locator("#create-format")).toBeVisible();
  await expect(page.locator("#create-compression-level")).toBeVisible();
  await captureAndScan(page, "22-compact-compress-with-sources");

  await page.getByRole("tab", { name: "Extract" }).click();
  await loadArchiveWithIcons(page);
  await captureAndScan(page, "23-compact-extract-loaded");

  await openDevSurface(page, "preferences");
  await captureAndScan(page, "24-compact-preferences-dialog");
  await closeDevSurface(page);
});

test("minimum-size visual surfaces stay within the app bounds", async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 540 });
  await expect(page.locator("#create-format")).toBeVisible();
  await expect(page.locator("#create-compression-level")).toBeVisible();
  await captureAndScan(page, "32-min-compress-empty");

  await dropFiles(page, [
    "very-long-file-name-that-should-not-break-the-compress-table-layout-report-final.pdf",
    "deeply-nested-folder-with-a-long-name",
  ]);
  await waitForCompressSources(page);
  await expect(page.locator("#create-format")).toBeVisible();
  await expect(page.locator("#create-compression-level")).toBeVisible();
  await captureAndScan(page, "33-min-compress-long-sources");

  await expect(page.locator("#compress-options-panel")).toBeVisible();
  await expect(page.locator("#create-format")).toBeVisible();
  await expect(page.locator("#create-compression-level")).toBeVisible();
  await page.locator("#start-create").focus();
  await captureAndScan(page, "34-min-create-dialog");

  await page.getByRole("tab", { name: "Extract" }).click();
  await loadArchiveWithIcons(page);
  await captureAndScan(page, "35-min-extract-loaded");

});

async function captureAndScan(page: Page, name: string) {
  await page.screenshot({ path: `${auditDir}/${name}.png`, fullPage: false });
  const problems = await scanVisibleLayout(page);
  expect(problems, `${name} layout problems`).toEqual([]);
  if (await page.locator("[data-dialog-surface]").count()) {
    await auditDesktopDialogLayout(page);
  }
  await expect(page).toHaveScreenshot(`${name}.png`);
}

async function captureHero(page: Page, name: string, selector: string) {
  const target = page.locator(selector);
  await expect(target).toBeVisible();
  await target.screenshot({ path: `${auditDir}/${name}.png` });
  await expect(target).toHaveScreenshot(`${name}.png`);
}

async function captureReadmeHero(page: Page, name: string, selector: string) {
  const originalStatus = await page.locator("#workspace-status").evaluate((element) => element.textContent ?? "");
  try {
    await page.locator("#workspace-status").evaluate((element) => {
      element.textContent = "Ready.";
    });
    await captureHero(page, name, selector);
    const problems = await scanVisibleLayout(page);
    expect(problems, `${name} layout problems`).toEqual([]);
  } finally {
    await page.locator("#workspace-status").evaluate((element, text) => {
      element.textContent = text;
    }, originalStatus);
  }
}

async function loadArchiveWithIcons(page: Page) {
  await page.evaluate((fixture) => window.__zmanagerDev?.loadArchiveFixture(fixture), archiveFixture);
  await page.evaluate((fixtures) => window.__zmanagerDev?.setSystemIconFixtures(fixtures), {
    directory: nativeFolderIcon,
    "file:.pdf": nativeFileIcon,
    "file:.png": nativeImageIcon,
    "file:.txt": nativeFileIcon,
    "file:.zip": nativeFileIcon,
  });
}

async function openDevSurface(page: Page, surface: "about" | "preferences" | "info") {
  await page.evaluate((surfaceName) => window.__zmanagerDev?.openSurface(surfaceName), surface);
}

async function setErrorSurfaceFixture(
  page: Page,
  fixture: "account-notice-long-contacts" | "create-plan-error" | "archive-listing-error",
) {
  await page.evaluate((fixtureName) => {
    const dev = window.__zmanagerDev as unknown as {
      setErrorSurfaceFixture?: (name: string) => void;
    };
    dev.setErrorSurfaceFixture?.(fixtureName);
  }, fixture);
}

async function closeDevSurface(page: Page) {
  await page.evaluate(() => window.__zmanagerDev?.closeModal());
}

async function waitForCompressSources(page: Page) {
  await expect(
    page.locator("#compress-source-body tr[data-compress-folder-row], #compress-source-body tr[data-compress-entry-row]").first(),
  ).toBeVisible();
  await expect(page.locator("#start-create")).toBeEnabled();
  await expect(page.locator("#start-create")).toBeEnabled();
}

async function expectOverlayInsideWorkspaceBody(page: Page) {
  const bounds = await page.evaluate(() => {
    const overlay = document.querySelector("#drop-overlay")?.getBoundingClientRect();
    const body = document.querySelector("[data-workspace-browser]")?.getBoundingClientRect();
    const status = document.querySelector("[data-shell-chrome='status']")?.getBoundingClientRect();
    if (!overlay || !body || !status) {
      return null;
    }
    return {
      overlay: {
        left: overlay.left,
        top: overlay.top,
        right: overlay.right,
        bottom: overlay.bottom,
      },
      body: {
        left: body.left,
        top: body.top,
        right: body.right,
        bottom: body.bottom,
      },
      statusTop: status.top,
    };
  });
  expect(bounds).not.toBeNull();
  expect(bounds!.overlay.left).toBeGreaterThanOrEqual(bounds!.body.left);
  expect(bounds!.overlay.top).toBeGreaterThanOrEqual(bounds!.body.top);
  expect(bounds!.overlay.right).toBeLessThanOrEqual(bounds!.body.right);
  expect(bounds!.overlay.bottom).toBeLessThanOrEqual(bounds!.body.bottom);
  expect(bounds!.overlay.bottom).toBeLessThanOrEqual(bounds!.statusTop);
}

async function dropFiles(page: Page, names: string[]) {
  await page.evaluate((fileNames) => {
    const dataTransfer = new DataTransfer();
    for (const name of fileNames) {
      dataTransfer.items.add(new File(["fixture"], name));
    }
    const event = new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer,
    });
    document.querySelector("[data-runtime-bridge-state]")?.dispatchEvent(event);
  }, names);
}

async function dragFiles(page: Page, names: string[]) {
  await page.evaluate((fileNames) => {
    const dataTransfer = new DataTransfer();
    for (const name of fileNames) {
      dataTransfer.items.add(new File(["fixture"], name));
    }
    const event = new DragEvent("dragenter", {
      bubbles: true,
      cancelable: true,
      dataTransfer,
    });
    document.querySelector("[data-runtime-bridge-state]")?.dispatchEvent(event);
  }, names);
}

async function startTableColumnDrag(
  page: Page,
  sourceSelector: string,
  targetSelector: string,
) {
  const source = await page.locator(sourceSelector).boundingBox();
  const target = await page.locator(targetSelector).boundingBox();
  if (!source || !target) {
    throw new Error(
      `Unable to locate column drag geometry: ${sourceSelector} -> ${targetSelector}`,
    );
  }

  await page.mouse.move(
    source.x + source.width / 2,
    source.y + source.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    target.x + target.width / 2,
    target.y + target.height / 2,
    { steps: 8 },
  );
}

async function resizeTableColumn(
  page: Page,
  resizerSelector: string,
  deltaX: number,
) {
  const resizer = await page.locator(resizerSelector).boundingBox();
  if (!resizer) {
    throw new Error(`Unable to locate column resizer: ${resizerSelector}`);
  }

  const startX = resizer.x + resizer.width / 2;
  const startY = resizer.y + resizer.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY, { steps: 5 });
  await page.mouse.up();
}

async function dragLeave(page: Page) {
  await page.evaluate(() => {
    const event = new DragEvent("dragleave", {
      bubbles: true,
      cancelable: true,
      relatedTarget: document.body,
    });
    document.querySelector("[data-runtime-bridge-state]")?.dispatchEvent(event);
  });
}

async function dragFilesThroughNestedTargets(page: Page, names: string[]) {
  await page.evaluate((fileNames) => {
    const dataTransfer = new DataTransfer();
    for (const name of fileNames) {
      dataTransfer.items.add(new File(["fixture"], name));
    }

    const app = document.querySelector("[data-runtime-bridge-state]");
    const nestedTarget = document.querySelector("[data-workspace-browser]");
    app?.dispatchEvent(new DragEvent("dragenter", {
      bubbles: true,
      cancelable: true,
      dataTransfer,
    }));
    nestedTarget?.dispatchEvent(new DragEvent("dragenter", {
      bubbles: true,
      cancelable: true,
      dataTransfer,
    }));
    app?.dispatchEvent(new DragEvent("dragleave", {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      relatedTarget: document.body,
    }));
  }, names);
}

async function scanVisibleLayout(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const visibleLabel = (element: HTMLElement): string =>
      (
        element.getAttribute("aria-label") ||
        element.innerText ||
        element.textContent ||
        element.getAttribute("placeholder") ||
        element.getAttribute("title") ||
        element.tagName.toLowerCase()
      ).trim().replace(/\s+/g, " ");

    const overlapArea = (first: DOMRect, second: DOMRect): number => {
      const width = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
      const height = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
      return width * height;
    };

    const nearestClippingAncestor = (element: HTMLElement): HTMLElement | null => {
      let parent = element.parentElement;
      while (parent && parent !== document.body) {
        const style = window.getComputedStyle(parent);
        const clips = /(auto|scroll|hidden|clip)/.test(`${style.overflow}${style.overflowY}${style.overflowX}`);
        if (clips) {
          return parent;
        }
        parent = parent.parentElement;
      }
      return null;
    };

    const clippingAncestorFor = (element: HTMLElement): HTMLElement | null => {
      const rect = element.getBoundingClientRect();
      let parent = element.parentElement;
      while (parent && parent !== document.body) {
        const style = window.getComputedStyle(parent);
        const clips = /(auto|scroll|hidden|clip)/.test(`${style.overflow}${style.overflowY}${style.overflowX}`);
        if (clips) {
          const parentRect = parent.getBoundingClientRect();
          const visibleArea = Math.max(0, Math.min(rect.right, parentRect.right) - Math.max(rect.left, parentRect.left)) *
            Math.max(0, Math.min(rect.bottom, parentRect.bottom) - Math.max(rect.top, parentRect.top));
          const elementArea = rect.width * rect.height;
          const visibleRatio = elementArea > 0 ? visibleArea / elementArea : 0;
          const intentionallyScrollableDetail = element.closest("#details-content") !== null &&
            (
              parent.id === "details-content" ||
              parent.classList.contains("details-pane")
            );
          const isClipped = !intentionallyScrollableDetail &&
            visibleRatio > 0 &&
            visibleRatio < 0.98 &&
            (
            rect.left < parentRect.left - 1 ||
            rect.right > parentRect.right + 1
            );
          if (isClipped) {
            return parent;
          }
        }
        parent = parent.parentElement;
      }
      return null;
    };

    const selector = [
      "button",
      "input",
      "select",
      "summary",
      "th",
      ".pane-resizer",
      ".pane-resizer-grip",
      "h1",
      "h2",
      ".compress-empty-state strong",
      ".compress-empty-state span",
      ".archive-empty-copy h2",
      ".archive-empty-copy p",
      ".archive-empty-hint",
      ".table-pane-header p",
      ".empty-pane p",
      ".details-pane dt",
      ".details-pane dd",
      ".detail-title span",
      ".compress-options-summary-title",
      ".compress-options-summary-description",
      ".compress-options-panel .form-grid label > span",
      ".compress-options-panel .toggle-line span",
      "#workspace-status",
      ".status-bar button",
      "#context-menu [role='menuitem']",
    ].join(",");

    const isRendered = (element: HTMLElement): boolean => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        !element.hidden &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };

    const isHitTestVisible = (element: HTMLElement): boolean => {
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      if (centerX < 0 || centerY < 0 || centerX > window.innerWidth || centerY > window.innerHeight) {
        return false;
      }
      const hitElement = document.elementFromPoint(centerX, centerY);
      return hitElement !== null && (element === hitElement || element.contains(hitElement) || hitElement.contains(element));
    };

    const activeModal = document.querySelector<HTMLElement>(".dialog-backdrop:not([hidden])");
    const elements = Array.from(document.querySelectorAll<HTMLElement>(selector))
      .filter((element) => isRendered(element) && (!activeModal || activeModal.contains(element)));

    const problems: string[] = [];

    const documentWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    if (documentWidth > window.innerWidth + 1) {
      problems.push(`page horizontal overflow ${documentWidth} > ${window.innerWidth}`);
    }

    for (const element of elements) {
      const measuredElement = element.matches("th")
        ? (element.querySelector<HTMLElement>(".column-header-label") ?? element)
        : element;
      const label = visibleLabel(measuredElement);
      const insideCommandOverflow = element.closest("[data-shell-chrome='toolbar']") !== null;
      const insideContextMenuOverflow = element.closest("#context-menu") !== null;
      const insideStatusOverflow = element.closest("[data-shell-chrome='status']") !== null;
      const insideTableOverflow = element.closest("[data-archive-table-shell],[data-create-table-shell]") !== null;
      const insideDetailsOverflow = element.closest("#details-pane") !== null;
      const insideIntentionalOverflow = insideCommandOverflow || insideContextMenuOverflow || insideStatusOverflow || insideTableOverflow || insideDetailsOverflow;
      const clippedInline = measuredElement.scrollWidth > measuredElement.clientWidth + 1;
      const clippedBlock = measuredElement.scrollHeight > measuredElement.clientHeight + 1;
      if (label && !insideIntentionalOverflow && (clippedInline || clippedBlock)) {
        problems.push(`clipped ${element.tagName.toLowerCase()} "${label}"`);
      }
      const clippingAncestor = clippingAncestorFor(element);
      if (label && clippingAncestor && !insideIntentionalOverflow) {
        const ancestorLabel = clippingAncestor.id
          ? `#${clippingAncestor.id}`
          : clippingAncestor.className
            ? `.${String(clippingAncestor.className).trim().replace(/\s+/g, ".")}`
            : clippingAncestor.tagName.toLowerCase();
        problems.push(`clipped by ${ancestorLabel} ${element.tagName.toLowerCase()} "${label}"`);
      }
      const nearestClip = nearestClippingAncestor(element);
      const rect = element.getBoundingClientRect();
      if (!insideIntentionalOverflow && !nearestClip && (rect.left < -1 || rect.right > window.innerWidth + 1 || rect.top < -1 || rect.bottom > window.innerHeight + 1)) {
        problems.push(`out of viewport ${element.tagName.toLowerCase()} "${label}"`);
      }
    }

    for (const icon of Array.from(document.querySelectorAll<HTMLElement>("[data-row-icon]"))) {
      const style = window.getComputedStyle(icon);
      const rect = icon.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || rect.width === 0 || rect.height === 0) {
        continue;
      }
      const limit = 19;
      if (rect.width > limit || rect.height > limit) {
        problems.push(`oversized ${Array.from(icon.classList).join(".")} ${Math.round(rect.width)}x${Math.round(rect.height)}`);
      }
    }

    const controls = elements.filter((element) =>
      element.matches("button,input,select,summary,#context-menu [role='menuitem']") && isHitTestVisible(element),
    );

    for (let index = 0; index < controls.length; index += 1) {
      for (let nextIndex = index + 1; nextIndex < controls.length; nextIndex += 1) {
        const first = controls[index];
        const second = controls[nextIndex];
        if (first.contains(second) || second.contains(first)) {
          continue;
        }
        const firstClip = nearestClippingAncestor(first);
        const secondClip = nearestClippingAncestor(second);
        if (firstClip !== secondClip) {
          continue;
        }
        const overlap = overlapArea(first.getBoundingClientRect(), second.getBoundingClientRect());
        if (overlap > 4) {
          problems.push(`overlap "${visibleLabel(first)}" with "${visibleLabel(second)}"`);
        }
      }
    }

    return problems;
  });
}

async function installTauriStub(page: Page) {
  await page.addInitScript(() => {
    const callbacks = new Map<number, { callback: unknown; once: boolean }>();
    let callbackId = 1;
    const invoke = async (cmd: string, args: Record<string, unknown> = {}) => {
      if (cmd === "healthcheck") {
        return {
          engine: "zmanager-core",
          version: "visual-scan",
          ready: true,
          summary: "Visual scan backend stub",
          shell: "playwright",
          status: "ok",
        };
      }

      if (cmd === "project_contract") {
        return {
          commands: ["start_native_file_drag"],
          platformStrategy: "visual-scan",
          coreDependency: "stub",
          platformIntegration: {
            platform: "windows",
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
            dataUrl: entry.key === "directory"
              ? nativeFolderIcon
              : entry.key === "file:.png" || entry.key === "file:.bmp"
                ? nativeImageIcon
                : nativeFileIcon,
          })),
        };
      }

      if (cmd === "start_native_file_drag") {
        return {
          outcome: "dropped",
          draggedEntries: [],
        };
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

      throw new Error(`Unhandled Tauri command in visual scan stub: ${cmd}`);
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

    delete window.__TAURI_INTERNALS__;
    delete window.__TAURI_EVENT_PLUGIN_INTERNALS__;
    delete window.isTauri;
  });
}
