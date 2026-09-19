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
  it("registers the selected-item handler using the classic 7-Zip shell-extension contract", () => {
    const handlerMacroStart = script.indexOf("!macro ZM_REGISTER_CLASSIC_CONTEXT_MENU_HANDLER");
    const handlerMacroEnd = script.indexOf("!macroend", handlerMacroStart);
    expect(handlerMacroStart).toBeGreaterThan(-1);
    expect(handlerMacroEnd).toBeGreaterThan(handlerMacroStart);
    const handlerMacro = script.slice(handlerMacroStart, handlerMacroEnd);
    expect(handlerMacro).toContain("\\shellex\\ContextMenuHandlers\\${ZM_CLASSIC_CONTEXT_MENU_KEY}");
    expect(handlerMacro).toContain('"${ZM_CREATE_ROOT_CLSID}"');
    expect(script).toContain('!insertmacro ZM_REGISTER_CLASSIC_CONTEXT_MENU_HANDLER "*"');
    expect(script).toContain('!insertmacro ZM_REGISTER_CLASSIC_CONTEXT_MENU_HANDLER "Directory"');
    expect(script).toContain('!insertmacro ZM_REGISTER_CLASSIC_CONTEXT_MENU_HANDLER "Folder"');
    // The retired ExplorerCommandHandler cascade is gone for selected items;
    // only the folder background keeps a static ExtendedSubCommandsKey menu.
    expect(script).not.toContain("ExplorerCommandHandler\" \"${ROOT_CLSID}\"");
    expect(script).not.toContain("!macro ZM_WRITE_CASCADE_MENU");
    expect(script).not.toContain("ZM_WRITE_CREATE_CASCADE_MENU");
    expect(script).not.toContain("ZM_WRITE_ARCHIVE_CASCADE_MENU");
  });

  it("registers the COM class the way 7-Zip's DllRegisterServer does", () => {
    const registerStart = script.indexOf("!macro ZM_REGISTER_COM_CLASS");
    const registerEnd = script.indexOf("!macroend", registerStart);
    expect(registerStart).toBeGreaterThan(-1);
    const registerMacro = script.slice(registerStart, registerEnd);
    expect(registerMacro).toContain(
      'WriteRegStr HKCU "Software\\Classes\\CLSID\\${CLSID}" "" "${ZM_SHELL_EXTENSION_DESCRIPTION}"',
    );
    expect(registerMacro).toContain(
      'WriteRegStr HKCU "Software\\Classes\\CLSID\\${CLSID}\\InprocServer32" "" "$INSTDIR\\${ZM_SHELL_EXTENSION_NAME}"',
    );
    expect(registerMacro).toContain('"ThreadingModel" "Apartment"');
    expect(registerMacro).toContain(
      'WriteRegStr HKLM "${ZM_APPROVED_SHELL_EXTENSIONS_KEY}" "${CLSID}" "${ZM_SHELL_EXTENSION_DESCRIPTION}"',
    );

    const unregisterStart = script.indexOf("!macro ZM_UNREGISTER_COM_CLASS");
    const unregisterEnd = script.indexOf("!macroend", unregisterStart);
    expect(unregisterStart).toBeGreaterThan(-1);
    const unregisterMacro = script.slice(unregisterStart, unregisterEnd);
    expect(unregisterMacro).toContain('DeleteRegKey HKCU "Software\\Classes\\CLSID\\${CLSID}"');
    expect(unregisterMacro).toContain('DeleteRegValue HKLM "${ZM_APPROVED_SHELL_EXTENSIONS_KEY}" "${CLSID}"');
  });

  it("replaces a handler DLL that Explorer still holds open", () => {
    const macroStart = script.indexOf("!macro ZM_INSTALL_SHELL_EXTENSION_BINARY");
    const macroEnd = script.indexOf("!macroend", macroStart);
    expect(macroStart).toBeGreaterThan(-1);
    const macro = script.slice(macroStart, macroEnd);
    expect(macro).toContain('Rename "$INSTDIR\\${ZM_SHELL_EXTENSION_NAME}" "$INSTDIR\\${ZM_SHELL_EXTENSION_NAME}.old"');
    expect(macro).toContain('Delete /REBOOTOK "$INSTDIR\\${ZM_SHELL_EXTENSION_NAME}.old"');
    expect(macro).toContain('File /oname=${ZM_SHELL_EXTENSION_NAME} "${ZM_SHELL_EXTENSION_SOURCE}"');
    // A silent install must fail loudly instead of registering a handler that
    // points at a DLL that never got written.
    expect(macro).toContain("Abort ");

    const postInstallStart = script.indexOf("!macro NSIS_HOOK_POSTINSTALL");
    const postInstall = script.slice(postInstallStart, script.indexOf("!macroend", postInstallStart));
    expect(postInstall).toContain("!insertmacro ZM_INSTALL_SHELL_EXTENSION_BINARY");
    expect(postInstall).not.toContain('File /oname=${ZM_SHELL_EXTENSION_NAME}');
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
