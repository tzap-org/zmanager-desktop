import { resolve } from "node:path";

import type { TauriCapabilities } from "@wdio/native-types";

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
      ...(process.env.ZMANAGER_GUI_TEST_STATE_DIR ? { ZMANAGER_GUI_TEST_STATE_DIR: process.env.ZMANAGER_GUI_TEST_STATE_DIR } : {}),
      ...(process.env.ZMANAGER_GUI_TEST_CONTACT_DIAGNOSTIC === "1" ? { ZMANAGER_GUI_TEST_CONTACT_DIAGNOSTIC: "1" } : {}),
    },
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
