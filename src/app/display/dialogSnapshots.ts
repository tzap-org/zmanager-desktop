import type {
  ArchiveEntryDto,
  HealthcheckResponse,
  ProjectContract,
} from "../../api/types";
import { isNativeCapabilityAvailable } from "../../api/generated/nativeCapabilities.generated";
import type { ShellIntegrationSetup, ShellIntegrationSetupStep } from "../../api/types";
import {
  APP_TITLE,
  APP_VERSION,
} from "../constants";
import {
  getKnownArchiveSuffix,
} from "../archiveFileTypes";
import type {
  ExtractMode,
  ExtractOverwritePolicy,
  TzapRestorePolicy,
} from "../extractFlow";
import {
  getPathBasename,
} from "../formatting";
import type {
  MessageKey,
  MessageParams,
} from "../i18n/translator";
import type {
  ArchiveWorkspaceSnapshot,
  SelectableArchiveWorkspaceRow,
} from "../workspaces/archiveWorkspace";
import type {
  DisplayContextSnapshot,
} from "./displayContext";

export type ZManagerDialogDetailRow = Readonly<{
  label: string;
  value: string;
  mode?: "wrap" | "middle";
}>;

export type ZManagerDialogAction = Readonly<{
  label: string;
  action?: string;
  copyValue?: string;
  primary?: boolean;
  title?: string;
}>;

export type ZManagerAboutDiagnosticsGroup = Readonly<{
  title: string;
  rows: readonly (readonly [string, string])[];
}>;

export type ZManagerDialogSnapshot =
  | Readonly<{ kind: "none" }>
  | Readonly<{
      kind: "extract";
      mode: ExtractMode;
      title: string;
      message: string;
      startLabel: string;
      destination: string;
      destinationHistory: readonly string[];
      useSubfolder: boolean;
      subfolder: string;
      pathMode: "full" | "current" | "none";
      overwrite: ExtractOverwritePolicy;
      stripComponents: string;
      deduplicateRoot: boolean;
      tzapRestorePolicy: TzapRestorePolicy;
      tzapAllowDegraded: boolean;
      tzapAllowAbsoluteSymlinks: boolean;
      ignoreSymlinks: boolean;
      passwordPromptOpen: boolean;
    }>
  | Readonly<{
      kind: "info";
      title: string;
      description: string;
      sectionTitle: string;
      rows: readonly ZManagerDialogDetailRow[];
      actions: readonly ZManagerDialogAction[];
      returnFocusPath: string;
    }>
  | Readonly<{
      kind: "about";
      title: string;
      groups: readonly ZManagerAboutDiagnosticsGroup[];
    }>
  | Readonly<{
      kind: "setup";
      title: string;
      description: string;
      steps: readonly ZManagerSetupStepRow[];
      /** True once nothing is left for the user to approve. */
      complete: boolean;
    }>;

/** One rendered row of the first-run shell-integration checklist. */
export type ZManagerSetupStepRow = Readonly<{
  id: string;
  title: string;
  detail: string;
  /** What to do about it. Empty once the step is satisfied. */
  instructions: string;
  stateLabel: string;
  state: ShellIntegrationSetupStep["state"];
  settingsUrl: string | null;
}>;

export type SetupDialogSnapshotInput = Readonly<{
  display: DisplayContextSnapshot;
  setup: ShellIntegrationSetup;
}>;

/**
 * Turn the platform's checklist into rows the dialog can render.
 *
 * Steps that still need the user are listed first: the whole point of this
 * dialog is that someone who does not know what macOS wants can see the
 * outstanding item without reading past the ones already done.
 */
/**
 * Steps this build knows how to describe.
 *
 * A step the catalogue has no copy for is dropped rather than rendered with a
 * raw key: a checklist whose whole purpose is to explain things cannot show
 * someone `setup.step.foo.title`.
 */
const SETUP_STEP_COPY = {
  finderContextMenu: {
    title: "setup.step.finderContextMenu.title",
    detail: "setup.step.finderContextMenu.detail",
    instructions: "setup.step.finderContextMenu.instructions",
  },
  quickLook: {
    title: "setup.step.quickLook.title",
    detail: "setup.step.quickLook.detail",
    instructions: "setup.step.quickLook.instructions",
  },
  spotlight: {
    title: "setup.step.spotlight.title",
    detail: "setup.step.spotlight.detail",
    instructions: "setup.step.spotlight.instructions",
  },
} as const;

const SETUP_STATE_LABELS = {
  satisfied: "setup.state.satisfied",
  needsApproval: "setup.state.needsApproval",
  notRegistered: "setup.state.notRegistered",
  unknown: "setup.state.unknown",
} as const;

