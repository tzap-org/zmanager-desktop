import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { executeAsync } from "@wdio/utils";
import { countInstalledApplicationProcesses, observeWindowsDefaultBrowserNavigation } from "../e2e/tauri/helpers/registeredProtocol.ts";

test("macOS singleton evidence counts the tested executable rather than other installed copies", { skip: process.platform === "win32" }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "zmanager-process-count-"));
  const previousPath = process.env.PATH;
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  t.after(() => {
    process.env.PATH = previousPath;
    Object.defineProperty(process, "platform", platform);
    rmSync(root, { recursive: true, force: true });
  });
  for (const [name, output] of [["pgrep", "123\\n456"], ["ps", "/Applications/ZManager.app/Contents/MacOS/zmanager-desktop\\n/tmp/test/zmanager-desktop"]]) {
    const executable = join(root, name);
    writeFileSync(executable, `#!${process.execPath}\nconsole.log(${JSON.stringify(output)}.replaceAll('\\\\n', '\\n'));\n`);
    chmodSync(executable, 0o755);
  }
  process.env.PATH = `${root}:${previousPath}`;
  Object.defineProperty(process, "platform", { value: "darwin" });
  assert.equal(await countInstalledApplicationProcesses("/tmp/test/zmanager-desktop"), 1);
});

test("the configured WDIO wrapper allows a hosted handoff beyond the UI timeout", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "zmanager-wdio-budget-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const previous = { ...process.env };
  t.after(() => { process.env = previous; });
  process.env.TZAP_E2E_ENV = "staging";
  process.env.TZAP_E2E_USERNAME = "harness-fixture";
  process.env.TZAP_E2E_PASSWORD = "harness-fixture";
  process.env.TZAP_E2E_ARTIFACT_DIR = root;
  const { config } = await import("../wdio.conf.ts");
  const previousJasmine = globalThis.jasmine;
  t.after(() => { globalThis.jasmine = previousJasmine; });
  globalThis.jasmine = { DEFAULT_TIMEOUT_INTERVAL: config.jasmineOpts.defaultTimeoutInterval };
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const result = executeAsync.call({}, () => new Promise((resolve) => setTimeout(() => resolve("completed"), 90_000)), { attempts: 0, limit: 0 }, [], 240_000);
  const assertion = assert.doesNotReject(result);
  t.mock.timers.tick(90_001);
  await assertion;
  assert.equal(await result, "completed");
  assert.ok(config.jasmineOpts.defaultTimeoutInterval >= 300_000, "the wrapper must cover the longest hosted test budget");
});

function observerFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "zmanager-browser-readiness-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const executable = join(bin, "powershell.exe");
  writeFileSync(executable, `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.ZMANAGER_OBSERVER_FIXTURE;
fs.writeFileSync(path.join(root, 'pid'), String(process.pid));
if (process.env.ZMANAGER_OBSERVER_EXIT_EARLY === '1') process.exit(1);
setTimeout(() => {
  fs.writeFileSync(path.join(root, 'baseline'), 'ready');
  fs.writeFileSync(process.argv[process.argv.indexOf('-ReadyFile') + 1], 'ready');
}, 50);
const interval = setInterval(() => {
  if (!fs.existsSync(path.join(root, 'launched'))) return;
  clearInterval(interval);
  console.log(JSON.stringify({status:'observed', origin:'https://staging.tzap.org', path:'/auth/launch', url:'https://staging.tzap.org/auth/launch', observedAtUnixMs:1}));
  process.exit(0);
}, 10);
setTimeout(() => process.exit(1), 500);
`);
  chmodSync(executable, 0o755);
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const previousPath = process.env.PATH;
  t.after(() => {
    Object.defineProperty(process, "platform", platform);
    process.env.PATH = previousPath;
    delete process.env.ZMANAGER_OBSERVER_FIXTURE;
    delete process.env.ZMANAGER_OBSERVER_EXIT_EARLY;
    rmSync(root, { recursive: true, force: true });
  });
  process.env.PATH = `${bin}:${previousPath}`;
  process.env.ZMANAGER_OBSERVER_FIXTURE = root;
  Object.defineProperty(process, "platform", { value: "win32" });
  return root;
}

// These child-process fixtures impersonate PowerShell with a POSIX executable.
// The real Windows GUI lane exercises PowerShell/UIA itself.
test("Windows browser observation dispatches sign-in only after its baseline is ready", { skip: process.platform === "win32" }, async (t) => {
  const root = observerFixture(t);
  let launched = false;
  const observed = await observeWindowsDefaultBrowserNavigation("https://staging.tzap.org", async () => {
    assert.ok(existsSync(join(root, "baseline")), "navigation must follow observer readiness");
    launched = true;
    writeFileSync(join(root, "launched"), "launch");
  }, 1);
  assert.equal(launched, true);
  assert.equal(observed.path, "/auth/launch");
});

test("Windows browser observation fails promptly when the observer exits before readiness", { timeout: 2_000, skip: process.platform === "win32" }, async (t) => {
  observerFixture(t);
  process.env.ZMANAGER_OBSERVER_EXIT_EARLY = "1";
  await assert.rejects(observeWindowsDefaultBrowserNavigation("https://staging.tzap.org", async () => assert.fail("an exited observer must not dispatch navigation"), 1), /did not become ready/);
});

test("Windows browser observation stops its child when the sign-in action fails", { skip: process.platform === "win32" }, async (t) => {
  const root = observerFixture(t);
  await assert.rejects(observeWindowsDefaultBrowserNavigation("https://staging.tzap.org", async () => {
    throw new Error("fixture opener failed");
  }, 1), /fixture opener failed/);
  const pid = Number(readFileSync(join(root, "pid"), "utf8"));
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});
