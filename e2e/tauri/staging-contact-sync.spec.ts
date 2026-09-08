import { chromium as playwrightChromium, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

type HostedAuthLaunch = Readonly<{
  launchUrl: string;
  state: string;
  expiresAtUnixSeconds: number;
}>;

type AccountSnapshot = Readonly<{
  authStatus: string;
  contacts: ReadonlyArray<Readonly<{
    contactId: string;
    displayName: string;
    recipientPublicKeyFingerprint: string;
    phoneSourced: boolean;
    verificationState: string;
  }>>;
}>;

type ExpectedContact = Readonly<{
  contact_id: string;
  display_name: string;
  recipient_public_key_fingerprint: string;
  source: "phone_sync";
}>;

const stagingEnabled = process.env.DESKTOP_STAGING_E2E === "1";
const stagingIt = stagingEnabled ? it : xit;
const environment = process.env.DESKTOP_STAGING_ENVIRONMENT ?? "staging";
const audience = process.env.DESKTOP_STAGING_AUDIENCE ?? "sign.tzap.org";
const expectedContactsPath = process.env.DESKTOP_STAGING_EXPECTED_CONTACTS;
const expectedContactsAfterPath = process.env.DESKTOP_STAGING_EXPECTED_CONTACTS_AFTER;

async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  return browser.tauri.execute(
    async ({ core }, commandName, commandArgs) => core.invoke(commandName, commandArgs),
    command,
    args,
  ) as Promise<T>;
}

async function readExpectedContacts(path: string): Promise<ExpectedContact[]> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("Expected contacts manifest must be a JSON array.");
  return parsed.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) throw new Error(`Expected contacts manifest entry ${index} is invalid.`);
    const value = entry as Record<string, unknown>;
    if (
      typeof value.contact_id !== "string" ||
      typeof value.display_name !== "string" ||
      typeof value.recipient_public_key_fingerprint !== "string" ||
      value.source !== "phone_sync"
    ) {
      throw new Error(`Expected contacts manifest entry ${index} is missing a non-secret contact field.`);
    }
    return value as ExpectedContact;
  });
}

async function completeHostedAuth(): Promise<void> {
  const user = process.env.DESKTOP_STAGING_USER;
  const password = process.env.DESKTOP_STAGING_PASSWORD;
  if (!user || !password) throw new Error("DESKTOP_STAGING_USER and DESKTOP_STAGING_PASSWORD are required.");

  const launch = await invoke<HostedAuthLaunch>("account_begin_hosted_auth", {
    request: { environment, audience },
  });
  const browserContext = await playwrightChromium.launch({ headless: true });
  try {
    const page = await browserContext.newPage();
    const callbackUrlPromise = waitForHostedCallback(page);
    await page.goto(launch.launchUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
    await page.locator('input[type="email"]').fill(user);
    await page.locator('input[type="password"]').fill(password);
    await page.locator('button[type="submit"]').click();

    const callbackUrl = await callbackUrlPromise;
    const callback = new URL(callbackUrl);
    if (callback.searchParams.get("state") !== launch.state) throw new Error("Hosted callback state did not match the launch state.");
    const handoffCode = callback.searchParams.get("handoff_code");
    if (!handoffCode) throw new Error("Hosted callback did not contain a handoff code.");

    await browser.tauri.execute(async ({ core }, payload) => {
      await core.invoke("plugin:event|emit", {
        event: "zmanager-native-inbound-event",
        payload,
      });
    }, {
      version: 1,
      eventId: `staging-hosted-auth-${randomUUID()}`,
      kind: "hostedAuthCallback",
      timestampUnixMs: Date.now(),
      idempotencyKey: launch.state,
      payload: {
        state: launch.state,
        result: "completed",
        handoffCode,
        callbackUrl: "tzap://auth/callback",
      },
    });
  } finally {
    await browserContext.close();
  }

  await browser.waitUntil(async () => (await invoke<AccountSnapshot>("account_snapshot")).authStatus === "signedIn", {
    timeout: 60_000,
    interval: 500,
  });
}

function waitForHostedCallback(page: Page): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for the hosted auth callback.")), 120_000);
    page.on("request", (request) => {
      const url = request.url();
      if (!url.startsWith("tzap://auth/callback?")) return;
      clearTimeout(timeout);
      resolve(url);
    });
  });
}