export function buildSetupDialogSnapshot(
  input: SetupDialogSnapshotInput,
): Extract<ZManagerDialogSnapshot, { kind: "setup" }> {
  const display = input.display;
  const rows = input.setup.steps.flatMap((step): ZManagerSetupStepRow[] => {
    const copy = SETUP_STEP_COPY[step.id as keyof typeof SETUP_STEP_COPY];
    if (!copy) {
      return [];
    }
    return [{
      id: step.id,
      title: message(display, copy.title),
      detail: message(display, copy.detail),
      instructions: step.state === "satisfied"
        ? ""
        : step.state === "notRegistered"
          ? message(display, "setup.notRegisteredHint")
          : message(display, copy.instructions),
      stateLabel: message(display, SETUP_STATE_LABELS[step.state]),
      state: step.state,
      settingsUrl: step.settingsUrl,
    }];
  });

  const outstanding = rows.filter((row) => row.state !== "satisfied");
  const satisfied = rows.filter((row) => row.state === "satisfied");

  return {
    kind: "setup",
    title: message(display, "setup.title"),
    description: message(display, "setup.description"),
    steps: [...outstanding, ...satisfied],
    complete: input.setup.complete,
  };
}

export type DialogInfoDetailRow = Readonly<{
  label: string;
  value?: string | null;
  mode?: "wrap" | "middle";
}>;

export type ArchiveInfoDialogSnapshotInput = Readonly<{
  archive: ArchiveWorkspaceSnapshot;
  display: DisplayContextSnapshot;
  lastTestStatus?: string | null;
  returnFocusPath?: string;
  appTitle?: string;
}>;

export type EntryInfoDialogSnapshotInput = Readonly<{
  entry: ArchiveEntryDto;
  display: DisplayContextSnapshot;
  previewActionTitle?: string;
  returnFocusPath?: string;
}>;

export type SelectionInfoDialogSnapshotInput = Readonly<{
  archive: ArchiveWorkspaceSnapshot;
  display: DisplayContextSnapshot;
  selectedRows?: readonly SelectableArchiveWorkspaceRow[];
  returnFocusPath?: string;
}>;

export type AboutDialogSnapshotInput = Readonly<{
  display: DisplayContextSnapshot;
  healthcheck?: HealthcheckResponse | null;
  contract?: ProjectContract | null;
  appTitle?: string;
  appVersion?: string;
  diagnosticLogPath?: string | null;
  diagnosticLogLocation?: string | null;
}>;

export function buildArchiveInfoDialogSnapshot(
  input: ArchiveInfoDialogSnapshotInput,
): Extract<ZManagerDialogSnapshot, { kind: "info" }> {
  const display = input.display;
  const archive = input.archive;
  const totalSize = archive.totalSize ?? sumKnownEntryBytes(archive.entries, (entry) => entry.size);
  const packedSize = sumKnownEntryBytes(archive.entries, (entry) => entry.compressedSize);
  const rows = infoDetailRowsToSnapshotRows([
    { label: message(display, "detail.archiveName"), value: archiveName(archive.currentArchivePath, input.appTitle ?? APP_TITLE) },
    { label: message(display, "detail.path"), value: archive.currentArchivePath, mode: "middle" },
    { label: message(display, "detail.format"), value: formatArchiveTypeFromPath(archive.currentArchivePath) },
    { label: message(display, "detail.entries"), value: String(archive.entryCount) },
    { label: message(display, "detail.totalUnpackedSize"), value: totalSize === null ? null : display.format.bytes(totalSize) },
    { label: message(display, "detail.packedSize"), value: packedSize === null ? null : display.format.bytes(packedSize) },
    { label: message(display, "detail.lastTestStatus"), value: input.lastTestStatus ?? null },
  ]);

  return {
    kind: "info",
    title: message(display, "info.archiveTitle"),
    description: message(display, "info.archiveDescription"),
    sectionTitle: message(display, "info.archiveTitle"),
    rows,
    actions: [
      { label: message(display, "info.copyPath"), copyValue: archive.currentArchivePath },
      { label: message(display, "info.copyDetails"), copyValue: serializeInfoDetailRows(rows) },
    ],
    returnFocusPath: input.returnFocusPath ?? "",
  };
}

