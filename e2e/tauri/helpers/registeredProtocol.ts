import { spawn } from "node:child_process";

/**
 * Dispatch a URL through the operating system's registered protocol handler.
 * This intentionally does not start the application executable directly:
 * protocol registration and singleton forwarding are the boundaries under
 * test.
 */
export async function openRegisteredProtocol(url: string): Promise<void> {
  const command = process.platform === "win32"
    ? { file: "cmd.exe", args: ["/d", "/c", "start", "", `"${url.replaceAll('"', "")}"`] }
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
