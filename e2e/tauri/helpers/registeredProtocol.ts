import { execFile, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import { raceFirstObservation } from "../../../src/desktop/observationRace";

const execFileAsync = promisify(execFile);

/**
 * Dispatch a URL through the operating system's registered protocol handler.
 * This intentionally does not start the application executable directly:
 * protocol registration and singleton forwarding are the boundaries under
 * test.
 */
export async function openRegisteredProtocol(url: string): Promise<void> {
  // A raw debug binary has no application bundle for LaunchServices to
  // register. The GUI harness explicitly opts into the equivalent native
  // launch-argument adapter so the running debug singleton still exercises
  // the real callback parser and single-instance forwarding path. Installed
  // bundle lanes continue to use the operating system's registered handler.
  const guiBinary = process.env.ZMANAGER_GUI_APP_PATH;
  const useMacOSGuiProtocolAdapter = process.platform === "darwin"
    && process.env.ZMANAGER_GUI_TEST_PROTOCOL_ADAPTER === "1"
    && guiBinary !== undefined
    && !guiBinary.endsWith(".app");
  const command = useMacOSGuiProtocolAdapter
    ? { file: guiBinary!, args: [url] }
    : process.platform === "win32"
    ? { file: "powershell.exe", args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.resolve("scripts", "open-windows-registered-protocol.ps1"), "-Url", url] }
    : process.platform === "darwin"
      ? { file: "open", args: [url] }
      : { file: "xdg-open", args: [url] };

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.file, command.args, {
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`OS protocol dispatch failed with exit code ${code ?? "unknown"}`));
      }
    });
  });
}

type DefaultBrowserObservation = Readonly<{
  status: "observed";
  origin: string;
  path: string;
  queryKeys: string;
  launchUrl: string;
  observedAtUnixMs: number;
}>;

/**
 * Observe the URL opened by the real system-browser opener. The Windows
 * observer uses UI Automation and returns sanitized metadata plus the full
 * launch URL in memory; callers must never write that URL to logs or evidence.
 */
export async function observeWindowsDefaultBrowserNavigation(
  expectedOrigin: string,
  timeoutSeconds = 30,
): Promise<DefaultBrowserObservation> {
  if (process.platform !== "win32") {
    throw new Error("The installed standalone browser observer is currently implemented for Windows only.");
  }

  const observerPath = path.resolve("scripts", "observe-windows-default-browser.ps1");
  const observerDirectory = mkdtempSync(path.join(tmpdir(), "zmanager-default-browser-observer-"));
  const readyPath = path.join(observerDirectory, "ready");
  const child = spawn("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      observerPath,
      "-ExpectedOrigin",
      expectedOrigin,
      "-TimeoutSeconds",
      String(timeoutSeconds),
      "-ReadyFile",
      readyPath,
    ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });

  try {
    const readyDeadline = Date.now() + 5_000;
    while (!existsSync(readyPath) && Date.now() < readyDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!existsSync(readyPath)) {
      child.kill();
      throw new Error("Default browser observer did not become ready.");
    }

    const exitCode = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code ?? 1));
    });
    const line = stdout.trim().split(/\r?\n/u).filter(Boolean).at(-1);
    let result: { status?: string; origin?: string; path?: string; queryKeys?: string; url?: string; observedAtUnixMs?: number; errorCode?: string } = {};
    try {
      result = line ? JSON.parse(line) as typeof result : {};
    } catch {
      // The sanitized fallback below avoids echoing PowerShell/UIA output.
    }
    if (exitCode !== 0 || result.status !== "observed") {
      throw new Error(`Default browser navigation was not observed (${result.errorCode ?? "observer_failed"}).`);
    }
    if (stderr.trim()) {
      // Keep stderr out of the failure message because UI Automation may include
      // framework diagnostics that are not part of sanitized E2E evidence.
    }
    return {
      status: "observed",
      origin: result.origin ?? "",
      path: result.path ?? "",
      queryKeys: result.queryKeys ?? "",
      launchUrl: result.url ?? "",
      observedAtUnixMs: result.observedAtUnixMs ?? 0,
    };
  } finally {
    rmSync(observerDirectory, { recursive: true, force: true });
  }
}

/**
 * Observe the URL opened by the real macOS default-browser opener. The
 * observer intentionally reads only the active tab URL from the user's
 * browser; it does not navigate the browser or bypass the app's opener.
 */
