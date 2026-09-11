import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import type { TauriCapabilities } from "@wdio/native-types";

function loadOnlineE2eEnvFile(): void {
  const envFile = process.env.TZAP_E2E_ENV_FILE;
  if (!envFile) return;
  const filePath = isAbsolute(envFile) ? envFile : resolve(envFile);
  if (!existsSync(filePath)) {
    throw new Error(`TZAP_E2E_ENV_FILE does not exist: ${filePath}`);
  }
  const values = new Map<string, string>();
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/u.exec(trimmed);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = rawValue.replace(/^['"]|['"]$/gu, "");
    values.set(key, value);
    if ((key.startsWith("TZAP_E2E_") || key === "TZAP_DESKTOP_STAGING_CLIENT_ID") && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  // Preserve the existing staging.env.txt contract used by the sibling
  // staging scripts while keeping TZAP_E2E_* as the canonical interface.
  if (process.env.TZAP_E2E_USERNAME === undefined) {
    const username = values.get("STAGING_TEST_USER_1") ?? values.get("STAGING_TEST_USER_OAUTH");
    if (username) process.env.TZAP_E2E_USERNAME = username;
  }
  if (process.env.TZAP_E2E_PASSWORD === undefined) {
    const password = values.get("STAGING_TEST_USER_PASSWORD");
    if (password) process.env.TZAP_E2E_PASSWORD = password;
  }
}

function prepareOnlineE2eProcessEnvironment(): void {
  loadOnlineE2eEnvFile();
  const environment = (process.env.TZAP_E2E_ENV ?? "staging").toLowerCase();
  if (environment !== "staging") {
    throw new Error("TZAP_E2E_ENV must be staging; local fixtures and production are not allowed for the native E2E runner.");
  }
  if (!process.env.TZAP_E2E_USERNAME || !process.env.TZAP_E2E_PASSWORD) {
    throw new Error("TZAP_E2E_USERNAME and TZAP_E2E_PASSWORD are required for staging E2E runs.");
  }

  const runId = process.env.TZAP_E2E_RUN_ID ?? `${new Date().toISOString().replace(/[-:.TZ]/gu, "")}-${randomUUID()}`;
  const artifactDir = process.env.TZAP_E2E_ARTIFACT_DIR
    ? resolve(process.env.TZAP_E2E_ARTIFACT_DIR)
    : join(tmpdir(), "zmanager-online-e2e", runId);
  const stateRoot = join(artifactDir, "desktop-state");
  mkdirSync(stateRoot, { recursive: true });

  process.env.TZAP_E2E_ENV = environment;
  process.env.TZAP_E2E_RUN_ID = runId;
  process.env.TZAP_E2E_ARTIFACT_DIR_MANAGED = process.env.TZAP_E2E_ARTIFACT_DIR ? "0" : "1";
  process.env.TZAP_E2E_ARTIFACT_DIR = artifactDir;
  process.env.TZAP_E2E_ACCOUNT_STATE_ROOT = stateRoot;
  process.env.TZAP_E2E_SECURE_STORE_NAMESPACE = `e2e-${runId}`;
}

function redactFailureText(value: unknown): string {
  let text = value instanceof Error ? `${value.name}: ${value.message}\n${value.stack ?? ""}` : String(value ?? "");
  for (const secret of [process.env.TZAP_E2E_USERNAME, process.env.TZAP_E2E_PASSWORD]) {
    if (secret) text = text.replaceAll(secret, "<redacted>");
  }
  return text.replace(/([?&][A-Za-z0-9_.~-]+=)[^&\s#]*/gu, "$1<redacted>");
}

prepareOnlineE2eProcessEnvironment();

const appBinaryPath = process.env.ZMANAGER_GUI_APP_PATH ?? resolve(
  "src-tauri",
  "target",
  "debug",
  process.platform === "win32" ? "zmanager-desktop.exe" : "zmanager-desktop",
);

// Declared separately, and typed as TauriCapabilities, because `tauri:options`
// is a vendor-prefixed capability that the Tauri service reads to resolve the
// application binary. The standalone W3C capability type does not model it, so
// writing this inline would trip excess-property checking.
const tauriCapabilities: TauriCapabilities = {
  browserName: "tauri",
  "wdio:maxInstances": 1,
  "tauri:options": {
    application: appBinaryPath,
  },
};

export const config: WebdriverIO.Config = {
  runner: "local",
  // The embedded Tauri service owns one native window. Import all native specs
  // through one worker so window-size/maximize tests cannot race each other.
  specs: ["./e2e/tauri/all.spec.ts"],
  maxInstances: 1,
  maxInstancesPerCapability: 1,
  services: [["@wdio/tauri-service", {
    appBinaryPath,
    driverProvider: "embedded",
    embeddedPort: 4445,
    // Preserve the app's last backend messages in CI when the embedded
    // server disappears. This is especially useful for native-arm failures,
    // where the WebDriver connection otherwise only reports ECONNREFUSED.
    captureBackendLogs: true,
    backendLogLevel: "info",
    // The repository app may already be open while GUI tests run locally.
    // Debug-only test mode disables the normal macOS singleton registration
    // for this spawned process, without changing release behavior.
    env: {
      ZMANAGER_GUI_TEST_MODE: "1",
      ZMANAGER_GUI_TEST_DEEP_LINK: "1",
      ...(process.env.ZMANAGER_GUI_TEST_STATE_DIR ? { ZMANAGER_GUI_TEST_STATE_DIR: process.env.ZMANAGER_GUI_TEST_STATE_DIR } : {}),
      TZAP_E2E_ENV: process.env.TZAP_E2E_ENV!,
      TZAP_E2E_RUN_ID: process.env.TZAP_E2E_RUN_ID!,
      ...(process.env.TZAP_E2E_STAGING_CALLBACK_ADAPTER ? { TZAP_E2E_STAGING_CALLBACK_ADAPTER: process.env.TZAP_E2E_STAGING_CALLBACK_ADAPTER } : {}),
      TZAP_E2E_ACCOUNT_STATE_ROOT: process.env.TZAP_E2E_ACCOUNT_STATE_ROOT!,
      TZAP_E2E_SECURE_STORE_NAMESPACE: process.env.TZAP_E2E_SECURE_STORE_NAMESPACE!,
      TZAP_E2E_ACCOUNT_STATE_ROOT_REUSE: "1",
    },
  }]],
  capabilities: [tauriCapabilities],
  framework: "jasmine",
  reporters: ["spec"],
  jasmineOpts: {
    defaultTimeoutInterval: 60_000,
  },
  afterTest: async (test, _context, result) => {
    if (result.passed) return;
    process.env.TZAP_E2E_FAILURES = "1";
    const failureDir = join(process.env.TZAP_E2E_ARTIFACT_DIR!, "failures");
    mkdirSync(failureDir, { recursive: true });
    const slug = `${test.title}-${randomUUID()}`.replace(/[^a-zA-Z0-9_-]+/gu, "-").slice(0, 120);
    const screenshotPath = join(failureDir, `${slug}.png`);
    let screenshotError: string | null = null;
    try {
      await browser.saveScreenshot(screenshotPath);
    } catch (error) {
      screenshotError = redactFailureText(error);
    }
    writeFileSync(join(failureDir, `${slug}.json`), `${JSON.stringify({
      title: test.title,
      fullTitle: test.fullTitle,
      passed: result.passed,
      durationMs: result.duration,
      error: redactFailureText(result.error),
      screenshotPath: screenshotError ? null : screenshotPath,
      screenshotError,
    }, null, 2)}\n`);
  },
  waitforTimeout: 10_000,
  connectionRetryTimeout: 90_000,
  connectionRetryCount: 2,
  logLevel: "info",
};