async function openContacts(): Promise<void> {
  await $("button[aria-label='TZAP Account']").click();
  const dialog = await $("[role='dialog'][aria-labelledby='account-title']");
  await dialog.waitForDisplayed();
  await dialog.$("button=Contacts & Keys").click();
  await browser.waitUntil(async () => {
    const body = await browser.execute(() => document.body.textContent ?? "");
    return body.includes("Download from Phone") || body.includes("Sign in to sync contacts");
  }, { timeout: 10_000, interval: 250 });
}

async function renderedContactRows(): Promise<string[]> {
  return browser.execute(() => Array.from(document.querySelectorAll("article")).map((row) => row.textContent ?? ""));
}

async function syncContacts(): Promise<void> {
  await $("button=Download from Phone").click();
  await browser.waitUntil(async () => (await browser.execute(() => document.body.textContent ?? "")).includes("Contacts synced:"), {
    timeout: 60_000,
    interval: 500,
  });
}

async function diagnoseRemoteCards(): Promise<void> {
  const backupPath = process.env.DESKTOP_STAGING_CONTACT_BACKUP_DIAGNOSTIC;
  if (!backupPath) return;
  const backup = JSON.parse(await readFile(backupPath, "utf8")) as { payload?: { contacts?: Array<{ card?: unknown }> } };
  for (const [index, entry] of (backup.payload?.contacts ?? []).entries()) {
    if (!entry.card) continue;
    try {
      await invoke("account_inspect_contact_card", { request: { contactCard: entry.card } });
      console.log(`contact_card_diagnostic=${index}:accepted`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`contact_card_diagnostic=${index}:rejected:${message}`);
    }
  }
}

async function assertExpectedContacts(expected: ExpectedContact[]): Promise<void> {
  const rows = await renderedContactRows();
  for (const contact of expected) {
    expect(rows.some((row) =>
      row.includes(contact.display_name) &&
      row.includes(contact.recipient_public_key_fingerprint) &&
      row.includes("From Phone") &&
      !row.includes("Status unavailable")
    )).toBeTrue();
  }
  const snapshot = await invoke<AccountSnapshot>("account_snapshot");
  for (const contact of expected) {
    expect(snapshot.contacts.some((actual) =>
      actual.contactId === contact.contact_id &&
      actual.displayName === contact.display_name &&
      actual.recipientPublicKeyFingerprint === contact.recipient_public_key_fingerprint &&
      actual.phoneSourced
    )).toBeTrue();
  }
}

describe("staging hosted contact sync", () => {
  let expected: ExpectedContact[] = [];

  stagingIt("signs in through the browser handoff, syncs phone contacts, and is idempotent", async () => {
    if (!expectedContactsPath) throw new Error("DESKTOP_STAGING_EXPECTED_CONTACTS is required for staging contact-sync E2E.");
    expected = await readExpectedContacts(expectedContactsPath);
    await invoke("account_forget");
    await completeHostedAuth();
    await openContacts();
    await diagnoseRemoteCards();
    await syncContacts();
    await assertExpectedContacts(expected);

    const before = await renderedContactRows();
    await syncContacts();
    const after = await renderedContactRows();
    expect(after).toEqual(before);
    await assertExpectedContacts(expected);
  }, 180_000);

  stagingIt("reconciles a changed phone snapshot", async () => {
    if (!expectedContactsAfterPath) throw new Error("DESKTOP_STAGING_EXPECTED_CONTACTS_AFTER is required for mutation coverage.");
    const after = await readExpectedContacts(expectedContactsAfterPath);
    await syncContacts();
    await assertExpectedContacts(after);
  }, 120_000);

  stagingIt("keeps cached contacts during session recovery", async () => {
    await invoke("account_forget");
    expect((await invoke<AccountSnapshot>("account_snapshot")).contacts.length).toBeGreaterThan(0);
    await browser.refresh();
    await openContacts();
    expect(await $("button=Sign in to sync contacts").isDisplayed()).toBeTrue();
    await completeHostedAuth();
    await $("button=Download from Phone").waitForDisplayed();
    await syncContacts();
    await assertExpectedContacts(expected);
  }, 180_000);
});
