import type { Page } from "@playwright/test";

const CALLBACK_PREFIX = "tzap://auth/callback?";

function isHostedCallback(value: string | null | undefined): value is string {
  return typeof value === "string" && value.startsWith(CALLBACK_PREFIX);
}

/**
 * Capture the callback whether the hosted page navigates the browser to the
 * custom scheme or renders a link for the operator/test to activate.
 */
export async function captureHostedCallback(page: Page, timeout = 30_000): Promise<string> {
  const requestCallback = page.waitForRequest(
    (request) => isHostedCallback(request.url()),
    { timeout },
  ).then((request) => request.url()).catch(() => null);

  const linkCallback = page.locator("[data-callback-url], a[href^='tzap://']").first()
    .waitFor({ state: "attached", timeout })
    .then(async () => {
      const callback = await page.locator("[data-callback-url], a[href^='tzap://']").first().getAttribute("data-callback-url")
        ?? await page.locator("[data-callback-url], a[href^='tzap://']").first().getAttribute("href");
      return isHostedCallback(callback) ? callback : null;
    })
    .catch(() => null);

  const callback = await Promise.race([requestCallback, linkCallback]);
  if (!callback) {
    throw new Error("hosted login did not produce a tzap:// callback link");
  }
  return callback;
}
