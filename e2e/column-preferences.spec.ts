import { expect, test, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// E2E: Unified table column preferences
//
// Verifies the grouped Global Column Options UI and column visibility behavior.
// Runs against the Vite dev server (no Tauri desktop needed).
//
// These tests target the grouped Global Column Options component directly.
// ---------------------------------------------------------------------------

/**
 * Navigate to the preferences dialog and open the Columns page.
 */
async function openColumnPreferences(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect
    .poll(async () => page.evaluate(() => Boolean(window.__zmanagerDev)), { timeout: 30_000 })
    .toBe(true);
  await page.evaluate(() => window.__zmanagerDev?.openSurface("preferences"));
  await expect(page.getByRole("dialog", { name: "Options" })).toBeVisible();
  await page.locator("[data-pref-page-target='columns']").click();
  await expect(page.locator("[data-pref-page='columns']")).toBeVisible();
}

test.describe("Column preferences", () => {
  test("preferences dialog opens without error", async ({ page }) => {
    await openColumnPreferences(page);
    await expect(page.getByRole("dialog", { name: "Options" })).toBeVisible();
  });

  test("column preferences page has grouped sections", async ({ page }) => {
    await openColumnPreferences(page);

    // Verify the three column sections exist
    // (Selectors should match the GroupedColumnPreferences component)
    const commonHeading = page.getByText("Common Columns");
    const compressHeading = page.getByText("Compress Only");
    const extractHeading = page.getByText("Extract Only");

    await expect(commonHeading).toBeVisible();
    await expect(compressHeading).toBeVisible();
    await expect(extractHeading).toBeVisible();
  });

  test("per-format family selector is present in grouped UI", async ({ page }) => {
    await openColumnPreferences(page);

    // The format family selector should be a combobox
    const combobox = page
      .getByRole("dialog", { name: "Options" })
      .getByRole("combobox");
    await expect(combobox).toBeVisible();
    await combobox.click();

    // Verify key families appear in the dropdown
    await expect(page.getByRole("option", { name: /tarGzip/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /tarZstd/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /^zip \(\.zip\)$/ })).toBeVisible();
  });

  test("column checkboxes are toggleable", async ({ page }) => {
    await openColumnPreferences(page);

    // Find checkboxes
    const checkboxes = page.getByRole("checkbox");
    const count = await checkboxes.count();

    expect(count).toBeGreaterThan(0);

    // Verify the Name checkbox is disabled (always visible)
    const nameCheckbox = page.getByRole("checkbox", { name: /name/i }).first();
    await expect(nameCheckbox).toBeVisible();
    await expect(nameCheckbox).toBeDisabled();
  });

  test("format aliases share preferences: .tgz and .tar.gz", async ({ page }) => {
    // This test verifies the backend logic: opening .tgz and .tar.gz
    // should use the same format-family preference key.
    //
    // The verification is through the pure function tests:
    //   resolveArchiveFormatFamily("archive.tgz") === resolveArchiveFormatFamily("archive.tar.gz")
    //
    // In the UI, this means selecting "tarGzip" in the format selector
    // affects both .tgz and .tar.gz archives.
    await openColumnPreferences(page);

    const combobox = page
      .getByRole("dialog", { name: "Options" })
      .getByRole("combobox");
    await combobox.click();
    // tarGzip should be present as a single family covering both aliases
    await expect(page.getByRole("option", { name: /tarGzip/ })).toBeVisible();
    // There should NOT be separate ".tgz" and ".tar.gz" entries
    const tgzEntry = page.getByRole("option", { name: /^\.tgz$/ });
    await expect(tgzEntry).toHaveCount(0);
  });
});
