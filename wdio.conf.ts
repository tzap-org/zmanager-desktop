import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
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
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^(TZAP_E2E_[A-Z0-9_]+)=(.*)$/u.exec(trimmed);
    if (!match || process.env[match[1]] !== undefined) continue;
    const [, key, rawValue] = match;
    process.env[key] = rawValue.replace(/^['"]|['"]$/gu, "");
  }
}

function prepareOnlineE2eProcessEnvironment(): void {
  loadOnlineE2eEnvFile();
  const environment = (process.env.TZAP_E2E_ENV ?? "local").toLowerCase();
  if (!["local", "staging"].includes(environment)) {
    throw new Error("TZAP_E2E_ENV must be local or staging; production is never allowed for the native E2E runner.");
  }
  if (environment === "staging" && (!process.env.TZAP_E2E_USERNAME || !process.env.TZAP_E2E_PASSWORD)) {
    throw new Error("TZAP_E2E_USERNAME and TZAP_E2E_PASSWORD are required for staging E2E runs.");
  }
  if (process.env.TZAP_E2E_ALLOW_DESTRUCTIVE === "1" && environment !== "staging") {
    throw new Error("TZAP_E2E_ALLOW_DESTRUCTIVE=1 is only permitted for staging runs.");
  }

  const runId = process.env.TZAP_E2E_RUN_ID ?? `${new Date().toISOString().replace(/[-:.TZ]/gu, "")}-${randomUUID()}`;
  const artifactDir = process.env.TZAP_E2E_ARTIFACT_DIR
    ? resolve(process.env.TZAP_E2E_ARTIFACT_DIR)
    : join(tmpdir(), "zmanager-online-e2e", runId);
  const stateRoot = join(artifactDir, "desktop-state");
  mkdirSync(stateRoot, { recursive: true });

  process.env.TZAP_E2E_ENV = environment;
  process.env.TZAP_E2E_RUN_ID = runId;
  process.env.TZAP_E2E_ARTIFACT_DIR = artifactDir;
  process.env.TZAP_E2E_ACCOUNT_STATE_ROOT = stateRoot;
  process.env.TZAP_E2E_SECURE_STORE_NAMESPACE = `e2e-${runId}`;
  process.env.TZAP_E2E_FIXTURE_ROOT_CERT = join(artifactDir, "fixture-root.pem");
  process.env.TZAP_E2E_ALLOW_PRODUCTION = "0";
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
    env: { ZMANAGER_GUI_TEST_MODE: "1" },
  }]],
  capabilities: [tauriCapabilities],
  framework: "jasmine",
  reporters: ["spec"],
  jasmineOpts: {
    defaultTimeoutInterval: 60_000,
  },
  waitforTimeout: 10_000,
  connectionRetryTimeout: 90_000,
  connectionRetryCount: 2,
  logLevel: "info",
};
