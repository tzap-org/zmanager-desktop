import { describe, expect, it } from "vitest";

declare const process: {
  cwd(): string;
};

declare function require(id: "fs"): {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: string): string;
  readdirSync(path: string): string[];
  statSync(path: string): {
    isDirectory(): boolean;
    isFile(): boolean;
  };
};

declare function require(id: "path"): {
  join(...parts: string[]): string;
  relative(from: string, to: string): string;
};

const { existsSync, readFileSync, readdirSync, statSync } = require("fs");
const { join, relative } = require("path");

function normalizedWorkspaceFile(...parts: string[]): string {
  return readFileSync(workspaceFilePath(...parts), "utf8").replace(
    /\r\n/g,
    "\n",
  );
}

function workspaceFilePath(...parts: string[]): string {
  return join(process.cwd(), ...parts);
}

function workspaceRelativePath(filePath: string): string {
  return relative(process.cwd(), filePath).replace(/\\/g, "/");
}

const styles = normalizedWorkspaceFile("src", "styles.tailwind.css");
const compositionRootSource = normalizedWorkspaceFile("src", "main.ts");
const runtimeBridgeSource = normalizedWorkspaceFile("src", "runtimeBridge.ts");
const mainSource = normalizedWorkspaceFile(
  "src",
  "runtime",
  "zmanagerRuntimeAdapter.ts",
);
const contextMenuRuntimeSource = normalizedWorkspaceFile(
  "src",
  "runtime",
  "contextMenuRuntime.ts",
);
const appShellSource = normalizedWorkspaceFile(
  "src",
  "ui",
  "react",
  "AppShell.tsx",
);
const appFrameSource = normalizedWorkspaceFile(
  "src",
  "ui",
  "react",
  "shell",
  "AppFrame.tsx",
);
const menuBarSource = normalizedWorkspaceFile(
  "src",
  "ui",
  "react",
  "shell",
  "MenuBar.tsx",
);
const commandToolbarSource = normalizedWorkspaceFile(
  "src",
  "ui",
  "react",
  "shell",
  "CommandToolbar.tsx",
);
const statusBarSource = normalizedWorkspaceFile(
  "src",
  "ui",
  "react",
  "shell",
  "StatusBar.tsx",
);
const dropOverlaySource = normalizedWorkspaceFile(
  "src",
  "ui",
  "react",
  "shell",
  "DropOverlay.tsx",
);
const browserFileDropAdapterSource = normalizedWorkspaceFile(
  "src",
  "ui",
  "react",
  "interaction",
  "BrowserFileDropAdapter.tsx",
);
const paneResizerSource = normalizedWorkspaceFile(
  "src",
  "ui",
  "react",
  "interaction",
  "PaneResizer.tsx",
);
const dialogRootSource = normalizedWorkspaceFile(
  "src",
  "ui",
  "react",
  "dialogs",
  "DialogRoot.tsx",
);
const desktopDialogSource = normalizedWorkspaceFile(
  "src",
  "ui",
  "react",
  "dialogs",
  "DesktopDialog.tsx",
);
const accountWorkspaceSource = normalizedWorkspaceFile(
  "src",
  "ui",
  "react",
  "account",
  "AccountWorkspace.tsx",
);
const appRuntimeSource = normalizedWorkspaceFile(
  "src",
  "ui",
  "react",
  "appRuntime.ts",
);
const contextMenuRootSource = normalizedWorkspaceFile(
  "src",
  "ui",
  "react",
  "context-menu",
  "ContextMenuRoot.tsx",
);
const preferencesDialogSource = normalizedWorkspaceFile(
  "src",
  "ui",
  "react",
  "preferences",
  "PreferencesDialog.tsx",
);
const archiveWorkspaceSource = normalizedWorkspaceFile(
  "src",
  "ui",
  "react",
  "archive",
  "ArchiveWorkspace.tsx",
);
const archiveTableSource = normalizedWorkspaceFile(
  "src",
  "ui",
  "react",
  "archive",
  "ArchiveTable.tsx",
);
const archiveTreeSource = normalizedWorkspaceFile(
  "src",
  "ui",
  "react",
  "archive",
  "ArchiveTree.tsx",
);
const archivePathBarSource = normalizedWorkspaceFile(
  "src",
  "ui",
  "react",
  "archive",
  "ArchivePathBar.tsx",
);
const archiveDetailsPaneSource = normalizedWorkspaceFile(
  "src",
  "ui",
  "react",
  "archive",
  "ArchiveDetailsPane.tsx",
);
const createWorkspaceSource = normalizedWorkspaceFile(
  "src",
  "ui",
  "react",
  "create",
  "CreateWorkspace.tsx",
);
const createPasswordContextSource = normalizedWorkspaceFile(
  "src",
  "ui",
  "react",
  "create",
  "CreatePasswordContext.tsx",
);
const workspaceBrowserShellSource = normalizedWorkspaceFile(
  "src",
  "ui",
  "react",
  "workspace",
  "WorkspaceBrowserShell.tsx",
);
const workspacePathBarSource = normalizedWorkspaceFile(
  "src",
  "ui",
  "react",
  "workspace",
  "WorkspacePathBar.tsx",
);
const tableMarqueeSelectionSource = normalizedWorkspaceFile(
  "src",
  "ui",
  "react",
  "workspace",
  "tableMarqueeSelection.ts",
);
const extractStartControllerSource = normalizedWorkspaceFile(
  "src",
  "app",
  "controllers",
  "extractStartController.ts",
);
const dialogSnapshotsSource = normalizedWorkspaceFile(
  "src",
  "app",
  "display",
  "dialogSnapshots.ts",
);
const shellWorkspaceSource = normalizedWorkspaceFile(
  "src",
  "app",
  "shell",
  "shellWorkspace.ts",
);
const archiveWorkspaceStateSource = normalizedWorkspaceFile(
  "src",
  "app",
  "workspaces",
  "archiveWorkspace.ts",
);
const createWorkspaceStateSource = normalizedWorkspaceFile(
  "src",
  "app",
  "workspaces",
  "createWorkspace.ts",
);
const contextMenuModelSource = normalizedWorkspaceFile(
  "src",
  "app",
  "commands",
  "contextMenuModel.ts",
);
const contextMenuHelpersSource = normalizedWorkspaceFile(
  "src",
  "ui",
  "contextMenuHelpers.ts",
);
const modalControllerSource = normalizedWorkspaceFile(
  "src",
  "ui",
  "modalController.ts",
);
const constantsSource = normalizedWorkspaceFile("src", "app", "constants.ts");