export async function observeMacOSDefaultBrowserNavigation(
  expectedOrigin: string,
  timeoutSeconds = 30,
): Promise<DefaultBrowserObservation> {
  if (process.platform !== "darwin") {
    throw new Error("The macOS default-browser observer can only run on macOS.");
  }

  // Firefox does not expose its address bar through the macOS accessibility
  // tree. Its Places database does record the navigation, so race its
  // read-only history observer with the accessibility-based observers. A
  // sequential fallback can consume two full observer timeouts and exceed
  // the WDIO test timeout when Firefox is installed but is not the default.
  const attempts = [
    ...(existsSync("/Applications/Firefox.app")
      ? [(signal: AbortSignal) => observeFirefoxHistoryNavigation(expectedOrigin, timeoutSeconds, signal)]
      : []),
    (signal: AbortSignal) => observeMacOSAppleScriptNavigation(expectedOrigin, timeoutSeconds, signal),
  ];
  try {
    return await raceFirstObservation(attempts);
  } catch {
    throw new Error("Default browser navigation was not observed on macOS.");
  }
}

async function observeMacOSAppleScriptNavigation(
  expectedOrigin: string,
  timeoutSeconds: number,
  signal: AbortSignal,
): Promise<DefaultBrowserObservation | null> {
  const script = `
on run argv
  set expectedOrigin to item 1 of argv
  set timeoutSeconds to (item 2 of argv) as integer
  set deadline to (current date) + timeoutSeconds
  repeat while (current date is less than deadline)
    repeat with browserName in {"Safari", "Google Chrome", "Microsoft Edge"}
      set browserLabel to browserName as text
      try
        if browserLabel is "Safari" then
          tell application "Safari" to set candidate to URL of current tab of front window
        else if browserLabel is "Google Chrome" then
          tell application "Google Chrome" to set candidate to URL of active tab of front window
        else
          tell application "Microsoft Edge" to set candidate to URL of active tab of front window
        end if
        if candidate starts with expectedOrigin then return candidate
      end try
    end repeat
    delay 0.25
  end repeat
  error "not_observed"
end run
`;
  const child = spawn("osascript", ["-e", script, "--", expectedOrigin, String(timeoutSeconds)], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  const exitCode = await new Promise<number>((resolve, reject) => {
    const abort = (): void => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    };
    if (signal.aborted) abort();
    signal.addEventListener("abort", abort, { once: true });
    child.once("error", reject);
    child.once("close", (code) => {
      signal.removeEventListener("abort", abort);
      resolve(code ?? 1);
    });
  });
  const launchUrl = stdout.trim().split(/\r?\n/u).filter(Boolean).at(-1) ?? "";
  if (exitCode !== 0 || !launchUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(launchUrl);
  } catch {
    return null;
  }
  if (parsed.origin !== expectedOrigin) return null;
  return {
    status: "observed",
    origin: parsed.origin,
    path: parsed.pathname,
    queryKeys: [...parsed.searchParams.keys()].sort().join(","),
    launchUrl,
    observedAtUnixMs: Date.now(),
  };
}

