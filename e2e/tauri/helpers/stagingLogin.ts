import type { Locator, Page } from "@playwright/test";

const LOGIN_NAVIGATION_TIMEOUT_MS = 90_000;
const LOGIN_FORM_TIMEOUT_MS = 60_000;

export interface StagingLoginForm {
  username: Locator;
  password: Locator;
}

/** Wait for the staging auth page and its login controls on contended CI runners. */
export async function openStagingLogin(page: Page, launchUrl: string): Promise<StagingLoginForm> {
  await page.goto(launchUrl, { waitUntil: "commit", timeout: LOGIN_NAVIGATION_TIMEOUT_MS });

  const username = page.locator("input[type=email], input[name=username], input[name=email], input[type=text]").first();
  const password = page.locator("input[name=password], input[type=password]").first();
  try {
    await Promise.all([
      username.waitFor({ state: "visible", timeout: LOGIN_FORM_TIMEOUT_MS }),
      password.waitFor({ state: "visible", timeout: LOGIN_FORM_TIMEOUT_MS }),
    ]);
  } catch {
    const url = new URL(page.url());
    const [inputCount, buttonCount] = await Promise.all([
      page.locator("input").count(),
      page.locator("button").count(),
    ]);
    throw new Error(`staging login form was not visible (path=${url.pathname}, inputs=${inputCount}, buttons=${buttonCount})`);
  }

  return { username, password };
}