type FutureForbiddenTargetId = never;

type FutureForbiddenTarget = Readonly<{
  id: FutureForbiddenTargetId;
  phase: string;
  description: string;
}>;

const FUTURE_FORBIDDEN_TARGETS: readonly FutureForbiddenTarget[] = [];

type AuditScanId =
  | "hiddenLegacyDom"
  | "dangerousHtml"
  | "legacyViewImports"
  | "innerHtml"
  | "broadDomWiring";

type AuditScanDefinition = Readonly<{
  id: AuditScanId;
  command: string;
  roots: readonly string[];
  pattern: RegExp;
}>;

const LEGACY_AUDIT_SCANS: readonly AuditScanDefinition[] = [
  {
    id: "hiddenLegacyDom",
    command:
      "rg -n \"zmanager-runtime-bridge-root|appRoot\\.innerHTML|privatizeLegacy|writeReactExtractFormToLegacyControls\" src --glob '!**/*.test.ts' --glob '!**/*.test.tsx'",
    roots: ["src"],
    pattern:
      /zmanager-runtime-bridge-root|appRoot\.innerHTML|privatizeLegacy|writeReactExtractFormToLegacyControls/,
  },
  {
    id: "dangerousHtml",
    command:
      "rg -n \"dangerouslySetInnerHTML|html:\" src\\ui\\react src\\runtime src\\runtimeBridge.ts --glob '!**/*.test.ts' --glob '!**/*.test.tsx'",
    roots: ["src/ui/react", "src/runtime", "src/runtimeBridge.ts"],
    pattern: /dangerouslySetInnerHTML|html:/,
  },
  {
    id: "legacyViewImports",
    command:
      "rg -n 'ui/(archiveWorkspaceView|createWorkspaceView)' src --glob '!**/*.test.ts' --glob '!**/*.test.tsx'",
    roots: ["src"],
    pattern: /ui\/(?:archiveWorkspaceView|createWorkspaceView)/,
  },
  {
    id: "innerHtml",
    command:
      "rg -n \"innerHTML|insertAdjacentHTML\" src --glob '!**/*.test.ts' --glob '!**/*.test.tsx'",
    roots: ["src"],
    pattern: /innerHTML|insertAdjacentHTML/,
  },
  {
    id: "broadDomWiring",
    command:
      "rg -n \"document\\.querySelector|getElementById|addEventListener\" src\\runtimeBridge.ts src\\runtime src\\ui\\react src\\app src\\desktop --glob '!**/*.test.ts' --glob '!**/*.test.tsx'",
    roots: [
      "src/runtimeBridge.ts",
      "src/runtime",
      "src/ui/react",
      "src/app",
      "src/desktop",
    ],
    pattern: /document\.querySelector|getElementById|addEventListener/,
  },
];

