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
  it("registers ExtendedSubCommandsKey as a parent-local submenu key", () => {
    expect(script).toContain('DeleteRegKey HKCU "${SHELL_KEY}\\${ZM_MENU_KEY}\\ExtendedSubCommandsKey"');
    expect(script).toContain('WriteRegStr HKCU "${SHELL_KEY}\\${ZM_MENU_KEY}\\ExtendedSubCommandsKey\\shell\\${VERB_NAME}"');
    expect(script).toContain('DeleteRegValue HKCU "${SHELL_KEY}\\${ZM_MENU_KEY}" "SubCommands"');
    expect(script).not.toContain('WriteRegStr HKCU "${SHELL_KEY}\\${ZM_MENU_KEY}" "ExtendedSubCommandsKey"');
    expect(script).toContain('!insertmacro ZM_REGISTER_GENERATED_ARCHIVE_SUBCOMMANDS "${SHELL_KEY}"');
    expect(script).toContain('!insertmacro ZM_REGISTER_GENERATED_CREATE_FILE_SUBCOMMANDS "${SHELL_KEY}"');
    expect(script).toContain('!insertmacro ZM_REGISTER_GENERATED_BACKGROUND_SUBCOMMANDS "${SHELL_KEY}"');
  });

  it("keeps the archive submenu actions in the requested order", () => {
    const expected = [
      '"01ExtractHere" "Extract Here"',
      '"02ExtractToFolder" "Extract to Archive Folder"',
      '"03OpenArchive" "Open archive"',
      '"04AddToArchive" "Add to archive..."',
      '"05AddToTzap" "Add to .tzap"',
      '"06AddToZip" "Add to .zip"',
      '"07AddToSevenZ" "Add to .7z"',
      '"08AddToTzst" "Add to .tzst"',
      '"09AddToTgz" "Add to .tgz"',
    ];

    const generatedScript = readFileSync(
      join(process.cwd(), "packaging", "windows", "nsis-shell-actions.generated.nsh"),
      "utf8",
    );

    expect(generatedScript).toContain("!macro ZM_REGISTER_GENERATED_ARCHIVE_SUBCOMMANDS SHELL_KEY");
    expect(generatedScript).toContain("!macro ZM_REGISTER_GENERATED_CREATE_FILE_SUBCOMMANDS SHELL_KEY");
    expect(generatedScript).toContain("!macro ZM_REGISTER_GENERATED_BACKGROUND_SUBCOMMANDS SHELL_KEY");

    let cursor = -1;
    for (const marker of expected) {
      const index = generatedScript.indexOf(marker);
      expect(index, `${marker} should be present`).toBeGreaterThan(-1);
      expect(index, `${marker} should follow the previous action`).toBeGreaterThan(cursor);
      cursor = index;
    }
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
