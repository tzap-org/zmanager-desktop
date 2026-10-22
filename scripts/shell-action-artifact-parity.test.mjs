import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await readFile(path.join(root, "manifests/shell-actions.json"), "utf8"),
);
const read = (relative) => readFile(path.join(root, relative), "utf8");
const macosFinderActionSupport = await read(
  "native/macos/Sources/ZManagerFinderExtensionSupport/FinderActionSupport.swift",
);
const macosFinderEnglish = await read(
  "packaging/macos/FinderExtension/en.lproj/FinderActions.strings",
);
const macosFinderZhHans = await read(
  "packaging/macos/FinderExtension/zh-Hans.lproj/FinderActions.strings",
);
const artifacts = {
  windowsExplorer: [
    await read("native/windows-shell-extension/src/generated.rs"),
    await read("packaging/windows/nsis-shell-actions.generated.nsh"),
  ],
  linuxDesktop: [
    await read("packaging/linux/zmanager.desktop.hbs"),
  ],
  linuxNautilus: [
    await read("packaging/linux/nautilus/zmanager_shell_actions_generated.py"),
  ],
  linuxKde: [
    await read("packaging/linux/kde/zmanager-archive-servicemenu.desktop"),
    await read("packaging/linux/kde/zmanager-servicemenu.desktop"),
  ],
  macosFinder: [
    await read("native/macos/Sources/ZManagerGenerated/ShellActions.generated.swift"),
    macosFinderEnglish,
  ],
  macosServices: [
    await read("native/macos/Sources/ZManagerGenerated/ShellActions.generated.swift"),
    await read("packaging/macos/main-info.generated.json"),
  ],
};

const ordered = (context) => manifest.actions
  .filter((action) => action.contextMenuContexts.includes(context))
  .sort((left, right) => left.contextMenuOrder - right.contextMenuOrder)
  .map(({ id }) => id);

test("canonical context matrices have one stable generated order", () => {
  assert.deepEqual(ordered("archiveSingle"), [
    "extractHere",
    "extractToFolder",
    "open",
    "compress",
    "compressTzap",
    "compressZip",
    "compressSevenZ",
    "compressTarZst",
    "compressTarGz",
    "compressAppleArchive",
    "compressShareOnLan",
    "shareOnLan",
  ]);
  assert.deepEqual(ordered("archiveMultiple"), [
    "extractHere",
    "compress",
    "compressTzap",
    "compressZip",
    "compressSevenZ",
    "compressTarZst",
    "compressTarGz",
    "compressAppleArchive",
    "compressShareOnLan",
  ]);
  assert.deepEqual(ordered("creation"), [
    "compress",
    "compressTzap",
    "compressZip",
    "compressSevenZ",
    "compressTarZst",
    "compressTarGz",
    "compressAppleArchive",
    "compressShareOnLan",
    "shareOnLan",
  ]);
  assert.deepEqual(ordered("container"), ["compress", "compressTzap", "compressZip", "compressSevenZ", "compressTarZst", "compressTarGz", "compressAppleArchive", "compressShareOnLan"]);
});

test("every declared native surface contains generated action identity and label", () => {
  for (const action of manifest.actions) {
    for (const surface of action.nativeSurfaces) {
      assert.ok(
        artifacts[surface].some((artifact) =>
          artifact.includes(action.nativeVerb)
          && artifact.includes(action.canonicalLabel)),
        `${surface} is missing ${action.id}`,
      );
    }
  }
});

test("compatibility-only actions stay outside parity context menus", () => {
  for (const id of ["extract", "compressCleanSource"]) {
    const action = manifest.actions.find((candidate) => candidate.id === id);
    assert.equal(action.contextMenuOrder, null);
    assert.deepEqual(action.contextMenuContexts, []);
  }
});

test("macOS Finder quick actions route callback URLs to the singleton application instance", () => {
  assert.match(
    macosFinderActionSupport,
    /NSWorkspace\.shared\.open\(url\)/,
  );
});

test("macOS Finder named labels are generated for every declared locale", () => {
  const namedActions = manifest.actions.filter(
    ({ macOSFinderNamedLabel }) => typeof macOSFinderNamedLabel === "string",
  );
  assert.ok(namedActions.length > 0);
  for (const action of namedActions) {
    const key = `${action.displayKey}Named`;
    assert.ok(macosFinderActionSupport.includes(key), `Finder support is missing ${key}`);
    assert.ok(macosFinderEnglish.includes(JSON.stringify(key)));
    assert.ok(macosFinderEnglish.includes(JSON.stringify(action.macOSFinderNamedLabel)));
    assert.ok(macosFinderZhHans.includes(JSON.stringify(key)));
    assert.ok(macosFinderZhHans.includes(JSON.stringify(action.macOSFinderNamedLabelZhHans)));
  }
});