type AllowedLegacyException = Readonly<{
  id: string;
  scanId: AuditScanId;
  targetId: FutureForbiddenTargetId;
  file: string;
  line: string;
  reason: string;
}>;

const ALLOWED_HIDDEN_LEGACY_DOM_EXCEPTIONS: readonly AllowedLegacyException[] =
  [];

const ALLOWED_DANGEROUS_HTML_EXCEPTIONS: readonly AllowedLegacyException[] = [];

const ALLOWED_LEGACY_VIEW_IMPORT_EXCEPTIONS: readonly AllowedLegacyException[] =
  [];

const ALLOWED_INNER_HTML_EXCEPTIONS: readonly AllowedLegacyException[] = [];

const ALLOWED_LEGACY_EXCEPTIONS = [
  ...ALLOWED_HIDDEN_LEGACY_DOM_EXCEPTIONS,
  ...ALLOWED_DANGEROUS_HTML_EXCEPTIONS,
  ...ALLOWED_LEGACY_VIEW_IMPORT_EXCEPTIONS,
  ...ALLOWED_INNER_HTML_EXCEPTIONS,
];

const ALLOWED_BROAD_DOM_ACCESS_FILES: readonly Readonly<{
  file: string;
  reason: string;
}>[] = [
  {
    file: "src/ui/react/dialogs/DialogRoot.tsx",
    reason: "React dialogs own escape-key and return-focus DOM interactions.",
  },
];

type AllowedImportException = Readonly<{
  file: string;
  specifier: string;
  targetId: FutureForbiddenTargetId;
  reason: string;
}>;

const ALLOWED_REACT_API_DESKTOP_IMPORT_EXCEPTIONS: readonly AllowedImportException[] =
  [];

type SourceLineMatch = Readonly<{
  file: string;
  lineNumber: number;
  line: string;
}>;

type ImportReference = Readonly<{
  file: string;
  lineNumber: number;
  specifier: string;
}>;

function listWorkspaceFiles(...rootParts: string[]): string[] {
  const root = workspaceFilePath(...rootParts);
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const filePath = join(directory, entry);
      const stat = statSync(filePath);
      if (stat.isDirectory()) {
        visit(filePath);
      } else if (stat.isFile()) {
        files.push(workspaceRelativePath(filePath));
      }
    }
  };
  visit(root);
  return files.sort();
}

function isProductionSourceFile(file: string): boolean {
  return /\.(?:css|ts|tsx)$/.test(file) && !/\.test\.(?:ts|tsx)$/.test(file);
}

function productionSourceFilesFromRoots(roots: readonly string[]): string[] {
  return uniqueSorted(
    roots
      .flatMap((root) => {
        const rootParts = root.split("/");
        const rootPath = workspaceFilePath(...rootParts);
        const stat = statSync(rootPath);
        if (stat.isFile()) {
          return [root];
        }
        return listWorkspaceFiles(...rootParts);
      })
      .filter(isProductionSourceFile),
  );
}

function sourceLineMatches(
  files: readonly string[],
  pattern: RegExp,
): SourceLineMatch[] {
  const linePattern = new RegExp(
    pattern.source,
    pattern.flags.replace("g", ""),
  );
  const matches: SourceLineMatch[] = [];
  for (const file of files) {
    const lines = normalizedWorkspaceFile(...file.split("/")).split("\n");
    lines.forEach((line, index) => {
      linePattern.lastIndex = 0;
      if (linePattern.test(line)) {
        matches.push({ file, lineNumber: index + 1, line: line.trim() });
      }
    });
  }
  return matches;
}