async function observeFirefoxHistoryNavigation(
  expectedOrigin: string,
  timeoutSeconds: number,
  signal: AbortSignal,
): Promise<DefaultBrowserObservation | null> {
  const profileRoot = path.join(process.env.HOME ?? "", "Library", "Application Support", "Firefox", "Profiles");
  if (!existsSync(profileRoot)) return null;
  const databases = readdirSync(profileRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(profileRoot, entry.name, "places.sqlite"))
    .filter(existsSync);
  if (databases.length === 0) return null;
  const escapedOrigin = expectedOrigin.replaceAll("'", "''");
  const query = `SELECT last_visit_date || char(9) || url FROM moz_places WHERE url LIKE '${escapedOrigin}/%' AND last_visit_date IS NOT NULL ORDER BY last_visit_date DESC LIMIT 1;`;
  const snapshotDirectory = mkdtempSync(path.join(tmpdir(), "zmanager-firefox-history-"));

  const readLatest = async (): Promise<{ timestamp: number; url: string } | null> => {
    const visits = await Promise.all(databases.map(async (database) => {
      const snapshot = path.join(snapshotDirectory, `${databases.indexOf(database)}-places.sqlite`);
      try {
        // Firefox keeps places.sqlite open and may hold a read lock while the
        // browser is handling the new navigation. Query a point-in-time copy
        // plus its WAL/SHM companions instead of racing the live database.
        copyFileSync(database, snapshot);
        for (const suffix of ["-wal", "-shm"]) {
          const sidecar = `${database}${suffix}`;
          if (existsSync(sidecar)) copyFileSync(sidecar, `${snapshot}${suffix}`);
        }
        const result = await execFileAsync("sqlite3", ["-readonly", snapshot, query], { encoding: "utf8" }) as { stdout: string };
        const line = result.stdout.trim().split(/\r?\n/u).filter(Boolean).at(-1);
        if (!line) return null;
        const separator = line.indexOf("\t");
        if (separator < 1) return null;
        const timestamp = Number(line.slice(0, separator));
        const url = line.slice(separator + 1);
        return Number.isFinite(timestamp) ? { timestamp, url } : null;
      } catch {
        return null;
      }
    }));
    return visits.filter((visit): visit is { timestamp: number; url: string } => visit !== null)
      .sort((left, right) => right.timestamp - left.timestamp)[0] ?? null;
  };

  try {
    const baseline = (await readLatest())?.timestamp ?? 0;
    const deadline = Date.now() + timeoutSeconds * 1000;
    while (Date.now() < deadline) {
      if (signal.aborted) return null;
      const latest = await readLatest();
      if (latest && latest.timestamp > baseline) {
        try {
          const parsed = new URL(latest.url);
          if (parsed.origin !== expectedOrigin) return null;
          return {
            status: "observed",
            origin: parsed.origin,
            path: parsed.pathname,
            queryKeys: [...parsed.searchParams.keys()].sort().join(","),
            launchUrl: latest.url,
            observedAtUnixMs: Date.now(),
          };
        } catch {
          return null;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
  } finally {
    rmSync(snapshotDirectory, { recursive: true, force: true });
  }
}

export async function observeDefaultBrowserNavigation(
  expectedOrigin: string,
  timeoutSeconds = 30,
): Promise<DefaultBrowserObservation> {
  if (process.platform === "win32") {
    return observeWindowsDefaultBrowserNavigation(expectedOrigin, timeoutSeconds);
  }
  if (process.platform === "darwin") {
    return observeMacOSDefaultBrowserNavigation(expectedOrigin, timeoutSeconds);
  }
  throw new Error("The installed standalone browser observer is not implemented on this platform.");
}

export async function stopWindowsInstalledApplication(executablePath: string): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("The installed standalone process helper is currently implemented for Windows only.");
  }
  const child = spawn("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.resolve("scripts", "stop-windows-installed-app.ps1"),
    "-ExecutablePath",
    executablePath,
  ], { stdio: "ignore", windowsHide: true });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`Installed application stop failed with exit code ${code ?? "unknown"}`)));
  });
}

export async function countWindowsInstalledApplicationProcesses(executablePath: string): Promise<number> {
  if (process.platform !== "win32") {
    throw new Error("The installed standalone process helper is currently implemented for Windows only.");
  }
  const child = spawn("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.resolve("scripts", "count-windows-installed-app.ps1"),
    "-ExecutablePath",
    executablePath,
  ], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) throw new Error("Installed application process count failed.");
  const count = Number.parseInt(stdout.trim(), 10);
  if (!Number.isInteger(count)) throw new Error("Installed application process count was invalid.");
  return count;
}

export async function countInstalledApplicationProcesses(executablePath: string): Promise<number> {
  if (process.platform === "win32") {
    return countWindowsInstalledApplicationProcesses(executablePath);
  }
  if (process.platform !== "darwin") {
    throw new Error("The installed application process helper is not implemented on this platform.");
  }
  const executableName = path.basename(executablePath);
  const child = spawn("pgrep", ["-x", executableName], { stdio: ["ignore", "pipe", "ignore"] });
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0 && exitCode !== 1) throw new Error("Installed application process count failed.");
  return stdout.split(/\r?\n/u).filter(Boolean).length;
}

export async function startWindowsInstalledApplication(executablePath: string): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("The installed standalone process helper is currently implemented for Windows only.");
  }
  const child = spawn("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.resolve("scripts", "start-windows-installed-app.ps1"),
    "-ExecutablePath",
    executablePath,
  ], { stdio: "ignore", windowsHide: true });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`Installed application start failed with exit code ${code ?? "unknown"}`)));
  });
}

export async function runWindowsAccountUiAction(action: string): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("The installed Account UI driver is currently implemented for Windows only.");
  }
  const child = spawn("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.resolve("scripts", "windows-uia-account-action.ps1"),
    "-Action",
    action,
  ], { stdio: "ignore", windowsHide: true });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`Installed Account UI action failed: ${action}`)));
  });
}