export function buildEntryInfoDialogSnapshot(
  input: EntryInfoDialogSnapshotInput,
): Extract<ZManagerDialogSnapshot, { kind: "info" }> {
  const display = input.display;
  const rows = infoDetailRowsToSnapshotRows(entryInfoDetailRows(input.entry, display));
  const canPreview = input.entry.kind !== "directory";
  const previewLabel = message(display, "command.view");

  return {
    kind: "info",
    title: message(display, "info.entryTitle"),
    description: message(display, "info.entryDescription"),
    sectionTitle: message(display, "info.entryTitle"),
    rows,
    actions: [
      ...(canPreview
        ? [{
            label: previewLabel,
            action: "preview",
            primary: true,
            title: input.previewActionTitle,
          }]
        : []),
      { label: message(display, "info.copyPath"), copyValue: input.entry.path },
      { label: message(display, "info.copyDetails"), copyValue: serializeInfoDetailRows(rows) },
      { label: message(display, "info.archiveTitle"), action: "archive-info" },
    ],
    returnFocusPath: input.returnFocusPath ?? "",
  };
}

export function buildSelectionInfoDialogSnapshot(
  input: SelectionInfoDialogSnapshotInput,
): Extract<ZManagerDialogSnapshot, { kind: "info" }> {
  const display = input.display;
  const selectedRows = input.selectedRows ?? input.archive.view.selection.visibleSelectedRows;
  const rows = infoDetailRowsToSnapshotRows(selectionInfoDetailRows(
    selectedRows,
    input.archive.entries,
    display,
  ));

  return {
    kind: "info",
    title: message(display, "info.selectionTitle"),
    description: message(display, "info.selectionDescription"),
    sectionTitle: message(display, "info.selectionTitle"),
    rows,
    actions: [
      { label: message(display, "info.copyDetails"), copyValue: serializeInfoDetailRows(rows) },
      { label: message(display, "info.archiveTitle"), action: "archive-info" },
    ],
    returnFocusPath: input.returnFocusPath ?? "",
  };
}

export function buildAboutDialogSnapshot(
  input: AboutDialogSnapshotInput,
): Extract<ZManagerDialogSnapshot, { kind: "about" }> {
  const display = input.display;
  const healthcheck = input.healthcheck ?? null;
  const contract = input.contract ?? null;
  const capabilityAvailable = (
    id: Parameters<typeof isNativeCapabilityAvailable>[1],
  ): boolean => contract
    ? isNativeCapabilityAvailable(contract.platformIntegration.capabilities, id)
    : false;
  const capabilityApplies = (
    id: Parameters<typeof isNativeCapabilityAvailable>[1],
  ): boolean => contract
    ? contract.platformIntegration.capabilities.find(
      (capability) => capability.id === id,
    )?.applicability !== "notApplicable"
    : false;
  const diagnosticLogLocation = input.diagnosticLogLocation === "installation"
    ? message(display, "about.diagnostics.logLocationInstallation")
    : input.diagnosticLogLocation === "user"
      ? message(display, "about.diagnostics.logLocationUser")
      : input.diagnosticLogLocation === "userFallback"
        ? message(display, "about.diagnostics.logLocationFallback")
        : message(display, "about.diagnostics.unavailable");

  return {
    kind: "about",
    title: message(display, "about.title"),
    groups: [
      {
        title: message(display, "about.group.product"),
        rows: [
          [message(display, "about.diagnostics.appName"), input.appTitle ?? APP_TITLE],
          [
            message(display, "about.diagnostics.appVersion"),
            healthcheck?.appVersion ?? input.appVersion ?? APP_VERSION,
          ],
          [
            message(display, "about.diagnostics.buildId"),
            healthcheck?.buildId ?? message(display, "about.diagnostics.unavailable"),
          ],
        ],
      },
      {
        title: message(display, "about.group.runtime"),
        rows: [
          [message(display, "about.diagnostics.shell"), healthcheck?.shell ?? message(display, "about.shell.browserPreview")],
          [
            message(display, "about.diagnostics.engine"),
            healthcheck ? `${healthcheck.engine} ${healthcheck.version}` : message(display, "about.diagnostics.unavailable"),
          ],
          [
            message(display, "about.diagnostics.coreDependency"),
            contract?.coreDependency ?? message(display, "about.diagnostics.unavailable"),
          ],
        ],
      },
      {
        title: message(display, "about.group.integration"),
        rows: [
          [
            message(display, "about.diagnostics.platform"),
            contract?.platformIntegration.platform ?? message(display, "about.diagnostics.unknown"),
          ],
          [
            message(display, "about.diagnostics.selectedItemActions"),
            capabilityAvailable("shellSelectedItemActions")
              ? message(display, "about.diagnostics.enabled")
              : message(display, "about.diagnostics.disabled"),
          ],
          [
            message(display, "about.diagnostics.backgroundActions"),
            capabilityAvailable("shellBackgroundActions")
              ? message(display, "about.diagnostics.enabled")
              : message(display, "about.diagnostics.disabled"),
          ],
          [
            message(display, "about.diagnostics.fileAssociations"),
            capabilityAvailable("fileAssociations")
              ? message(display, "about.diagnostics.enabled")
              : message(display, "about.diagnostics.disabled"),
          ],
          ...(capabilityApplies("quickLook") || capabilityApplies("spotlight")
            ? [
                [
                  message(display, "about.diagnostics.quickLook"),
                  capabilityAvailable("quickLook")
                    ? message(display, "about.diagnostics.enabled")
                    : message(display, "about.diagnostics.disabled"),
                ] as const,
                [
                  message(display, "about.diagnostics.spotlight"),
                  capabilityAvailable("spotlight")
                    ? message(display, "about.diagnostics.enabled")
                    : message(display, "about.diagnostics.disabled"),
                ] as const,
              ]
            : []),
        ],
      },
      {
        title: message(display, "about.group.support"),
        rows: [
          [message(display, "about.diagnostics.status"), healthcheck?.status ?? message(display, "about.diagnostics.frontendOnly")],

          [
            message(display, "about.diagnostics.shellActions"),
            capabilityAvailable("shellSelectedItemActions")
              ? message(display, "about.diagnostics.enabled")
              : message(display, "about.diagnostics.unavailable"),
          ],
          [
            message(display, "about.diagnostics.logPath"),
            input.diagnosticLogPath ?? message(display, "about.diagnostics.unavailable"),
          ],
          [message(display, "about.diagnostics.logLocation"), diagnosticLogLocation],
        ],
      },
    ],
  };
}