function sourceLineMatchesForScan(scanId: AuditScanId): SourceLineMatch[] {
  const scan = auditScan(scanId);
  return sourceLineMatches(
    productionSourceFilesFromRoots(scan.roots),
    scan.pattern,
  );
}

function auditScan(scanId: AuditScanId): AuditScanDefinition {
  const scan = LEGACY_AUDIT_SCANS.find((candidate) => candidate.id === scanId);
  if (!scan) {
    throw new Error(`missing audit scan: ${scanId}`);
  }
  return scan;
}

function expectScanMatchesOnlyAllowed(scanId: AuditScanId) {
  expect(sourceLineMatchesForScan(scanId).map(sourceLineKey).sort()).toEqual(
    ALLOWED_LEGACY_EXCEPTIONS.filter((exception) => exception.scanId === scanId)
      .map((exception) => sourceLineKey(exception))
      .sort(),
  );
}

function sourceLineKey(match: Pick<SourceLineMatch, "file" | "line">): string {
  return JSON.stringify([match.file, match.line.trim()]);
}

function uniqueSorted(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function importReferencesForFiles(files: readonly string[]): ImportReference[] {
  const references: ImportReference[] = [];
  const importStatementPattern = /\bimport[\s\S]*?;(?=\n|$)/g;

  for (const file of files) {
    const source = normalizedWorkspaceFile(...file.split("/"));
    let match: RegExpExecArray | null;
    while ((match = importStatementPattern.exec(source)) !== null) {
      const statement = match[0];
      const specifier =
        /\bfrom\s+["']([^"']+)["']/.exec(statement)?.[1] ??
        /^import\s+["']([^"']+)["']/.exec(statement.trim())?.[1];
      if (!specifier) {
        continue;
      }
      references.push({
        file,
        lineNumber: source.slice(0, match.index).split("\n").length,
        specifier,
      });
    }
  }

  return references;
}

function importReferenceKey(
  reference: Pick<ImportReference, "file" | "specifier">,
): string {
  return JSON.stringify([reference.file, reference.specifier]);
}

function importTargetFor(
  reference: Pick<ImportReference, "file" | "specifier">,
): string {
  if (!reference.specifier.startsWith(".")) {
    return reference.specifier;
  }
  const directory = reference.file.slice(0, reference.file.lastIndexOf("/"));
  return normalizePosixPath(`${directory}/${reference.specifier}`);
}

function importTargetsSrcDirectory(
  reference: ImportReference,
  directory: "api" | "desktop" | "ui/react",
): boolean {
  const target = importTargetFor(reference);
  return (
    target === `src/${directory}` || target.startsWith(`src/${directory}/`)
  );
}

function normalizePosixPath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function controllerDomGlobalMatches(): SourceLineMatch[] {
  const controllerFiles = productionSourceFilesFromRoots([
    "src/app/controllers",
  ]);
  return sourceLineMatches(
    controllerFiles,
    /\b(?:document|window)\s*\.|\b(?:HTMLElement|HTMLInputElement|HTMLButtonElement|HTMLDivElement|HTMLTableElement|HTMLDetailsElement|HTMLSelectElement|HTMLTextAreaElement|HTMLDataListElement|HTMLSpanElement|HTMLParagraphElement|HTMLHeadingElement|HTMLOutputElement|Element|Node|KeyboardEvent|MouseEvent|PointerEvent|DragEvent|EventTarget|DataTransfer)\b|\baddEventListener\s*\(/,
  );
}

function selectorsContainingFirstTableColumnRules(css: string): string[] {
  const selectors: string[] = [];
  const rulePattern = /(^|})\s*([^{}@][^{}]*)\{/g;
  let match: RegExpExecArray | null;
  while ((match = rulePattern.exec(css)) !== null) {
    const selectorList = match[2];
    if (!/\b(?:td|th):first-child\b/.test(selectorList)) {
      continue;
    }
    selectors.push(
      ...selectorList
        .split(",")
        .map((selector) => selector.trim())
        .filter(Boolean),
    );
  }
  return selectors;
}

describe("GUI layout contracts", () => {
  for (const target of FUTURE_FORBIDDEN_TARGETS) {
    it.todo(`${target.phase}: final guardrail forbids ${target.description}`);
  }

  it("keeps main.ts as the React composition root", () => {
    expect(compositionRootSource).toContain('import("./ui/react/AppShell")');
    expect(compositionRootSource).toContain('import("./runtime/DisposableTaskRuntimeApp")');
    expect(compositionRootSource).toContain("createRoot(app).render(");
    expect(compositionRootSource).not.toContain('from "./runtimeBridge"');
    expect(compositionRootSource).not.toMatch(
      /from "\.\/(?:api|desktop|app\/controllers|app\/workspaces)\//,
    );
    expect(compositionRootSource).not.toContain("appRoot.innerHTML");
    expect(compositionRootSource).not.toContain("@tauri-apps/api/");
  });

  it("records the Phase 0 audit rg scans used by the guardrails", () => {
    expect(LEGACY_AUDIT_SCANS.map((scan) => scan.command)).toEqual([
      "rg -n \"zmanager-runtime-bridge-root|appRoot\\.innerHTML|privatizeLegacy|writeReactExtractFormToLegacyControls\" src --glob '!**/*.test.ts' --glob '!**/*.test.tsx'",
      "rg -n \"dangerouslySetInnerHTML|html:\" src\\ui\\react src\\runtime src\\runtimeBridge.ts --glob '!**/*.test.ts' --glob '!**/*.test.tsx'",
      "rg -n 'ui/(archiveWorkspaceView|createWorkspaceView)' src --glob '!**/*.test.ts' --glob '!**/*.test.tsx'",
      "rg -n \"innerHTML|insertAdjacentHTML\" src --glob '!**/*.test.ts' --glob '!**/*.test.tsx'",
      "rg -n \"document\\.querySelector|getElementById|addEventListener\" src\\runtimeBridge.ts src\\runtime src\\ui\\react src\\app src\\desktop --glob '!**/*.test.ts' --glob '!**/*.test.tsx'",
    ]);
  });

  it("keeps runtimeBridge.ts as a tiny pre-runtime migration seam", () => {
    expect(
      runtimeBridgeSource.split("\n").filter((line) => line.trim()).length,
    ).toBeLessThanOrEqual(5);
    expect(compositionRootSource).toContain('import "./styles.tailwind.css";');
    expect(runtimeBridgeSource).not.toContain(
      'import "./styles.tailwind.css";',
    );
    expect(styles.trim()).toBe('@import "tailwindcss";');
    expect(existsSync(join(process.cwd(), "src", "styles.css"))).toBe(false);

    expect(runtimeBridgeSource).toContain(
      "export async function getZManagerRuntimeAdapter",
    );
    expect(runtimeBridgeSource).not.toContain("createCommandRouter");
    expect(runtimeBridgeSource).not.toContain("createArchiveWorkspace");
    expect(runtimeBridgeSource).not.toContain("appRoot.innerHTML");
  });

  it("keeps every allowed architecture exception mapped to a later deletion target", () => {
    const targetIds = new Set(
      FUTURE_FORBIDDEN_TARGETS.map((target) => target.id),
    );
    const scanIds = new Set(LEGACY_AUDIT_SCANS.map((scan) => scan.id));
    const allowedExceptionIds = ALLOWED_LEGACY_EXCEPTIONS.map(
      (exception) => exception.id,
    );
    const usedTargetIds = new Set([
      ...ALLOWED_LEGACY_EXCEPTIONS.map((exception) => exception.targetId),
      ...ALLOWED_REACT_API_DESKTOP_IMPORT_EXCEPTIONS.map(
        (exception) => exception.targetId,
      ),
    ]);

    expect(allowedExceptionIds.sort()).toEqual(
      uniqueSorted(allowedExceptionIds),
    );
    expect(
      ALLOWED_LEGACY_EXCEPTIONS.filter(
        (exception) => !targetIds.has(exception.targetId),
      ).map((exception) => exception.id),
    ).toEqual([]);
    expect(
      ALLOWED_LEGACY_EXCEPTIONS.filter(
        (exception) => !scanIds.has(exception.scanId),
      ).map((exception) => exception.id),
    ).toEqual([]);
    expect(
      ALLOWED_REACT_API_DESKTOP_IMPORT_EXCEPTIONS.filter(
        (exception) => !targetIds.has(exception.targetId),
      ).map((exception) => exception.file),
    ).toEqual([]);
    expect(
      FUTURE_FORBIDDEN_TARGETS.filter(
        (target) => !usedTargetIds.has(target.id),
      ).map((target) => target.id),
    ).toEqual([]);
  });

  it("forbids the hidden legacy DOM bootstrap", () => {
    expectScanMatchesOnlyAllowed("hiddenLegacyDom");
  });

  it("forbids dangerous React and runtime HTML rendering exceptions", () => {
    expectScanMatchesOnlyAllowed("dangerousHtml");
  });

  it("keeps context menus as typed snapshots rendered by React without raw HTML", () => {
    expect(appRuntimeSource).toContain("items: readonly ContextMenuItem[];");
    expect(appRuntimeSource).not.toContain("html: string;");
    expect(contextMenuRuntimeSource).toContain(
      "show(x: number, y: number, items: readonly ContextMenuItem[]): void;",
    );
    expect(contextMenuRuntimeSource).toContain(
      "let snapshot: ZManagerContextMenuSnapshot",
    );
    expect(mainSource).toContain("contextMenuRuntime.show(");
    expect(mainSource).not.toContain("function showContextMenu(");
    expect(mainSource).not.toContain(
      "function showContextMenu(x: number, y: number, html: string)",
    );
    expect(mainSource).not.toContain("data-context-action");
    expect(contextMenuModelSource).toContain("export type ContextMenuItem");
    expect(contextMenuModelSource).toContain(
      "export type ContextMenuActionPayload",
    );
    expect(contextMenuRootSource).toContain("function renderContextMenuItem");
    expect(contextMenuRootSource).toContain("<PopoverContent");
    expect(contextMenuRootSource).toContain("onInteractOutside");
    expect(contextMenuRootSource).not.toContain("addEventListener(");
    expect(contextMenuRootSource).not.toContain("dangerouslySetInnerHTML");
  });

  it("forbids legacy archive/create view imports", () => {
    expectScanMatchesOnlyAllowed("legacyViewImports");
  });

  it("keeps create workspace rendering and selection out of hidden legacy bridge controls", () => {
    expect(productionSourceFilesFromRoots(["src"])).not.toContain(
      "src/ui/createWorkspaceView.ts",
    );
    expect(mainSource).not.toContain("./ui/createWorkspaceView");
    expect(mainSource).not.toContain("selectedCompressRows");
    expect(mainSource).not.toContain("focusedCompressRowPath");
    expect(mainSource).not.toContain("compressSelectionAnchorPath");
    expect(appRuntimeSource).not.toContain("createSelection:");
    expect(createWorkspaceStateSource).toContain(
      "export type CreateWorkspaceSelectionSnapshot",
    );
    expect(createWorkspaceStateSource).toContain(
      "selection: CreateWorkspaceSelectionSnapshot;",
    );
    expect(createWorkspaceSource).toContain(
      "snapshot.create.selection.selectedPaths",
    );
    expect(createWorkspaceSource).toContain(
      "snapshot.create.selection.focusedPath",
    );
  });

  it("forbids runtime and app innerHTML renderers", () => {
    expectScanMatchesOnlyAllowed("innerHtml");
  });

  it("keeps broad DOM event wiring limited to named runtime, interaction, and desktop seams", () => {
    expect(
      uniqueSorted(
        sourceLineMatchesForScan("broadDomWiring").map((match) => match.file),
      ),
    ).toEqual(
      ALLOWED_BROAD_DOM_ACCESS_FILES.map((exception) => exception.file).sort(),
    );
  });

  it("keeps runtime bridge free of DOM access and UI event wiring", () => {
    expect(
      sourceLineMatches(
        ["src/runtimeBridge.ts"],
        /document\.querySelector|getElementById|addEventListener/,
      )
        .map(sourceLineKey)
        .sort(),
    ).toEqual([]);
  });

  it("keeps React UI modules from importing api or desktop directly except named interaction adapters", () => {
    const allowedImports = new Set(
      ALLOWED_REACT_API_DESKTOP_IMPORT_EXCEPTIONS.map(importReferenceKey),
    );
    const violations = importReferencesForFiles(
      productionSourceFilesFromRoots(["src/ui/react"]),
    )
      .filter(
        (reference) =>
          importTargetsSrcDirectory(reference, "api") ||
          importTargetsSrcDirectory(reference, "desktop"),
      )
      .filter(
        (reference) => !allowedImports.has(importReferenceKey(reference)),
      );
    const invalidExceptions =
      ALLOWED_REACT_API_DESKTOP_IMPORT_EXCEPTIONS.filter(
        (exception) => !exception.file.startsWith("src/ui/react/interaction/"),
      );

    expect(
      violations.map(
        (reference) =>
          `${reference.file}:${reference.lineNumber}: ${reference.specifier}`,
      ),
    ).toEqual([]);
    expect(
      invalidExceptions.map(
        (exception) => `${exception.file}: ${exception.specifier}`,
      ),
    ).toEqual([]);
  });

  it("keeps app controllers free of React, DOM globals, desktop adapters, and Tauri imports", () => {
    const controllerFiles = productionSourceFilesFromRoots([
      "src/app/controllers",
    ]);
    const importViolations = importReferencesForFiles(controllerFiles)
      .filter(
        (reference) =>
          reference.specifier === "react" ||
          reference.specifier.startsWith("react/") ||
          reference.specifier === "react-dom" ||
          reference.specifier.startsWith("react-dom/") ||
          reference.specifier.startsWith("@tauri-apps/") ||
          importTargetsSrcDirectory(reference, "desktop") ||
          importTargetsSrcDirectory(reference, "ui/react"),
      )
      .map(
        (reference) =>
          `${reference.file}:${reference.lineNumber}: ${reference.specifier}`,
      );
    const domViolations = controllerDomGlobalMatches().map(
      (match) => `${match.file}:${match.lineNumber}: ${match.line}`,
    );

    expect(importViolations).toEqual([]);
    expect(domViolations).toEqual([]);
  });

  it("keeps status selection and focus text rendering in React shell chrome", () => {
    expect(statusBarSource).toContain("function statusBarModel");
    expect(statusBarSource).toContain("selection.visibleSelectedCount");
    expect(mainSource).not.toContain(
      "renderShellStatusBar(shellStatusBarElements",
    );
    expect(mainSource).not.toMatch(
      /status(?:SelectionCount|SelectionSize|FocusedSize|FocusedModified)Element\.textContent/,
    );
  });

  it("keeps Slice 9 UI adapters out of workflow and runtime seams", () => {
    const slice9Sources = [contextMenuHelpersSource, modalControllerSource];
    for (const source of slice9Sources) {
      expect(source).not.toMatch(/from "\.\.\/api/);
      expect(source).not.toMatch(
        /from "\.\.\/app\/(?:workspaces|controllers|shell)\//,
      );
      expect(source).not.toMatch(/from "\.\.\/desktop/);
      expect(source).not.toMatch(
        /archiveWorkspace\.|createWorkspace\.|shellWorkspace\.|commandRouter|runRoutedCommand|invoke|Tauri|openNativeDialog|localStorage|sessionStorage|passwordInput|passwordConfirm|\.value.*password|password.*\.value|fetch\(|listen\(/,
      );
    }
    expect(mainSource).not.toContain("renderJobsListHtml");
    expect(mainSource).not.toContain("jobsListElement");
  });

  it("does not duplicate command buttons in secondary panes", () => {
    expect(mainSource).not.toContain("flat-view-toggle");
    expect(mainSource).not.toContain("data-detail-action");
    expect(styles).not.toContain(".flat-toggle");
  });

  it("does not show unimplemented preferences", () => {
    expect(mainSource).not.toContain("<h3>System</h3>");
    expect(mainSource).not.toContain("<h3>Menu/Shell integration</h3>");
    expect(mainSource).not.toContain("Integrate to shell context menu");
    expect(mainSource).not.toContain("Cascaded context menu");
    expect(mainSource).not.toContain("Icons in context menu");
  });

  it("declares stable Compress source table columns", () => {
    expect(createWorkspaceSource).toContain('id="compress-include-all"');
    expect(createWorkspaceSource).toContain('type="checkbox"');
    expect(createWorkspaceSource).toContain("function includeAllState");
    expect(createWorkspaceSource).toContain(
      "node.indeterminate = includeAll.indeterminate",
    );
    expect(mainSource).not.toContain(
      '<th class="inclusion-column" data-i18n-text="table.include">Include</th>',
    );
    expect(createWorkspaceSource).toContain("visibleCols.map");
    expect(createWorkspaceSource).toContain("<CompressSourceHeader");
    expect(createWorkspaceSource).toContain(
      "data-compress-column-id={columnId}",
    );
    expect(createWorkspaceSource).toContain("data-column-resizer={columnId}");
    expect(createWorkspaceSource).toContain(
      "function finishCompressSourceColumnResize",
    );
    expect(createWorkspaceSource).toContain('type: "setCurrentFolderIncluded"');
    expect(createWorkspaceSource).toContain("<colgroup>");
    expect(createWorkspaceSource).toContain(
      "<col width={columnWidths[col.id] ?? col.width} key={col.id} />",
    );
  });

  it("shares drag-window selection behavior without merging table row ownership", () => {
    expect(tableMarqueeSelectionSource).toContain(
      "applyHierarchicalMarqueeSelection",
    );
    expect(archiveTableSource).toContain("armTableMarqueeSelectionGesture");
    expect(createWorkspaceSource).toContain("armTableMarqueeSelectionGesture");
    expect(archiveTableSource).toContain('rowSelector: "tr[data-entry-path]"');
    expect(createWorkspaceSource).toContain(
      'rowSelector: "tr[data-compress-path]"',
    );
    expect(archiveTableSource).toContain("export function ArchiveTable()");
    expect(createWorkspaceSource).toContain("function CreateTable()");
  });

  it("keeps application GUI styling fully Tailwind-owned", () => {
    expect(styles.trim()).toBe('@import "tailwindcss";');
    expect(appShellSource).toContain("[&_input:not([type=checkbox])");
    expect(appFrameSource).toContain("flex h-screen min-h-screen");
    expect(commandToolbarSource).toContain("h-12 min-h-12");
    expect(workspacePathBarSource).toContain("h-11 min-h-11");
    expect(workspaceBrowserShellSource).toContain("max-[760px]:flex-col");
    expect(paneResizerSource).toContain("useResizablePaneLayout");
    expect(paneResizerSource).not.toContain("document.");
    expect(archiveTableSource).toContain("table-fixed");
    expect(createWorkspaceSource).toContain("table-fixed");
    expect(desktopDialogSource).toContain("data-dialog-surface");
    expect(desktopDialogSource).toContain("data-dialog-content");
    expect(desktopDialogSource).toContain("max-h-[calc(100vh-48px)]");
    expect(contextMenuRootSource).toContain("<PopoverContent");
  });

  it("keeps table, dialog, search, drop, and detail interaction seams explicit", () => {
    expect(archiveTableSource).toContain("data-entry-path");
    expect(archiveTableSource).toContain("data-column-resizer");
    expect(createWorkspaceSource).toContain("data-compress-path");
    expect(createWorkspaceSource).toContain("data-compress-include");
    expect(workspacePathBarSource).toContain('role="search"');
    expect(desktopDialogSource).toContain('role="dialog"');
    expect(dialogRootSource).toContain('from "./DesktopDialog"');
    expect(preferencesDialogSource).toContain('from "../dialogs/DesktopDialog"');
    expect(accountWorkspaceSource).toContain('from "../dialogs/DesktopDialog"');
    expect(dialogRootSource).not.toMatch(/\sh-\[min\(/);
    expect(preferencesDialogSource).not.toMatch(/\sh-\[min\(780px/);
    expect(accountWorkspaceSource).not.toContain("h-[620px]");
    expect(desktopDialogSource).toContain("overflow-y-auto");
    expect(dropOverlaySource).toContain('id="drop-overlay"');
    expect(dropOverlaySource).toContain("data-drop-choice");
    expect(archiveDetailsPaneSource).toContain("data-details-action");
    expect(archiveDetailsPaneSource).toContain("data-copy-value");
    expect(contextMenuRootSource).not.toContain("addEventListener(");
  });
});
