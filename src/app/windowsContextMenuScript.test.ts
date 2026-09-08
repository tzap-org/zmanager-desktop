import { describe, expect, it } from "vitest";
import { SUPPORTED_ARCHIVE_DIALOG_EXTENSIONS } from "./archiveFileTypes";

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

const script = readFileSync(
  join(process.cwd(), "packaging", "windows", "nsis-context-menu.nsh"),
  "utf8",
);

const expectedWindowsArchiveExtensions = [...new Set([...SUPPORTED_ARCHIVE_DIALOG_EXTENSIONS])]
  .map((extension) => `.${extension}`)
  .sort();

function registeredArchiveExtensions(macroName: string): string[] {
  const macroStart = script.indexOf(`!macro ${macroName}`);
  expect(macroStart, `${macroName} should exist`).toBeGreaterThan(-1);
  const macroEnd = script.indexOf("!macroend", macroStart);
  expect(macroEnd, `${macroName} should end`).toBeGreaterThan(macroStart);
  return Array.from(
    script.slice(macroStart, macroEnd).matchAll(/ZM_(?:UN)?REGISTER_ARCHIVE_EXTENSION "([^"]+)"/g),
    (match) => match[1],
  ).sort();
}

describe("Windows context menu installer hook", () => {
  it("registers one root IExplorerCommand provider for each selected-item cascade", () => {
    const cascadeMacroStart = script.indexOf("!macro ZM_WRITE_CASCADE_MENU");
    const cascadeMacroEnd = script.indexOf("!macroend", cascadeMacroStart);
    expect(cascadeMacroStart).toBeGreaterThan(-1);
    expect(cascadeMacroEnd).toBeGreaterThan(cascadeMacroStart);
    const cascadeMacro = script.slice(cascadeMacroStart, cascadeMacroEnd);
    expect(cascadeMacro).toContain('DeleteRegValue HKCU "${SHELL_KEY}\\${ZM_MENU_KEY}" "SubCommands"');
    expect(cascadeMacro).toContain('DeleteRegValue HKCU "${SHELL_KEY}\\${ZM_MENU_KEY}" "ExtendedSubCommandsKey"');
    expect(cascadeMacro).toContain('WriteRegStr HKCU "${SHELL_KEY}\\${ZM_MENU_KEY}" "ExplorerCommandHandler" "${ROOT_CLSID}"');
    expect(cascadeMacro).not.toContain('WriteRegStr HKCU "${SHELL_KEY}\\${ZM_MENU_KEY}" "ExtendedSubCommandsKey"');
    expect(script).toContain('!insertmacro ZM_WRITE_CASCADE_MENU "${SHELL_KEY}" "${ZM_ARCHIVE_ROOT_CLSID}"');
    expect(script).toContain('!insertmacro ZM_WRITE_CASCADE_MENU "${SHELL_KEY}" "${ZM_CREATE_ROOT_CLSID}"');
    expect(script).not.toContain('!insertmacro ZM_REGISTER_GENERATED_ARCHIVE_SUBCOMMANDS');
    expect(script).not.toContain('!insertmacro ZM_REGISTER_GENERATED_CREATE_FILE_SUBCOMMANDS');
  });

  it("keeps the archive submenu actions in the requested order", () => {
    const generatedSource = readFileSync(
      join(process.cwd(), "native", "windows-shell-extension", "src", "generated.rs"),
      "utf8",
    );

    expect(generatedSource).toContain("pub(crate) const ARCHIVE_ROOT_CLSID");
    expect(generatedSource).toContain("pub(crate) const CREATE_ROOT_CLSID");
    const archiveActionsStart = generatedSource.indexOf("pub(crate) const ARCHIVE_EXPLORER_ACTIONS");
    const createActionsStart = generatedSource.indexOf("pub(crate) const CREATE_EXPLORER_ACTIONS");
    expect(archiveActionsStart).toBeGreaterThan(-1);
    expect(createActionsStart).toBeGreaterThan(archiveActionsStart);
    const archiveActions = generatedSource.slice(archiveActionsStart, createActionsStart);

    let cursor = -1;
    for (const action of [
      "ExtractHere",
      "ExtractToFolder",
      "Open",
      "Compress",
      "CompressTzap",
      "CompressZip",
      "CompressSevenZ",
      "CompressTarZst",
      "CompressTarGz",
    ]) {
      const marker = `ExplorerAction::${action}`;
      const index = archiveActions.indexOf(marker);
      expect(index, `${marker} should be present`).toBeGreaterThan(-1);
      expect(index, `${marker} should follow the previous action`).toBeGreaterThan(cursor);
      cursor = index;
    }

    const generatedScript = readFileSync(
      join(process.cwd(), "packaging", "windows", "nsis-shell-actions.generated.nsh"),
      "utf8",
    );
    expect(generatedScript).toContain('!define ZM_ARCHIVE_ROOT_CLSID "{D5BA8F7A-BB17-4C40-BB7B-28E971B37288}"');
    expect(generatedScript).toContain('!define ZM_CREATE_ROOT_CLSID "{5AF01874-4485-4FCF-B31A-37918614B6C5}"');
    expect(generatedScript).toContain("!macro ZM_REGISTER_GENERATED_SHELL_EXTENSION_CLASSES");
    expect(generatedScript).not.toContain("ZM_REGISTER_GENERATED_ARCHIVE_SUBCOMMANDS");
    expect(generatedScript).not.toContain("ZM_REGISTER_GENERATED_CREATE_FILE_SUBCOMMANDS");
    expect(generatedScript).toContain("!macro ZM_REGISTER_GENERATED_BACKGROUND_SUBCOMMANDS SUBCOMMANDS_KEY");
  });

  it("does not use the removed shell multi-select coordinator flag", () => {
    expect(script).not.toContain("--shell-multi-select");
  });

  it("cleans up the retired generic file cascade without writing it again", () => {
    expect(script).toContain('!insertmacro ZM_DELETE_CASCADE_MENU "Software\\Classes\\*\\shell"');
    expect(script).not.toContain('!insertmacro ZM_WRITE_FILTERED_CREATE_CASCADE_MENU "Software\\Classes\\*\\shell"');
  });

  it("does not include macOS-only AddToAar action", () => {
    const generatedScript = readFileSync(
      join(process.cwd(), "packaging", "windows", "nsis-shell-actions.generated.nsh"),
      "utf8",
    );
    expect(generatedScript).not.toContain("AddToAar");
    expect(generatedScript).not.toContain("compressAppleArchive");
    expect(generatedScript).not.toContain("compress-aar");
  });

  it("keeps Windows archive extension registration aligned with frontend archive support", () => {
    expect(registeredArchiveExtensions("ZM_REGISTER_ARCHIVE_EXTENSIONS")).toEqual(
      expectedWindowsArchiveExtensions,
    );
    expect(registeredArchiveExtensions("ZM_UNREGISTER_ARCHIVE_EXTENSIONS")).toEqual(
      expectedWindowsArchiveExtensions,
    );
    for (const extension of expectedWindowsArchiveExtensions) {
      expect(script).toContain(`NOT System.FileExtension:=${extension}`);
    }
  });
});