export function entryInfoDetailRows(
  entry: ArchiveEntryDto,
  display: DisplayContextSnapshot,
): readonly DialogInfoDetailRow[] {
  return [
    { label: message(display, "detail.name"), value: getPathBasename(entry.path, entry.path) },
    { label: message(display, "detail.type"), value: archiveKindLabel(entry.kind, display) },
    { label: message(display, "detail.path"), value: entry.path },
    { label: message(display, "detail.size"), value: formatOptionalBytes(entry.size, display) },
    { label: message(display, "detail.packed"), value: formatOptionalBytes(entry.compressedSize, display) },
    { label: message(display, "detail.modified"), value: display.format.date(entry.modified, { emptyValue: "" }) },
    { label: message(display, "detail.mode"), value: typeof entry.mode === "number" ? entry.mode.toString(8).padStart(4, "0") : null },
    { label: message(display, "detail.metadataDiagnostics"), value: entry.metadataDiagnostics?.join("\n") },
    {
      label: message(display, "detail.ratio"),
      value: display.format.ratio(entry.size, entry.compressedSize, { fractionDigits: 0 }),
    },
    { label: message(display, "detail.created"), value: display.format.date(entry.created, { emptyValue: "" }) },
    { label: message(display, "detail.attributes"), value: entry.attributes },
    { label: message(display, "detail.method"), value: entry.method },
    { label: "CRC", value: entry.crc },
    { label: message(display, "detail.encrypted"), value: formatOptionalBoolean(entry.encrypted, display) },
    { label: message(display, "detail.solid"), value: formatOptionalBoolean(entry.solid, display) },
    { label: message(display, "detail.linkTarget"), value: entry.linkTarget },
  ];
}

export function selectionInfoDetailRows(
  selectedRows: readonly SelectableArchiveWorkspaceRow[],
  entries: readonly ArchiveEntryDto[],
  display: DisplayContextSnapshot,
): readonly DialogInfoDetailRow[] {
  const selected = selectedRows
    .map((row) => row.entry ?? entryByPath(entries, row.path))
    .filter((entry): entry is ArchiveEntryDto => entry !== null);
  const selectedTotal = sumKnownEntryBytes(selected, (entry) => entry.size);
  const selectedPacked = sumKnownEntryBytes(selected, (entry) => entry.compressedSize);
  const selectedFiles = selectedRows.filter((row) => row.rowType === "entry" && row.entry?.kind !== "directory").length;
  const selectedFolders = selectedRows.filter((row) => row.rowType === "folder" || row.entry?.kind === "directory").length;

  return [
    { label: message(display, "detail.entries"), value: String(selectedRows.length) },
    { label: message(display, "detail.selectedFiles"), value: String(selectedFiles) },
    { label: message(display, "detail.selectedFolders"), value: String(selectedFolders) },
    { label: message(display, "detail.totalSize"), value: selectedTotal === null ? null : display.format.bytes(selectedTotal) },
    { label: message(display, "detail.packedSize"), value: selectedPacked === null ? null : display.format.bytes(selectedPacked) },
    { label: message(display, "detail.pathPreview"), value: truncatedPathPreview(selectedRows.map((row) => row.path)) },
  ];
}

