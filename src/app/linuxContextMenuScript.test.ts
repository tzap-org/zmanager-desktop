import { describe, expect, it } from "vitest";

declare const process: {
  cwd(): string;
};

declare function require(id: "fs"): {
  readFileSync(path: string, encoding: string): string;
};

declare function require(id: "path"): {
  join(...parts: string[]): string;
};

const { readFileSync } = require("fs");
const { join } = require("path");

type ExpectedAction = {
  action: string;
  label: string;
  quickAction: string;
  pathToken: "%F" | "%f";
};

const createActions: ExpectedAction[] = [
  { action: "AddToArchive", label: "Add to archive...", quickAction: "compress", pathToken: "%F" },
  { action: "AddToTzap", label: "Add to .tzap", quickAction: "compress-tzap", pathToken: "%F" },
  { action: "AddToZip", label: "Add to .zip", quickAction: "compress-zip", pathToken: "%F" },
  { action: "AddToSevenZ", label: "Add to .7z", quickAction: "compress-7z", pathToken: "%F" },
  { action: "AddToTzst", label: "Add to .tzst", quickAction: "compress-tzst", pathToken: "%F" },
  { action: "AddToTgz", label: "Add to .tgz", quickAction: "compress-tgz", pathToken: "%F" },
  { action: "CompressShareOnLan", label: "Compress and Share on LAN", quickAction: "compress-share-on-lan", pathToken: "%F" },
  { action: "ShareOnLan", label: "Share on LAN", quickAction: "share-lan", pathToken: "%f" },
];

const archiveActions: ExpectedAction[] = [
  { action: "ExtractHere", label: "Extract Here", quickAction: "extract-here", pathToken: "%F" },
  {
    action: "ExtractToFolder",
    label: "Extract to Archive Folder",
    quickAction: "extract-to-folder",
    pathToken: "%f",
  },
  { action: "OpenArchive", label: "Open archive", quickAction: "open", pathToken: "%f" },
  ...createActions,
];

const windowsOrderedActions = [...archiveActions];

function readWorkspaceFile(...parts: string[]): string {
  return readFileSync(join(process.cwd(), ...parts), "utf8").replace(/\r\n/g, "\n");
}

function listedActions(entry: string): string[] {
  const match = entry.match(/^Actions=([^\n]+)$/m);
  expect(match, "desktop entry should define Actions").not.toBeNull();
  return match![1].split(";").filter(Boolean);
}

function expectAction(entry: string, expected: ExpectedAction): void {
  const blockStart = entry.indexOf(`[Desktop Action ${expected.action}]`);
  expect(blockStart, `${expected.action} block should exist`).toBeGreaterThan(-1);
  const nextBlock = entry.indexOf("\n[Desktop Action ", blockStart + 1);
  const block = entry.slice(blockStart, nextBlock === -1 ? undefined : nextBlock);
  expect(block).toContain(`Name=${expected.label}`);
  expect(block).toContain(`--quick-action ${expected.quickAction} --path ${expected.pathToken}`);
}

describe("Linux context menu packaging", () => {
  it("keeps desktop actions aligned with the Windows cascaded menu order", () => {
    const file = readWorkspaceFile("packaging", "linux", "zmanager.desktop.hbs");
    expect(listedActions(file)).toEqual(windowsOrderedActions.map((action) => action.action));
    for (const action of windowsOrderedActions) {
      expectAction(file, action);
    }
  });

  it("splits KDE archive and create service menus to match Windows selection behavior", () => {
    const archiveMenu = readWorkspaceFile(
      "packaging",
      "linux",
      "kde",
      "zmanager-archive-servicemenu.desktop",
    );
    const createMenu = readWorkspaceFile(
      "packaging",
      "linux",
      "kde",
      "zmanager-servicemenu.desktop",
    );

    expect(listedActions(archiveMenu)).toEqual(archiveActions.map((action) => action.action));
    expect(listedActions(createMenu)).toEqual(createActions.map((action) => action.action));
    expect(archiveMenu).not.toContain("MimeType=all/all;inode/directory;");
    expect(createMenu).toContain("MimeType=application/octet-stream;inode/directory;");

    for (const action of archiveActions) {
      expectAction(archiveMenu, action);
    }
    for (const action of createActions) {
      expectAction(createMenu, action);
    }
  });

  it("packages a Nautilus extension for real GNOME Files context menus", () => {
    const extension = readWorkspaceFile(
      "packaging",
      "linux",
      "nautilus",
      "zmanager_nautilus.py",
    );
    const tauriConfig = JSON.parse(readWorkspaceFile("src-tauri", "tauri.conf.json")) as {
      bundle: {
        linux: {
          deb: {
            depends: string[];
            files: Record<string, string>;
          };
          rpm: {
            depends: string[];
            files: Record<string, string>;
          };
        };
      };
    };

    expect(extension).toContain('repo.enumerate_versions("Nautilus")');
    expect(extension).toContain('gi.require_version("Nautilus", version)');
    expect(extension).toContain("def get_file_items(self, *args)");
    expect(extension).toContain("def get_background_items(self, *args)");
    expect(extension).toContain("class ZManagerMenuProvider");
    expect(extension).toContain('label="ZManager"');
    expect(extension).toContain("added_actions = set()");
    expect(extension).toContain("if action_name in added_actions:");

    const generatedExtension = readWorkspaceFile(
      "packaging",
      "linux",
      "nautilus",
      "zmanager_shell_actions_generated.py",
    );
    for (const action of windowsOrderedActions) {
      expect(generatedExtension).toContain(`"${action.label}"`);
      expect(generatedExtension).toContain(`"${action.quickAction}"`);
    }

    for (const [packageConfig, nautilusDependency] of [
      [tauriConfig.bundle.linux.deb, "python3-nautilus"],
      [tauriConfig.bundle.linux.rpm, "nautilus-python"],
    ] as const) {
      expect(packageConfig.depends).toContain(nautilusDependency);
      expect(packageConfig.files["/usr/share/nautilus-python/extensions/zmanager_nautilus.py"])
        .toBe("../packaging/linux/nautilus/zmanager_nautilus.py");
    }
  });

  it("does not include macOS-only compressAppleArchive action", () => {
    const file = readWorkspaceFile("packaging", "linux", "zmanager.desktop.hbs");
    expect(listedActions(file)).not.toContain("AddToAar");
    expect(file).not.toContain("compressAppleArchive");
    expect(file).not.toContain("compress-aar");
    expect(file).not.toContain("add-to-aar");
  });
});
