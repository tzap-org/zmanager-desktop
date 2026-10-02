import { defineConfig, devices } from "@playwright/test";

const browserChannel =
  process.platform === "win32" ? { channel: "msedge" as const } : {};

export default defineConfig({
  testDir: "./e2e",
  testIgnore: "**/tauri/**",
  snapshotPathTemplate: "{testDir}/snapshots/{testFilePath}/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      animations: "disabled",
    },
  },
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev -- --port 5173 --strictPort",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // The GUI and E2E suites exercise hosted account surfaces. Keep the
      // browser fixture app on the online profile even when the host defaults
      // to a local-only production build.
      VITE_ZMANAGER_PROFILE: "online",
      VITE_ENABLE_HOSTED_CAPABILITIES: "true",
    },
  },
  projects: [
    {
      name: process.platform === "win32" ? "msedge" : "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...browserChannel,
      },
    },
  ],
});
