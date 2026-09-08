import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

type NativeCapability = {
  id: string;
  sourceState: string;
  packageState: string;
  runtimeState: string;
  availability: string;
};

type ProjectContract = {
  commands: string[];
  platformIntegration: {
    platform: string;
    capabilities: NativeCapability[];
  };
  sourceTableCapabilities: {
    availableColumnIds: string[];
  };
};

type SystemFileIconResponse = {
  icons: Array<{
    key: string;
    dataUrl: string | null;
  }>;
};

type NativeWindowSize = {
  width: number;
  height: number;
};

type NativeMonitor = {
  name: string | null;
  scaleFactor: number;
  position: { x: number; y: number };
  size: NativeWindowSize;
};

type DiagnosticLogInfo = {
  enabled: boolean;
  path: string | null;
  sessionId: string;
  location: string;
};

type DiagnosticLogEntry = {
  sessionId: string;
  scope: string;
  name: string;
  fields: Record<string, unknown>;
};

describe("macOS native Tauri integration", () => {
  if (process.platform !== "darwin") {
    it("runs only on macOS", () => {
      pending("macOS native Tauri coverage is not applicable on this host.");
    });
    return;
  }

  it("reports the macOS capability and source-column contract", async () => {
    const contract = await invoke<ProjectContract>("project_contract");

    assert.equal(contract.platformIntegration.platform, "macos");
    assert.deepEqual(
      contract.sourceTableCapabilities.availableColumnIds.filter((id) =>
        ["mode", "uid", "gid", "owner", "group"].includes(id),
      ),
      ["mode", "uid", "gid", "owner", "group"],
    );
    assert.equal(contract.sourceTableCapabilities.availableColumnIds.includes("attributes"), true);
  });

  it("reports the required macOS runtime seams as available", async () => {
    const contract = await invoke<ProjectContract>("project_contract");
    const capability = capabilityLookup(contract);

    for (const id of [
      "mainWindowPolicy",
      "disposableTaskWindowPolicy",
      "secureLocalFileProtection",
      "nativeFileDrag",
      "diagnosticLog",
    ]) {
      assert.deepEqual(
        {
          sourceState: capability(id).sourceState,
          runtimeState: capability(id).runtimeState,
          availability: capability(id).availability,
        },
        { sourceState: "supported", runtimeState: "ready", availability: "available" },
        id,
      );
    }
  });

  it("publishes the command seam required by the macOS shell workflow", async () => {
    const contract = await invoke<ProjectContract>("project_contract");
    for (const command of [
      "healthcheck",
      "project_contract",
      "start_archive_index",
      "wait_archive_index",
      "get_archive_children",
      "search_archive_index",
      "close_archive_index",
      "preview_entry",
      "start_native_file_drag",
      "cleanup_preview_roots",
    ]) {
      assert.ok(contract.commands.includes(command), `Missing command contract entry ${command}`);
    }
  });

  it("starts with one addressable native main window", async () => {
    assert.deepEqual(await browser.getWindowHandles(), ["main"]);
  });

  it("reports the native macOS title and WebView title", async () => {
    assert.equal(await invoke<string>("plugin:window|title", { label: "main" }), "ZManager");
    assert.match(await browser.getTitle(), /ZManager/);
  });

  it("keeps the macOS native window controls available", async () => {
    const flags = await Promise.all([
      invoke<boolean>("plugin:window|is_resizable", { label: "main" }),
      invoke<boolean>("plugin:window|is_maximizable", { label: "main" }),
      invoke<boolean>("plugin:window|is_minimizable", { label: "main" }),
      invoke<boolean>("plugin:window|is_closable", { label: "main" }),
    ]);
    assert.deepEqual(flags, [true, true, true, true]);
  });

  it("writes macOS diagnostics under the user Library log directory", async () => {
    const info = await invoke<DiagnosticLogInfo>("diagnostic_log_info");
    const expectedRoot = path.join(os.homedir(), "Library", "Logs");

    assert.equal(info.enabled, true);
    assert.equal(info.location, "user");
    assert.ok(info.path);
    const resolvedPath = path.resolve(info.path);
    assert.equal(path.dirname(path.dirname(resolvedPath)), path.resolve(expectedRoot));
    assert.equal(path.basename(resolvedPath), "zmanager-diagnostics.log");
    assert.match(info.sessionId, /^\d+-\d+$/);
  });

  it("persists and redacts a diagnostic event through the real macOS command", async () => {
    const info = await invoke<DiagnosticLogInfo>("diagnostic_log_info");
    assert.ok(info.path, "macOS diagnostic log path is unavailable");
    const marker = `native-macos-${Date.now()}`;
    const password = `test-password-${Date.now()}`;
    const archivePath = `/Users/test/Documents/${marker}.zip`;

    await invoke<void>("record_diagnostic_event", {
      request: {
        scope: "macos.native.e2e",
        name: "redaction-proof",
        fields: { marker, password, archivePath },
      },
    });

    let event: DiagnosticLogEntry | undefined;
    await browser.waitUntil(() => {
      if (!existsSync(info.path ?? "")) {
        return false;
      }
      event = readDiagnosticEntries(info.path ?? "").find((candidate) =>
        candidate.sessionId === info.sessionId &&
        candidate.scope === "macos.native.e2e" &&
        candidate.name === "redaction-proof" &&
        candidate.fields.marker === marker,
      );
      return event !== undefined;
    }, {
      timeout: 5_000,
      timeoutMsg: "The macOS diagnostic event was not flushed to disk",
    });

    assert.equal(event?.fields.password, "[REDACTED]");
    assert.equal(event?.fields.archivePath, "[REDACTED_PATH]");
    assert.equal(JSON.stringify(event).includes(password), false);
    assert.equal(JSON.stringify(event).includes(archivePath), false);
  });

  it("reports a positive macOS display scale factor", async () => {
    const scaleFactor = await invoke<number>("plugin:window|scale_factor", { label: "main" });
    assert.ok(Number.isFinite(scaleFactor));
    assert.ok(scaleFactor > 0);
  });

  it("reports a valid macOS monitor topology", async () => {
    const monitors = await invoke<NativeMonitor[]>("plugin:window|available_monitors");

    assert.ok(monitors.length >= 1);
    for (const monitor of monitors) {
      assert.ok(Number.isFinite(monitor.position.x), JSON.stringify(monitor));
      assert.ok(Number.isFinite(monitor.position.y), JSON.stringify(monitor));
      assert.ok(monitor.size.width > 0, JSON.stringify(monitor));
      assert.ok(monitor.size.height > 0, JSON.stringify(monitor));
      assert.ok(Number.isFinite(monitor.scaleFactor) && monitor.scaleFactor > 0, JSON.stringify(monitor));
    }
  });

  it("keeps the WebView viewport synchronized with the native macOS inner size", async () => {
    const nativeSize = await invoke<NativeWindowSize>("plugin:window|inner_size", { label: "main" });
    const scaleFactor = await invoke<number>("plugin:window|scale_factor", { label: "main" });
    const viewport = await browser.execute(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      documentWidth: document.documentElement.clientWidth,
      documentHeight: document.documentElement.clientHeight,
    }));

    assert.equal(viewport.width, viewport.documentWidth);
    assert.equal(viewport.height, viewport.documentHeight);
    assert.ok(Math.abs(nativeSize.width - viewport.width * scaleFactor) <= 2, JSON.stringify({
      nativeSize,
      scaleFactor,
      viewport,
    }));
    assert.ok(Math.abs(nativeSize.height - viewport.height * scaleFactor) <= 2, JSON.stringify({
      nativeSize,
      scaleFactor,
      viewport,
    }));
  });

  it("keeps the visible macOS window enabled", async () => {
    const [visible, enabled] = await Promise.all([
      invoke<boolean>("plugin:window|is_visible", { label: "main" }),
      invoke<boolean>("plugin:window|is_enabled", { label: "main" }),
    ]);
    assert.deepEqual({ visible, enabled }, { visible: true, enabled: true });
  });

  it("starts outside fullscreen and minimized macOS states", async () => {
    const [fullscreen, minimized] = await Promise.all([
      invoke<boolean>("plugin:window|is_fullscreen", { label: "main" }),
      invoke<boolean>("plugin:window|is_minimized", { label: "main" }),
    ]);
    assert.deepEqual({ fullscreen, minimized }, { fullscreen: false, minimized: false });
  });

  it("round-trips the native macOS resizable flag", async () => {
    const initial = await invoke<boolean>("plugin:window|is_resizable", { label: "main" });
    try {
      await invoke<void>("plugin:window|set_resizable", { label: "main", value: !initial });
      assert.equal(await invoke<boolean>("plugin:window|is_resizable", { label: "main" }), !initial);
    } finally {
      await invoke<void>("plugin:window|set_resizable", { label: "main", value: initial });
    }
  });

  it("reports a finite native macOS window position", async () => {
    const position = await invoke<{ x: number; y: number }>(
      "plugin:window|inner_position",
      { label: "main" },
    );
    assert.ok(Number.isFinite(position.x), JSON.stringify(position));
    assert.ok(Number.isFinite(position.y), JSON.stringify(position));
  });

  it("validates standard macOS system directory locations and hierarchy", async () => {
    for (const macDir of ["/tmp", "/Applications", "/System/Library", "/Library"]) {
      const result = await validateDirectory(macDir);
      assert.deepEqual(result, { exists: true, isDirectory: true, accessible: true }, macDir);
    }
  });

  it("distinguishes a macOS file from a directory", async () => {
    assert.deepEqual(await validateDirectory(process.execPath), {
      exists: true,
      isDirectory: false,
      accessible: false,
    });
  });

  it("rejects an empty macOS directory path without probing the filesystem", async () => {
    assert.deepEqual(await validateDirectory("   "), {
      exists: false,
      isDirectory: false,
      accessible: false,
    });
  });

  it("rejects native macOS drag preparation with empty candidate lists", async () => {
    await assert.rejects(
      async () => {
        await invoke("start_native_file_drag", {
          request: {
            candidates: [],
            stripComponents: 0,
          },
        });
      },
      (err: Error) =>
        err.message.includes("No archive files are available to drag") ||
        err.message.includes("drag"),
    );
  });

  it("rejects native macOS drag preparation with path traversal components", async () => {
    await assert.rejects(
      async () => {
        await invoke("start_native_file_drag", {
          request: {
            candidates: [
              { entryPath: "../outside.txt", size: 10, modifiedUnixSeconds: null },
            ],
            stripComponents: 0,
          },
        });
      },
      (err: Error) => err.message.length > 0,
    );
  });

  it("supports native macOS window centering", async () => {
    await invoke<void>("plugin:window|center", { label: "main" });
    const position = await invoke<{ x: number; y: number }>("plugin:window|inner_position", { label: "main" });
    assert.ok(Number.isFinite(position.x), JSON.stringify(position));
    assert.ok(Number.isFinite(position.y), JSON.stringify(position));
  });

  it("reports native macOS theme property or null", async () => {
    const theme = await invoke<string | null>("plugin:window|theme", { label: "main" });
    assert.ok(theme === null || ["dark", "light"].includes(theme), `Unexpected theme value: ${theme}`);
  });
});

function capabilityLookup(contract: ProjectContract): (id: string) => NativeCapability {
  return (id) => {
    const capability = contract.platformIntegration.capabilities.find((item) => item.id === id);
    assert.ok(capability, `Missing native capability ${id}`);
    return capability;
  };
}

async function validateDirectory(pathValue: string): Promise<{
  exists: boolean;
  isDirectory: boolean;
  accessible: boolean;
}> {
  return invoke("validate_directory", { request: { path: pathValue } });
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return browser.tauri.execute(
    ({ core }, payload: { command: string; args?: Record<string, unknown> }) =>
      payload.args === undefined
        ? core.invoke(payload.command)
        : core.invoke(payload.command, payload.args),
    { command, args },
  ) as Promise<T>;
}

function readDiagnosticEntries(logPath: string): DiagnosticLogEntry[] {
  return readFileSync(logPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as DiagnosticLogEntry];
      } catch {
        return [];
      }
    });
}
