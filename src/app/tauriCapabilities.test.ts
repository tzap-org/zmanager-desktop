import { describe, expect, it } from "vitest";

const nativeDragPermission = "allow-start-native-file-drag";
const nativeDragCommand = "start_native_file_drag";
const linuxWindowControlPermissions = [
  "core:window:allow-close",
  "core:window:allow-destroy",
  "core:window:allow-minimize",
  "core:window:allow-start-dragging",
  "core:window:allow-start-resize-dragging",
  "core:window:allow-toggle-maximize",
  "core:window:allow-internal-toggle-maximize",
];
const persistedWindowGeometryPermissions = [
  "core:window:allow-available-monitors",
  "core:window:allow-scale-factor",
  "core:window:allow-inner-position",
  "core:window:allow-inner-size",
  "core:window:allow-set-position",
  "core:window:allow-set-size",
  "core:window:allow-center",
  "core:window:allow-show",
];
const nativeWindowResizePermissions = [
  "core:window:allow-set-resizable",
];

declare const process: {
  cwd(): string;
};

declare function require(id: "fs"): {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: string): string;
};

declare function require(id: "path"): {
  join(...parts: string[]): string;
};

const { existsSync, readFileSync } = require("fs");
const { join } = require("path");

function readWorkspaceFile(...parts: string[]): string {
  return readFileSync(join(process.cwd(), ...parts), "utf8");
}

describe("Tauri command capabilities", () => {
  function capabilityPermissionIds(fileName: string): string[] {
    const capability = JSON.parse(
      readWorkspaceFile("src-tauri", "capabilities", fileName),
    ) as { permissions: Array<string | { identifier: string }> };

    return capability.permissions.map((permission) =>
      typeof permission === "string" ? permission : permission.identifier,
    );
  }

  function mainWindowPermissionIds(): string[] {
    return capabilityPermissionIds("default.json");
  }

  it("allows native file drag from the main window capability", () => {
    expect(mainWindowPermissionIds()).toContain(nativeDragPermission);
  });

  it("allows Linux app-owned titlebar window controls", () => {
    expect(mainWindowPermissionIds()).toEqual(expect.arrayContaining(linuxWindowControlPermissions));
  });

  it("allows every operation needed to restore and reveal persisted window geometry", () => {
    expect(mainWindowPermissionIds()).toEqual(
      expect.arrayContaining(persistedWindowGeometryPermissions),
    );
  });

  it("keeps generic filesystem opening out of the webview opener capability", () => {
    expect(mainWindowPermissionIds()).not.toContain("opener:allow-open-path");
  });

  it("allows native window resize control from the main window", () => {
    expect(mainWindowPermissionIds()).toEqual(
      expect.arrayContaining(nativeWindowResizePermissions),
    );
  });

  it("allows registered product commands from the main window except task-owned Job commands", () => {
    const mainSource = readWorkspaceFile("src-tauri", "src", "main.rs");
    const handlerBlock = mainSource.match(/tauri::generate_handler!\[\s*([\s\S]*?)\s*\]/)?.[1] ?? "";
    const commands = [...handlerBlock.matchAll(/(?:commands|account|default_handlers|diagnostics|replacement_migration)::([a-zA-Z0-9_]+)/g)]
      .map((match) => match[1]);
    const taskOwnedCommands = new Set([
      "subscribe_job",
      "cancel_job",
      "pause_job",
      "resume_job",
      "dismiss_job",
    ]);
    const expectedPermissions = commands
      .filter((command) => !taskOwnedCommands.has(command))
      .map((command) => `allow-${command.replaceAll("_", "-")}`);
    const taskOwnedPermissions = [...taskOwnedCommands]
      .map((command) => `allow-${command.replaceAll("_", "-")}`);

    expect(mainWindowPermissionIds()).toEqual(expect.arrayContaining(expectedPermissions));
    for (const permission of taskOwnedPermissions) {
      expect(mainWindowPermissionIds()).not.toContain(permission);
    }
    expect(capabilityPermissionIds("disposable-task.json")).toEqual(
      expect.arrayContaining(taskOwnedPermissions),
    );
  });

  it("generates permissions for every registered product command", () => {
    const mainSource = readWorkspaceFile("src-tauri", "src", "main.rs");
    const handlerBlock = mainSource.match(/tauri::generate_handler!\[\s*([\s\S]*?)\s*\]/)?.[1] ?? "";
    const registeredCommands = [...handlerBlock.matchAll(/(?:commands|account|default_handlers|diagnostics|replacement_migration)::([a-zA-Z0-9_]+)/g)]
      .map((match) => match[1]);
    const buildSource = readWorkspaceFile("src-tauri", "build.rs");
    const manifestBlock = buildSource.match(/AppManifest::new\(\)\.commands\(&\[([\s\S]*?)\]\)/)?.[1] ?? "";
    const permissionCommands = [...manifestBlock.matchAll(/"([a-zA-Z0-9_]+)"/g)]
      .map((match) => match[1]);

    expect(permissionCommands).toEqual(expect.arrayContaining(registeredCommands));
  });

  it("defines the native file drag command permission", () => {
    const permissionPath = join(
      process.cwd(),
      "src-tauri",
      "permissions",
      "autogenerated",
      "start_native_file_drag.toml",
    );

    if (!existsSync(permissionPath)) {
      return;
    }

    const permissionFile = readFileSync(permissionPath, "utf8");
    expect(permissionFile).toContain(`identifier = "${nativeDragPermission}"`);
    expect(permissionFile).toContain(`commands.allow = ["${nativeDragCommand}"]`);
  });

  it("includes native file drag in the generated app ACL snapshot", () => {
    const generatedAclPath = join(
      process.cwd(),
      "src-tauri",
      "gen",
      "schemas",
      "acl-manifests.json",
    );
    if (!existsSync(generatedAclPath)) {
      return;
    }

    const acl = JSON.parse(
      readFileSync(generatedAclPath, "utf8"),
    ) as {
      "__app-acl__": {
        permissions: Record<
          string,
          { commands: { allow: string[]; deny: string[] } }
        >;
      };
    };

    expect(acl["__app-acl__"].permissions[nativeDragPermission]?.commands.allow)
      .toContain(nativeDragCommand);
  });
});
