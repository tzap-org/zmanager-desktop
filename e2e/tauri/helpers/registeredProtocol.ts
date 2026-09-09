import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

/**
 * Dispatch a URL through the operating system's registered protocol handler.
 * This intentionally does not start the application executable directly:
 * protocol registration and singleton forwarding are the boundaries under
 * test.
 */
export async function openRegisteredProtocol(url: string): Promise<void> {
  const command = process.platform === "win32"
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