export function infoDetailRowsToSnapshotRows(
  rows: readonly DialogInfoDetailRow[],
): ZManagerDialogDetailRow[] {
  return rows
    .filter((row): row is DialogInfoDetailRow & { value: string } => row.value !== undefined && row.value !== null && row.value !== "")
    .map((row) => ({
      label: row.label,
      value: row.value,
      mode: row.mode,
    }));
}

export function serializeInfoDetailRows(
  rows: readonly DialogInfoDetailRow[] | readonly ZManagerDialogDetailRow[],
): string {
  return rows
    .filter((row): row is (DialogInfoDetailRow | ZManagerDialogDetailRow) & { value: string } =>
      row.value !== undefined && row.value !== null && row.value !== ""
    )
    .map((row) => `${row.label}: ${row.value}`)
    .join("\n");
}

export function serializeAboutDiagnostics(
  input: Extract<ZManagerDialogSnapshot, { kind: "about" }> | readonly ZManagerAboutDiagnosticsGroup[],
): string {
  const groups = isAboutDialogSnapshot(input) ? input.groups : input;
  const lines: string[] = [];

  for (const group of groups) {
    if (group.title.trim()) {
      lines.push(group.title.trim());
    }

    for (const [label, value] of group.rows) {
      if (label.trim() && value.trim()) {
        lines.push(`${label.trim()}: ${value.trim()}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n").trim();
}

function isAboutDialogSnapshot(
  input: Extract<ZManagerDialogSnapshot, { kind: "about" }> | readonly ZManagerAboutDiagnosticsGroup[],
): input is Extract<ZManagerDialogSnapshot, { kind: "about" }> {
  return typeof input === "object" && input !== null && "kind" in input && input.kind === "about";
}

export function truncatedPathPreview(
  paths: readonly string[],
  maxItems = 3,
  maxLength = 140,
): string | null {
  if (!paths.length) {
    return null;
  }

  const sortedUniquePaths = Array.from(new Set(paths)).sort();
  const shownPaths = sortedUniquePaths.slice(0, maxItems);
  const remaining = sortedUniquePaths.length - maxItems;

  let preview = shownPaths.join(", ");
  if (remaining > 0) {
    preview = `${preview} (+${remaining} more)`;
  }

  if (preview.length <= maxLength) {
    return preview;
  }

  const headLength = Math.max(8, Math.ceil((maxLength - 3) * 0.58));
  const tailLength = Math.max(8, maxLength - headLength - 3);
  return `${preview.slice(0, headLength)}...${preview.slice(-tailLength)}`;
}

export function formatArchiveTypeFromPath(path: string): string | null {
  const suffix = getKnownArchiveSuffix(path);
  if (!suffix) {
    return null;
  }
  return suffix.startsWith(".") ? suffix.slice(1).toUpperCase() : suffix.toUpperCase();
}

function archiveName(path: string, fallback: string): string {
  return getPathBasename(path, fallback);
}

function archiveKindLabel(kind: ArchiveEntryDto["kind"], display: DisplayContextSnapshot): string {
  return kind === "directory" ? message(display, "detail.directory") : kind;
}

function formatOptionalBytes(value: number | undefined, display: DisplayContextSnapshot): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return display.format.bytes(value);
}

function formatOptionalBoolean(value: boolean | undefined, display: DisplayContextSnapshot): string | null {
  if (typeof value !== "boolean") {
    return null;
  }
  return value ? message(display, "detail.booleanYes") : message(display, "detail.booleanNo");
}

function entryByPath(
  entries: readonly ArchiveEntryDto[],
  path: string | null | undefined,
): ArchiveEntryDto | null {
  const normalizedPath = path ?? "";
  return entries.find((entry) => entry.path === normalizedPath) ?? null;
}

function sumKnownEntryBytes(
  entries: readonly ArchiveEntryDto[],
  selector: (entry: ArchiveEntryDto) => number | undefined,
): number | null {
  let hasKnownValue = false;
  let total = 0;
  for (const entry of entries) {
    const value = selector(entry);
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      hasKnownValue = true;
      total += value;
    }
  }
  return hasKnownValue ? total : null;
}

function message(
  display: DisplayContextSnapshot,
  key: MessageKey,
  params?: MessageParams,
): string {
  return display.translator.t(key, params);
}
