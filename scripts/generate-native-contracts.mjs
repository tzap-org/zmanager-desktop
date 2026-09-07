import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildBaselineCapabilitySnapshots,
  validateNativeCapabilityManifest,
} from "./lib/native-capability-contract.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const archive = readJson("manifests/archive-file-types.json");

// ---- Archive extension data comes from the zmanager format contract ----
//
// The extension lists in manifests/archive-file-types.json are regenerated
// from zmanager's committed capability contract (crates/zmanager-cli/
// contracts/archive-formats.json, the output of `zm formats --contract`), so
// recognition cannot drift from zmanager-core's FORMAT_CAPABILITIES registry.
// The mapping tables below are local *policy*: which association type owns a
// kind's suffixes, and which raw-codec suffixes belong to which type. New
// contract kinds fail the coverage validation until assigned here.
const contractPath = resolve(root, "../zmanager/crates/zmanager-cli/contracts/archive-formats.json");
let contract;
try {
  contract = JSON.parse(readFileSync(contractPath, "utf8"));
} catch (error) {
  throw new Error(
    `cannot read the zmanager format contract at ${contractPath}: ${error.message}\n`
    + `Generate it with zmanager's scripts/refresh-format-contract.sh and commit it.`,
  );
}
const contractKinds = new Set(contract.formats.map(({ kind }) => kind));

// Contract kind -> association type. `null` kinds are predicate-detected in
// core (no extension row) or not association targets.
const KIND_OWNERS = {
  Zip: "zip",
  SevenZ: "sevenZip",
  Rar: "rar",
  Tar: "tar",
  TarGz: "gzip",
  TarBz2: "bzip2",
  TarXz: "xz",
  TarZst: "tzst",
  TarLzma: "lzma",
  TarLz: "lzip",
  TarLzo: "lzo",
  TarCompress: "compressZ",
  TarLz4: "lz4",
  TarUu: "genericPackages",
  AppleArchive: "appleArchive",
  Cab: "genericPackages",
  Cpio: "genericPackages",
  Deb: "genericPackages",
  Iso: "genericPackages",
  Rpm: "genericPackages",
  Xar: "genericPackages",
  Lha: "genericPackages",
  Ar: "genericPackages",
  Warc: "genericPackages",
  Mtree: "genericPackages",
  Msi: "genericPackages",
  Vhd: "genericPackages",
  Vmdk: "genericPackages",
  Udf: "genericPackages",
  Squashfs: "genericPackages",
  AppImage: "genericPackages",
  Wim: "genericPackages",
  Vdi: "genericPackages",
  Nrg: "genericPackages",
  Mdf: "genericPackages",
  Cdi: "genericPackages",
  Isz: "genericPackages",
  Ccd: "genericPackages",
  Cue: "genericPackages",
  Vhdx: "genericPackages",
  Qcow2: "genericPackages",
  Ewf: "genericPackages",
  Ad1: "genericPackages",
  Dar: "genericPackages",
  Aff4: "genericPackages",
  RawDisk: "genericPackages",
  Dmg: "genericPackages",
  Pkg: "genericPackages",
  Tzap: null,
  SplitZip: null,
};
// RawStream carries every raw codec suffix in one row; this assigns each
// suffix to its codec association type. A new codec suffix fails the build
// until it gets an explicit owner.
const RAW_SUFFIX_OWNERS = {
  zst: "zstd",
  gz: "gzip",
  bz2: "bzip2",
  xz: "xz",
  lzma: "lzma",
  lz: "lzip",
  br: "brotli",
  lz4: "lz4",
  lzo: "lzo",
  z: "compressZ",
  lrz: "lrz",
  uu: "genericPackages",
  b64: "genericPackages",
};
// TAR-wrapped compounds for raw codecs without a dedicated tar-* kind in core.
const SYNTHETIC_COMPOUNDS = {
  br: "tar.br",
  lz: "tar.lz",
  lz4: "tar.lz4",
  lzo: "tar.lzo",
  lrz: "tar.lrz",
  z: "tar.z",
};
// Tzap is predicate-detected in core and carries no extension row.
const LOCAL_PRIMARY_EXTENSIONS = { tzap: ["tzap"] };

for (const kind of Object.keys(KIND_OWNERS)) {
  if (!contractKinds.has(kind)) {
    throw new Error(`format contract is missing kind ${kind} (referenced by generator policy)`);
  }
}
for (const owner of [...Object.values(RAW_SUFFIX_OWNERS), ...Object.keys(LOCAL_PRIMARY_EXTENSIONS)]) {
  if (!archive.associationTypes.some((type) => type.id === owner)) {
    throw new Error(`generator policy references unknown association type ${owner}`);
  }
}

const stripDot = (suffix) => suffix.slice(1).toLowerCase();
const computedExtensions = new Map();
const extensionsFor = (id) => {
  if (!computedExtensions.has(id)) computedExtensions.set(id, { primary: new Set(), compound: new Set() });
  return computedExtensions.get(id);
};
for (const row of contract.formats) {
  if (row.kind === "RawStream") {
    for (const suffix of row.extensions) {
      const name = stripDot(suffix);
      const owner = RAW_SUFFIX_OWNERS[name];
      if (!owner) throw new Error(`raw stream suffix ${suffix} has no association owner; extend RAW_SUFFIX_OWNERS`);
      extensionsFor(owner).primary.add(name);
    }
    continue;
  }
  const owner = KIND_OWNERS[row.kind];
  if (owner === undefined) {
    throw new Error(`contract kind ${row.kind} has no association owner; update KIND_OWNERS`);
  }
  if (owner === null) continue;
  for (const suffix of row.extensions) {
    const name = stripDot(suffix);
    if (name.includes(".")) extensionsFor(owner).compound.add(name);
    else extensionsFor(owner).primary.add(name);
  }
}
for (const [codec, compound] of Object.entries(SYNTHETIC_COMPOUNDS)) {
  extensionsFor(RAW_SUFFIX_OWNERS[codec]).compound.add(compound);
}
for (const [id, extensions] of Object.entries(LOCAL_PRIMARY_EXTENSIONS)) {
  for (const extension of extensions) extensionsFor(id).primary.add(extension);
}
for (const [id, { primary, compound }] of computedExtensions) {
  const type = archive.associationTypes.find((candidate) => candidate.id === id);
  if (!type) throw new Error(`computed extensions reference unknown association type ${id}`);
  type.primaryExtensions = [...primary].sort();
  type.compoundExtensions = [...compound].sort();
}
archive.singleExtensions = [...new Set(archive.associationTypes.flatMap(({ primaryExtensions }) => primaryExtensions))].sort();
archive.compoundExtensions = [...new Set(archive.associationTypes.flatMap(({ compoundExtensions }) => compoundExtensions))].sort();
for (const group of archive.documentGroups) {
  if (group.id === "archives") {
    // The archives group claims every supported association except those
    // owned by dedicated groups (tzap), which appear there only.
    const otherExtensions = new Set(
      archive.documentGroups.filter(({ id }) => id !== "archives").flatMap(({ extensions }) => extensions),
    );
    group.extensions = [
      ...archive.singleExtensions,
      ...archive.compoundExtensions,
      ...archive.splitArchiveSuffixes.map((suffix) => suffix.slice(1)),
    ].filter((extension) => !otherExtensions.has(extension));
  }
}

const shell = readJson("manifests/shell-actions.json");
const inbound = readJson("manifests/native-inbound-events.schema.json");
const appCommands = readJson("manifests/application-commands.json");
const macosFfi = readJson("manifests/macos-ffi-operations.json");
const productPackage = readJson("package.json");
const nativeCapabilities = validateNativeCapabilityManifest(
  readJson("manifests/native-capabilities.json"),
);
const outputs = new Map();
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const put = (path, content) => outputs.set(path, content.endsWith("\n") ? content : `${content}\n`);
const swiftString = (value) => JSON.stringify(value);
const pascalCase = (value) => `${value[0].toUpperCase()}${value.slice(1)}`;
const screamingSnakeCase = (value) => value
  .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
  .replace(/[^A-Za-z0-9]+/g, "_")
  .toUpperCase();
const strings = (pairs) => [...new Map(pairs)].map(
  ([key, value]) => `${JSON.stringify(key)} = ${JSON.stringify(value)};`,
).join("\n");

const requireUnique = (values, label) => {
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
  if (duplicates.length) throw new Error(`${label} contains duplicates: ${[...new Set(duplicates)].join(", ")}`);
};
requireUnique(archive.singleExtensions, "singleExtensions");
requireUnique(archive.compoundExtensions, "compoundExtensions");
requireUnique(archive.splitArchiveSuffixes, "splitArchiveSuffixes");
requireUnique(archive.associationTypes.map(({ id }) => id), "archive association type ids");
const typedSingleExtensions = archive.associationTypes.flatMap(({ primaryExtensions }) =>
  primaryExtensions);
const typedCompoundExtensions = archive.associationTypes.flatMap(({ compoundExtensions }) =>
  compoundExtensions);
const typedSplitSuffixes = archive.associationTypes.flatMap(({ splitSuffixes }) => splitSuffixes);
requireUnique(typedSingleExtensions, "association type primary extensions");
requireUnique(typedCompoundExtensions, "association type compound extensions");
requireUnique(typedSplitSuffixes, "association type split suffixes");
if (JSON.stringify([...typedSingleExtensions].sort()) !== JSON.stringify([...archive.singleExtensions].sort())
    || JSON.stringify([...typedCompoundExtensions].sort()) !== JSON.stringify([...archive.compoundExtensions].sort())
    || JSON.stringify([...typedSplitSuffixes].sort()) !== JSON.stringify([...archive.splitArchiveSuffixes].sort())) {
  throw new Error("associationTypes must exactly partition all primary, compound, and split archive extensions");
}
const canonicalMimeTypes = archive.associationTypes
  .map(({ mimeType }) => mimeType)
  .filter((mimeType) => mimeType !== null);
requireUnique(canonicalMimeTypes, "canonical archive MIME types");
const mimeOwners = archive.associationTypes.flatMap(({ id, mimeType, mimeAliases }) =>
  [mimeType, ...mimeAliases].filter((value) => value !== null).map((value) => [value, id]));
requireUnique(mimeOwners.map(([mimeType]) => mimeType), "archive MIME types and aliases");
for (const [platform, profile] of Object.entries(archive.packageAssociationProfiles)) {
  if (!["windows", "linux", "macos"].includes(platform)) {
    throw new Error(`unknown archive package association platform ${platform}`);
  }
  if (profile.extensions !== "all" && !Array.isArray(profile.extensions)) {
    throw new Error(`${platform} association extensions must be "all" or an array`);
  }
  requireUnique(profile.mimeTypes, `${platform} package MIME types`);
  const knownMimeTypes = new Set(mimeOwners.map(([mimeType]) => mimeType));
  if (profile.mimeTypes.some((mimeType) => !knownMimeTypes.has(mimeType))) {
    throw new Error(`${platform} package association profile contains an unknown MIME type`);
  }
}
const supportedAssociations = [...archive.singleExtensions, ...archive.compoundExtensions, ...archive.splitArchiveSuffixes.map((suffix) => suffix.slice(1))].sort();
const declaredAssociations = archive.documentGroups.flatMap(({ extensions }) => extensions);
requireUnique(declaredAssociations, "documentGroups extensions");
if (JSON.stringify([...declaredAssociations].sort()) !== JSON.stringify(supportedAssociations)) {
  throw new Error("documentGroups extensions must exactly cover every supported archive association");
}
for (const type of archive.exportedTypes) {
  if (!type.extensions.every((extension) => declaredAssociations.includes(extension))) {
    throw new Error(`exported type ${type.identifier} is not present in documentGroups`);
  }
}
const serviceActionIds = shell.actions
  .filter(({ macOSServiceTitle }) => typeof macOSServiceTitle === "string" && macOSServiceTitle.trim() !== "")
  .map(({ id }) => id);
if (JSON.stringify(serviceActionIds) !== JSON.stringify(["open", "compress", "extract"])) {
  throw new Error("macOS Services must declare exactly open, compress, and extract in canonical order");
}
requireUnique(shell.actions.map(({ id }) => id), "shell action ids");
requireUnique(shell.actions.map(({ rustCase }) => rustCase), "shell action Rust cases");
requireUnique(shell.actions.map(({ nativeVerb }) => nativeVerb), "shell action native verbs");
requireUnique(shell.actions.map(({ order }) => order), "shell action contract order");
const normalizedAliases = shell.actions.flatMap(({ id, compatibilityAliases }) =>
  compatibilityAliases.map((alias) => ({
    id,
    alias,
    normalized: alias.toLowerCase().replace(/[-_ ]/g, ""),
  }))
);
requireUnique(normalizedAliases.map(({ normalized }) => normalized), "normalized shell action aliases");
const allowedSurfaces = new Set(shell.nativeSurfaces);
const allowedContexts = new Set(shell.contextMenuContexts);
const windowsClsids = [];
for (const action of shell.actions) {
  if (![action.canonicalLabel, action.canonicalLabelZhHans, action.displayKey, action.nativeVerb].every(
    (value) => typeof value === "string" && value.trim() !== "",
  )) {
    throw new Error(`shell action ${action.id} requires canonical labels, a display key, and a native verb`);
  }
  if (!Array.isArray(action.compatibilityAliases) || !action.compatibilityAliases.length) {
    throw new Error(`shell action ${action.id} requires compatibility aliases`);
  }
  const hasFinderNamedLabel = typeof action.macOSFinderNamedLabel === "string";
  const hasFinderNamedLabelZhHans = typeof action.macOSFinderNamedLabelZhHans === "string";
  if (hasFinderNamedLabel !== hasFinderNamedLabelZhHans) {
    throw new Error(`shell action ${action.id} must define both macOS Finder named labels`);
  }
  if (hasFinderNamedLabel
      && (![action.macOSFinderNamedLabel, action.macOSFinderNamedLabelZhHans].every(
        (value) => value.trim() !== "" && value.includes("%@"),
      ) || !action.nativeSurfaces.includes("macosFinder"))) {
    throw new Error(`shell action ${action.id} has invalid macOS Finder named labels`);
  }
  if (!action.nativeSurfaces.every((surface) => allowedSurfaces.has(surface))) {
    throw new Error(`shell action ${action.id} uses an unknown native surface`);
  }
  if (!action.contextMenuContexts.every((context) => allowedContexts.has(context))) {
    throw new Error(`shell action ${action.id} uses an unknown context-menu context`);
  }
  if ((action.contextMenuOrder === null) !== (action.contextMenuContexts.length === 0)) {
    throw new Error(`shell action ${action.id} context-menu order and contexts disagree`);
  }
  if (action.nativeSurfaces.includes("windowsExplorer")) {
    if (typeof action.windowsClsid !== "string"
        || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(action.windowsClsid)) {
      throw new Error(`shell action ${action.id} requires a lowercase Windows CLSID`);
    }
    windowsClsids.push(action.windowsClsid);
  } else if (action.windowsClsid !== null) {
    throw new Error(`non-Windows shell action ${action.id} must not declare a Windows CLSID`);
  }
}
requireUnique(windowsClsids, "Windows shell action CLSIDs");
for (const context of shell.contextMenuContexts) {
  const actions = shell.actions
    .filter((action) => action.contextMenuContexts.includes(context))
    .sort((left, right) => left.contextMenuOrder - right.contextMenuOrder);
  requireUnique(actions.map(({ contextMenuOrder }) => contextMenuOrder), `${context} context-menu order`);
}
for (const group of archive.documentGroups) {
  if (![group.macOSDisplayName, group.macOSDisplayNameZhHans].every((value) => typeof value === "string" && value.trim() !== "")) {
    throw new Error(`document group ${group.id} requires English and Simplified Chinese macOS display names`);
  }
}
for (const type of archive.exportedTypes) {
  if (![type.macOSDescription, type.macOSDescriptionZhHans].every((value) => typeof value === "string" && value.trim() !== "")) {
    throw new Error(`exported type ${type.identifier} requires English and Simplified Chinese macOS descriptions`);
  }
}
for (const action of shell.actions.filter(({ macOSServiceTitle }) => typeof macOSServiceTitle === "string")) {
  if (typeof action.macOSServiceTitleZhHans !== "string" || action.macOSServiceTitleZhHans.trim() === "") {
    throw new Error(`service action ${action.id} requires a Simplified Chinese title`);
  }
}
for (const action of shell.actions) {
  if (!["mainWindow", "disposableTask"].includes(action.windowDisposition)) {
    throw new Error(`shell action ${action.id} has an invalid windowDisposition`);
  }
}


put("src/api/generated/applicationCommands.generated.ts", `// Generated by scripts/generate-native-contracts.mjs. Do not edit.
export const COMMAND_IDS = ${JSON.stringify(appCommands.commands.map(c => c.id), null, 2)} as const;
export type GeneratedCommandId = (typeof COMMAND_IDS)[number];

export const COMMAND_DEFINITIONS: Record<string, any> = ${JSON.stringify(
  Object.fromEntries(appCommands.commands.map(c => [c.id, c])), null, 2
)};

export const CLASSIC_MENU_GROUPS: any[] = ${JSON.stringify(
  appCommands.menus.filter(m => !m.platforms || m.platforms.includes("windows") || m.platforms.includes("linux")).map(m => {
    // clean platforms
    const { platforms, ...rest } = m;
    if (rest.items) {
      rest.items = rest.items
        .filter(item => !item.platforms || item.platforms.includes("windows") || item.platforms.includes("linux"))
        .map(item => {
          const { platforms, ...itemRest } = item;
          return itemRest;
        });
    }
    return rest;
  }), null, 2
)};

export const CLASSIC_TOOLBAR_GROUPS: any[] = ${JSON.stringify(appCommands.toolbarGroups, null, 2)};
export const CLASSIC_TOOLBAR_ORDER: string[] = ${JSON.stringify(appCommands.toolbarGroups.flatMap(g => g.items), null, 2)};
`);

// Rust macOS Menu
const macosMenus = appCommands.menus.filter(m => !m.platforms || m.platforms.includes("macos"));

const buildMenuBlock = (menu, varName) => {
  let rust = `    let ${varName} = SubmenuBuilder::new(app, "${menu.label}")\n`;
  for (const item of menu.items) {
    if (item.platforms && !item.platforms.includes("macos")) continue;
    if (item.kind === "command") {
      const command = appCommands.commands.find(c => c.id === item.id);
      const acc = command.macOSAccelerator ? `Some("${command.macOSAccelerator}")` : "None";
      rust += `        .item(&menu_command(app, "${command.id}", "${command.label}", ${acc})?)\n`;
    } else if (item.kind === "separator") {
      rust += `        .separator()\n`;
    } else if (item.kind === "submenu") {
      // not handling deep submenus for now as there are none in macos menu
    } else if (item.kind.startsWith("macos-")) {
      const predefined = item.kind.replace("macos-", "").replace(/-/g, "_");
      rust += `        .${predefined}()\n`;
    }
  }
  rust += `        .build()?;\n`;
  return rust;
};

let macosRust = `// Generated by scripts/generate-native-contracts.mjs. Do not edit.
pub fn build_macos_menu(app: &tauri::AppHandle<tauri::Wry>) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::SubmenuBuilder;
`;

const menuVars = [];
for (let i = 0; i < macosMenus.length; i++) {
  const varName = `menu_${i}`;
  menuVars.push(varName);
  macosRust += buildMenuBlock(macosMenus[i], varName);
}

macosRust += `    tauri::menu::MenuBuilder::new(app)\n        .items(&[${menuVars.map(v => `&${v}`).join(", ")}])\n        .build()\n}\n`;

put("src-tauri/src/generated/macos_menu.generated.rs", macosRust);

put("src/app/generated/archiveFileTypes.generated.json", json({
  singleExtensions: archive.singleExtensions,
  compoundExtensions: archive.compoundExtensions,
  splitArchiveSuffixes: archive.splitArchiveSuffixes,
  associationTypes: archive.associationTypes,
  packageAssociationProfiles: archive.packageAssociationProfiles,
}));
put("src-tauri/src/generated/archive_file_types.generated.json", json({
  singleExtensions: archive.singleExtensions,
  compoundExtensions: archive.compoundExtensions,
  splitArchiveSuffixes: archive.splitArchiveSuffixes,
  associationTypes: archive.associationTypes,
  packageAssociationProfiles: archive.packageAssociationProfiles,
}));
// The manifest itself is a generated output: extension data is derived from
// the contract, so --check detects any drift.
put("manifests/archive-file-types.json", json(archive));

const actionIds = shell.actions.map(({ id }) => id);
put("src/api/generated/shellActions.generated.ts", `// Generated by scripts/generate-native-contracts.mjs. Do not edit.
export const SHELL_ACTION_REQUEST_VERSION = ${shell.requestVersion} as const;
export const SHELL_ACTION_IDS = ${JSON.stringify(actionIds, null, 2)} as const;
export type GeneratedShellActionKind = (typeof SHELL_ACTION_IDS)[number];
export const SHELL_ACTION_POLICIES = ${JSON.stringify(shell.actions.map(({ id, canonicalLabel, displayKey, nativeVerb, order, contextMenuOrder, contextMenuContexts, selectionShapes, multiplicity, nativeSurfaces, compatibilityAliases, windowDisposition }) => ({ id, canonicalLabel, displayKey, nativeVerb, order, contextMenuOrder, contextMenuContexts, selectionShapes, multiplicity, nativeSurfaces, compatibilityAliases, windowDisposition })), null, 2)} as const;
`);

put("src/api/generated/nativeInboundEvents.generated.ts", `// Generated by scripts/generate-native-contracts.mjs. Do not edit.
import type { GeneratedShellActionKind } from "./shellActions.generated";

export const NATIVE_INBOUND_EVENT_VERSION = ${inbound.properties.version.const} as const;
export const NATIVE_INBOUND_EVENT_KINDS = ${JSON.stringify(inbound.properties.kind.enum, null, 2)} as const;
export type NativeInboundEventKind = (typeof NATIVE_INBOUND_EVENT_KINDS)[number];
export type NativeInboundOpenPathsEvent = Readonly<{
  version: typeof NATIVE_INBOUND_EVENT_VERSION;
  eventId: string;
  kind: "openPaths";
  timestampUnixMs: number;
  idempotencyKey?: string | null;
  payload: Readonly<{ paths: string[] }>;
}>;
export type NativeInboundShellActionEvent = Readonly<{
  version: typeof NATIVE_INBOUND_EVENT_VERSION;
  eventId: string;
  kind: "shellActionRequest";
  timestampUnixMs: number;
  idempotencyKey?: string | null;
  payload: Readonly<{ request: Readonly<{ kind: GeneratedShellActionKind; paths: string[] }> }>;
}>;
export type NativeInboundHostedAuthEvent = Readonly<{
  version: typeof NATIVE_INBOUND_EVENT_VERSION;
  eventId: string;
  kind: "hostedAuthCallback";
  timestampUnixMs: number;
  idempotencyKey?: string | null;
  payload: Readonly<{
    state: string;
    result: "completed" | "cancelled" | "failed";
    errorCode?: string | null;
    handoffCode?: string;
    callbackUrl?: string;
  }>;
}>;
export type NativeInboundReopenEvent = Readonly<{
  version: typeof NATIVE_INBOUND_EVENT_VERSION;
  eventId: string;
  kind: "reopenApplication";
  timestampUnixMs: number;
  idempotencyKey?: string | null;
  payload: Readonly<Record<string, never>>;
}>;
export type NativeInboundEvent =
  | NativeInboundOpenPathsEvent
  | NativeInboundShellActionEvent
  | NativeInboundHostedAuthEvent
  | NativeInboundReopenEvent;
`);

put("src/api/generated/nativeCapabilities.generated.ts", `// Generated by scripts/generate-native-contracts.mjs. Do not edit.
export const NATIVE_CAPABILITY_IDS = ${JSON.stringify(nativeCapabilities.capabilities.map(({ id }) => id), null, 2)} as const;
export type NativeCapabilityId = (typeof NATIVE_CAPABILITY_IDS)[number];
export const NATIVE_PACKAGE_KINDS = ${JSON.stringify(nativeCapabilities.packageKinds, null, 2)} as const;
export type NativePackageKind = (typeof NATIVE_PACKAGE_KINDS)[number];
export type NativeCapabilityApplicability = "required" | "optional" | "notApplicable";
export type NativeCapabilityAvailability = "available" | "unavailable" | "failed" | "notApplicable";
export type NativeCapabilitySourceState = "supported" | "unavailable" | "failed" | "notApplicable";
export type NativeCapabilityPackageState = "included" | "notIncluded" | "notInspected" | "failed" | "notApplicable";
export type NativeCapabilityInstalledState = "registered" | "unregistered" | "notInspected" | "failed" | "notApplicable";
export type NativeCapabilityUserEnabledState = "enabled" | "disabled" | "notInspected" | "failed" | "notApplicable";
export type NativeCapabilityRuntimeState = "ready" | "unavailable" | "notInspected" | "failed" | "notApplicable";
export type NativeCapabilityFailureCategory = ${nativeCapabilities.failureCategories.map((value) => JSON.stringify(value)).join(" | ")};
export type NativeCapabilityEvidence = Readonly<{
  source: readonly string[];
  package: readonly string[];
  installed: readonly string[];
}>;
export type NativeCapabilitySnapshot = Readonly<{
  id: NativeCapabilityId;
  applicability: NativeCapabilityApplicability;
  firstClass: boolean;
  sourceState: NativeCapabilitySourceState;
  packageState: NativeCapabilityPackageState;
  installedState: NativeCapabilityInstalledState;
  userEnabledState: NativeCapabilityUserEnabledState;
  runtimeState: NativeCapabilityRuntimeState;
  availability: NativeCapabilityAvailability;
  failureCategory?: NativeCapabilityFailureCategory | null;
  evidence: NativeCapabilityEvidence;
}>;
export const NATIVE_CAPABILITY_CATALOG = ${JSON.stringify(nativeCapabilities.capabilities, null, 2)} as const;

export function findNativeCapability(
  capabilities: readonly NativeCapabilitySnapshot[],
  id: NativeCapabilityId,
): NativeCapabilitySnapshot {
  const capability = capabilities.find((candidate) => candidate.id === id);
  if (!capability) {
    throw new Error(\`Native capability snapshot is missing \${id}\`);
  }
  return capability;
}

export function isNativeCapabilityAvailable(
  capabilities: readonly NativeCapabilitySnapshot[],
  id: NativeCapabilityId,
): boolean {
  return findNativeCapability(capabilities, id).availability === "available";
}
`);

const rustCapabilityCases = nativeCapabilities.capabilities
  .map(({ id }) => `    ${pascalCase(id)},`)
  .join("\n");
const rustCapabilityIds = nativeCapabilities.capabilities
  .map(({ id }) => `    NativeCapabilityId::${pascalCase(id)},`)
  .join("\n");
const rustPackageCases = nativeCapabilities.packageKinds
  .map((id) => `    ${pascalCase(id)},`)
  .join("\n");
const rustPackageIds = nativeCapabilities.packageKinds
  .map((id) => `    NativePackageKind::${pascalCase(id)},`)
  .join("\n");
put("src-tauri/src/generated/native_capabilities.generated.rs", `// Generated by scripts/generate-native-contracts.mjs. Do not edit.
#[derive(Debug, Clone, Copy, serde::Deserialize, serde::Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum NativeCapabilityId {
${rustCapabilityCases}
}

#[cfg(test)]
pub const NATIVE_CAPABILITY_IDS: &[NativeCapabilityId] = &[
${rustCapabilityIds}
];

#[derive(Debug, Clone, Copy, serde::Deserialize, serde::Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum NativePackageKind {
${rustPackageCases}
}

#[cfg(test)]
pub const NATIVE_PACKAGE_KINDS: &[NativePackageKind] = &[
${rustPackageIds}
];
`);
put(
  "src-tauri/src/generated/native_capabilities.generated.json",
  json(nativeCapabilities),
);
put("fixtures/contracts/native-capabilities.conformance.json", json({
  schemaVersion: nativeCapabilities.schemaVersion,
  packageKind: "development",
  platforms: Object.fromEntries(
    nativeCapabilities.platforms.map((platform) => [
      platform,
      buildBaselineCapabilitySnapshots(nativeCapabilities, platform, "development"),
    ]),
  ),
}));

const finderNamedLocalizationEntries = shell.actions
  .filter(({ macOSFinderNamedLabel }) => typeof macOSFinderNamedLabel === "string")
  .map((action) => ({
    key: `${action.displayKey}Named`,
    english: action.macOSFinderNamedLabel,
    zhHans: action.macOSFinderNamedLabelZhHans,
  }));
const localizationKeys = [
  ...archive.documentGroups.map(({ displayKey }) => displayKey),
  ...shell.actions.map(({ displayKey }) => displayKey),
  ...finderNamedLocalizationEntries.map(({ key }) => key),
].filter((key, index, all) => all.indexOf(key) === index);
put("src/app/generated/nativeLocalizationKeys.generated.ts", `// Generated by scripts/generate-native-contracts.mjs. Do not edit.
export const NATIVE_LOCALIZATION_KEYS = ${JSON.stringify(localizationKeys, null, 2)} as const;
export type NativeLocalizationKey = (typeof NATIVE_LOCALIZATION_KEYS)[number];
`);

const rustCases = shell.actions.map(({ rustCase }) => `    ${rustCase},`).join("\n");
const rustAliasArms = shell.actions.map(({ rustCase, compatibilityAliases }) =>
  `            ${compatibilityAliases.map((alias) => JSON.stringify(alias.toLowerCase().replace(/[-_ ]/g, ""))).join(" | ")} => Some(Self::${rustCase}),`
).join("\n");
const rustPolicies = shell.actions.map(({ rustCase, id, canonicalLabel, displayKey, nativeVerb, order, contextMenuOrder, contextMenuContexts, selectionShapes, multiplicity, nativeSurfaces, compatibilityAliases, windowDisposition }) => `    ShellActionPolicy {
        kind: ShellActionKind::${rustCase},
        id: "${id}",
        canonical_label: ${JSON.stringify(canonicalLabel)},
        display_key: "${displayKey}",
        native_verb: "${nativeVerb}",
        order: ${order},
        context_menu_order: ${contextMenuOrder === null ? "None" : `Some(${contextMenuOrder})`},
        context_menu_contexts: &[${contextMenuContexts.map((context) => `"${context}"`).join(", ")}],
        selection_shapes: &[${selectionShapes.map((shape) => `"${shape}"`).join(", ")}],
        multiplicity: "${multiplicity}",
        native_surfaces: &[${nativeSurfaces.map((surface) => `"${surface}"`).join(", ")}],
        compatibility_aliases: &[${compatibilityAliases.map((alias) => JSON.stringify(alias)).join(", ")}],
        window_disposition: ShellActionWindowDisposition::${windowDisposition === "mainWindow" ? "MainWindow" : "DisposableTask"},
    },`).join("\n");
put("crates/zmanager-shell-contract/src/generated.rs", `// Generated by scripts/generate-native-contracts.mjs. Do not edit.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ShellActionKind {
${rustCases}
}

impl ShellActionKind {
    pub fn from_normalized_compatibility_alias(value: &str) -> Option<Self> {
        match value {
${rustAliasArms}
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ShellActionWindowDisposition {
    MainWindow,
    DisposableTask,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ShellActionPolicy {
    pub kind: ShellActionKind,
    pub id: &'static str,
    pub canonical_label: &'static str,
    pub display_key: &'static str,
    pub native_verb: &'static str,
    pub order: u16,
    pub context_menu_order: Option<u16>,
    pub context_menu_contexts: &'static [&'static str],
    pub selection_shapes: &'static [&'static str],
    pub multiplicity: &'static str,
    pub native_surfaces: &'static [&'static str],
    pub compatibility_aliases: &'static [&'static str],
    pub window_disposition: ShellActionWindowDisposition,
}

pub const SHELL_ACTION_POLICIES: &[ShellActionPolicy] = &[
${rustPolicies}
];
`);

const swiftArchiveArrays = [
  ["singleExtensions", archive.singleExtensions],
  ["compoundExtensions", archive.compoundExtensions],
  ["splitArchiveSuffixes", archive.splitArchiveSuffixes]
].map(([name, values]) => `    public static let ${name}: [String] = [${values.map(swiftString).join(", ")}]`).join("\n");
put("native/macos/Sources/ZManagerGenerated/ArchiveFileTypes.generated.swift", `// Generated by scripts/generate-native-contracts.mjs. Do not edit.
public enum ArchiveFileTypes {
${swiftArchiveArrays}
}
`);

const swiftKeywords = new Set(["open"]);
const swiftActionCases = shell.actions.map(({ id }) => `    case ${swiftKeywords.has(id) ? `\`${id}\`` : id}`).join("\n");
const swiftActionPolicies = shell.actions.map(({ id, canonicalLabel, displayKey, nativeVerb, order, contextMenuOrder, contextMenuContexts, selectionShapes, multiplicity, nativeSurfaces }) => `        .init(id: .${id}, canonicalLabel: ${swiftString(canonicalLabel)}, displayKey: ${swiftString(displayKey)}, nativeVerb: ${swiftString(nativeVerb)}, order: ${order}, contextMenuOrder: ${contextMenuOrder === null ? "nil" : contextMenuOrder}, contextMenuContexts: [${contextMenuContexts.map(swiftString).join(", ")}], selectionShapes: [${selectionShapes.map(swiftString).join(", ")}], multiplicity: ${swiftString(multiplicity)}, nativeSurfaces: [${nativeSurfaces.map(swiftString).join(", ")}])`).join(",\n");
put("native/macos/Sources/ZManagerGenerated/ShellActions.generated.swift", `// Generated by scripts/generate-native-contracts.mjs. Do not edit.
public enum ShellActionID: String, Codable, CaseIterable, Sendable {
${swiftActionCases}
}
public struct ShellActionPolicy: Equatable, Sendable {
    public let id: ShellActionID
    public let canonicalLabel: String
    public let displayKey: String
    public let nativeVerb: String
    public let order: Int
    public let contextMenuOrder: Int?
    public let contextMenuContexts: [String]
    public let selectionShapes: [String]
    public let multiplicity: String
    public let nativeSurfaces: [String]
    public static let all: [ShellActionPolicy] = [
${swiftActionPolicies}
    ]
}
`);

put(
  "packaging/macos/FinderExtension/en.lproj/FinderActions.strings",
  strings([
    ...shell.actions.map(({ displayKey, canonicalLabel }) => [displayKey, canonicalLabel]),
    ...finderNamedLocalizationEntries.map(({ key, english }) => [key, english]),
  ]),
);
put(
  "packaging/macos/FinderExtension/zh-Hans.lproj/FinderActions.strings",
  strings([
    ...shell.actions.map(({ displayKey, canonicalLabelZhHans }) => [
      displayKey,
      canonicalLabelZhHans,
    ]),
    ...finderNamedLocalizationEntries.map(({ key, zhHans }) => [key, zhHans]),
  ]),
);
put(
  "packaging/macos/FinderExtension/en.lproj/InfoPlist.strings",
  strings([[
    "NSAppDataUsageDescription",
    "ZManager uses its private shared container to receive Finder actions without exposing selected file paths in URLs.",
  ]]),
);
put(
  "packaging/macos/FinderExtension/zh-Hans.lproj/InfoPlist.strings",
  strings([[
    "NSAppDataUsageDescription",
    "ZManager 使用其专用共享容器接收访达操作，避免在 URL 中暴露所选文件的路径。",
  ]]),
);

const swiftEventCases = inbound.properties.kind.enum.map((kind) => `    case ${kind}`).join("\n");
put("native/macos/Sources/ZManagerGenerated/NativeInboundEvents.generated.swift", `// Generated by scripts/generate-native-contracts.mjs. Do not edit.
public let nativeInboundEventVersion = ${inbound.properties.version.const}
public enum NativeInboundEventKind: String, Codable, CaseIterable, Sendable {
${swiftEventCases}
}
`);

const plistTypes = archive.documentGroups.map((group) => `    <dict><key>CFBundleTypeName</key><string>${group.displayKey}</string><key>CFBundleTypeExtensions</key><array>${group.extensions.map((extension) => `<string>${extension}</string>`).join("")}</array><key>CFBundleTypeRole</key><string>${group.role}</string><key>LSHandlerRank</key><string>${group.rank}</string></dict>`).join("\n");
const exported = archive.exportedTypes.map((type) => `    <dict><key>UTTypeIdentifier</key><string>${type.identifier}</string><key>UTTypeDescription</key><string>${type.descriptionKey}</string><key>UTTypeConformsTo</key><array>${type.conformsTo.map((value) => `<string>${value}</string>`).join("")}</array><key>UTTypeTagSpecification</key><dict><key>public.filename-extension</key><array>${type.extensions.map((value) => `<string>${value}</string>`).join("")}</array><key>public.mime-type</key><array>${type.mimeTypes.map((value) => `<string>${value}</string>`).join("")}</array></dict></dict>`).join("\n");
put("native/macos/Generated/InfoPlist.archive-types.generated.plist", `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleDocumentTypes</key><array>
${plistTypes}
</array><key>UTExportedTypeDeclarations</key><array>
${exported}
</array></dict></plist>
`);

put("native/macos/Generated/NativeLocalizationKeys.generated.strings", localizationKeys.map((key) => `/* Resolve this key in the native presentation target. */\n"${key}" = "${key}";`).join("\n"));
put("packaging/macos/archive-types.generated.json", json({
  schemaVersion: archive.schemaVersion,
  associatedExtensions: [...new Set([...archive.singleExtensions, ...archive.compoundExtensions, ...archive.splitArchiveSuffixes.map((suffix) => suffix.slice(1))])].sort(),
  documentGroups: archive.documentGroups,
  exportedTypes: archive.exportedTypes
}));

const customLinuxTypes = archive.associationTypes.filter(({ mimeType }) =>
  mimeType?.startsWith("application/x-zmanager-"));
put("packaging/linux/xdg-mime.xml", `<?xml version="1.0" encoding="UTF-8"?>
<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
${customLinuxTypes.map((type) => `  <mime-type type="${type.mimeType}">
    <comment>ZManager ${type.id.toUpperCase()} archive</comment>
    <icon name="${type.mimeType.replace('/', '-')}"/>
    <generic-icon name="x-office-archive"/>
${[...type.primaryExtensions, ...type.compoundExtensions].map((extension) => `    <glob pattern="*.${extension}"/>`).join("\n")}
  </mime-type>`).join("\n")}
</mime-info>
`);
put("packaging/linux/org.tzap-org.zmanager.desktop.metainfo.xml", `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>org.tzap-org.zmanager.desktop</id>
  <name>ZManager</name>
  <summary>Safe cross-platform archive manager</summary>
  <metadata_license>MIT</metadata_license>
  <project_license>Apache-2.0</project_license>
  <description>
    <p>ZManager is a desktop archive manager backed by the ZManager Rust archive engine. It supports browsing, testing, creating, and extracting common archive formats with safety-focused path handling.</p>
  </description>
  <launchable type="desktop-id">zmanager-desktop.desktop</launchable>
  <provides>
    <binary>zmanager-desktop</binary>
${archive.packageAssociationProfiles.linux.mimeTypes.map((mimeType) => `    <mediatype>${mimeType}</mediatype>`).join("\n")}
  </provides>
  <content_rating type="oars-1.1" />
  <releases>
    <release version="${productPackage.version}" date="2026-07-23" />
  </releases>
</component>
`);

put("fixtures/contracts/archive-associations.conformance.json", json({
  schemaVersion: archive.schemaVersion,
  associationTypes: archive.associationTypes,
  expectedPackages: {
    development: { extensions: [], mimeTypes: [] },
    nsis: {
      extensions: supportedAssociations,
      mimeTypes: [],
    },
    appImage: archive.packageAssociationProfiles.linux,
    deb: archive.packageAssociationProfiles.linux,
    rpm: archive.packageAssociationProfiles.linux,
    macosApp: {
      extensions: supportedAssociations,
      mimeTypes: [],
    },
    macosDmg: {
      extensions: supportedAssociations,
      mimeTypes: [],
    },
  },
}));

const tauriConfig = readJson("src-tauri/tauri.conf.json");
tauriConfig.bundle.fileAssociations = archive.associationTypes
  .filter(({ linux }) => linux)
  .map((type) => ({
    ext: [
      ...type.primaryExtensions,
      ...type.compoundExtensions,
      ...type.splitSuffixes.map((suffix) => suffix.slice(1)),
    ],
    name: `${type.id} archive`,
    description: `${type.id} archive`,
    role: "Viewer",
    mimeType: type.mimeType,
  }));
put("src-tauri/tauri.conf.json", json(tauriConfig));
put("packaging/macos/main-info.generated.json", json({
  schemaVersion: 1,
  documentGroups: archive.documentGroups,
  exportedTypes: archive.exportedTypes,
  services: shell.actions
    .filter(({ macOSServiceTitle }) => typeof macOSServiceTitle === "string")
    .map(({ id, displayKey, macOSServiceTitle, order }) => ({
      id,
      displayKey,
      title: macOSServiceTitle,
      order
    }))
}));
const englishInfo = [
  ["CFBundleDisplayName", "ZManager"],
  ["CFBundleName", "ZManager"],
  ["NSAppDataUsageDescription", "ZManager uses its private shared container to receive Finder actions without exposing selected file paths in URLs."],
  ...archive.documentGroups.map(({ displayKey, macOSDisplayName }) => [displayKey, macOSDisplayName]),
  ...archive.exportedTypes.map(({ descriptionKey, macOSDescription }) => [descriptionKey, macOSDescription]),
];
const chineseInfo = [
  ["CFBundleDisplayName", "ZManager"],
  ["CFBundleName", "ZManager"],
  ["NSAppDataUsageDescription", "ZManager 使用其专用共享容器接收访达操作，避免在 URL 中暴露所选文件的路径。"],
  ...archive.documentGroups.map(({ displayKey, macOSDisplayNameZhHans }) => [displayKey, macOSDisplayNameZhHans]),
  ...archive.exportedTypes.map(({ descriptionKey, macOSDescriptionZhHans }) => [descriptionKey, macOSDescriptionZhHans]),
];
const serviceActions = shell.actions.filter(({ macOSServiceTitle }) => typeof macOSServiceTitle === "string");
put("packaging/macos/Main/en.lproj/InfoPlist.strings", strings(englishInfo));
put("packaging/macos/Main/zh-Hans.lproj/InfoPlist.strings", strings(chineseInfo));
put("packaging/macos/Main/en.lproj/ServicesMenu.strings", strings(serviceActions.map(({ macOSServiceTitle }) => [macOSServiceTitle, macOSServiceTitle])));
put("packaging/macos/Main/zh-Hans.lproj/ServicesMenu.strings", strings(serviceActions.map(({ macOSServiceTitle, macOSServiceTitleZhHans }) => [macOSServiceTitle, macOSServiceTitleZhHans])));

const fixture = {
  schemaVersion: 1,
  shellActionRequestVersion: shell.requestVersion,
  actionOrder: actionIds,
  actions: shell.actions.map(({ id, canonicalLabel, nativeVerb, order, contextMenuOrder, contextMenuContexts, selectionShapes, multiplicity, nativeSurfaces, compatibilityAliases }) => ({ id, canonicalLabel, nativeVerb, order, contextMenuOrder, contextMenuContexts, selectionShapes, multiplicity, nativeSurfaces, compatibilityAliases })),
  archivePaths: [
    { path: "sample.tar.gz", supported: true, suffix: ".tar.gz", baseName: "sample" },
    { path: "sample.7z.001", supported: true, suffix: ".7z.001", baseName: "sample" },
    { path: "sample.vol000.tzap", supported: true, suffix: ".vol000.tzap", baseName: "sample" },
    { path: "sample.txt", supported: false, suffix: null, baseName: "sample" }
  ],
  inboundEventKinds: inbound.properties.kind.enum
};
put("fixtures/contracts/native-contracts.conformance.json", json(fixture));

const orderedContextActions = (surface, context) => shell.actions
  .filter((action) => action.nativeSurfaces.includes(surface)
    && action.contextMenuContexts.includes(context))
  .sort((left, right) => left.contextMenuOrder - right.contextMenuOrder);
const windowsActions = shell.actions.filter(({ nativeSurfaces }) =>
  nativeSurfaces.includes("windowsExplorer"));
const windowsGuidName = ({ nativeVerb }) => `${screamingSnakeCase(nativeVerb)}_CLSID`;
const windowsGuidValue = ({ windowsClsid }) => windowsClsid.replace(
  /^(.{8})-(.{4})-(.{4})-(.{4})-(.{12})$/,
  "$1_$2_$3_$4_$5",
);
put("native/windows-shell-extension/src/generated.rs", `// Generated by scripts/generate-native-contracts.mjs. Do not edit.
use std::path::Path;
use windows::core::{GUID, PCWSTR, w};
use zmanager_shell_contract::ShellActionKind;

${windowsActions.map((action) => `pub(crate) const ${windowsGuidName(action)}: GUID = GUID::from_u128(0x${windowsGuidValue(action)});`).join("\n")}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ExplorerAction {
${windowsActions.map(({ rustCase }) => `    ${rustCase},`).join("\n")}
}

#[cfg(test)]
pub(crate) const ALL_EXPLORER_ACTIONS: &[ExplorerAction] = &[
${windowsActions.map(({ rustCase }) => `    ExplorerAction::${rustCase},`).join("\n")}
];

impl ExplorerAction {
    pub(crate) fn from_clsid(clsid: &GUID) -> Option<Self> {
        match *clsid {
${windowsActions.map((action) => `            ${windowsGuidName(action)} => Some(Self::${action.rustCase}),`).join("\n")}
            _ => None,
        }
    }

    pub(crate) fn clsid(self) -> GUID {
        match self {
${windowsActions.map((action) => `            Self::${action.rustCase} => ${windowsGuidName(action)},`).join("\n")}
        }
    }

    pub(crate) fn title(self) -> PCWSTR {
        match self {
${windowsActions.map((action) => `            Self::${action.rustCase} => w!(${JSON.stringify(action.canonicalLabel)}),`).join("\n")}
        }
    }

    pub(crate) fn shell_action(self) -> ShellActionKind {
        match self {
${windowsActions.map((action) => `            Self::${action.rustCase} => ShellActionKind::${action.rustCase},`).join("\n")}
        }
    }

    pub(crate) fn supports_count(self, count: u32) -> bool {
        if count == 0 {
            return false;
        }
        match self {
${windowsActions.filter(({ multiplicity }) => multiplicity === "exactly-one").map(({ rustCase }) => `            Self::${rustCase} => count == 1,`).join("\n")}
            _ => true,
        }
    }

    pub(crate) fn supports_paths(self, paths: &[String]) -> bool {
        if !self.supports_count(paths.len() as u32) {
            return false;
        }
        match self {
${windowsActions.filter(({ selectionShapes }) => selectionShapes.includes("files") && selectionShapes.every((shape) => ["files", "single-archive"].includes(shape))).map(({ rustCase }) => `            Self::${rustCase} => paths.iter().all(|path| Path::new(path).is_file()),`).join("\n")}
            _ => true,
        }
    }
}
`);

const nsisClsidName = (action) => `ZM_${screamingSnakeCase(action.nativeVerb)}_CLSID`;
const nsisActionRows = (context, command) => orderedContextActions("windowsExplorer", context)
  .map((action, index) => {
    const verb = `${String(index + 1).padStart(2, "0")}${action.nativeVerb}`;
    if (command) {
      return `  !insertmacro ZM_WRITE_COMMAND_SUBCOMMAND_VERB "\${ZM_CREATE_BACKGROUND_SUBCOMMANDS_KEY}" "${verb}" "${action.canonicalLabel}" "${action.compatibilityAliases[0]}" "%V"`;
    }
    const key = context === "creation"
      ? "ZM_CREATE_FILE_SUBCOMMANDS_KEY"
      : "ZM_ARCHIVE_SUBCOMMANDS_KEY";
    return `  !insertmacro ZM_WRITE_COM_SUBCOMMAND_VERB "\${${key}}" "${verb}" "${action.canonicalLabel}" "\${${nsisClsidName(action)}}"`;
  })
  .join("\n");
put("packaging/windows/nsis-shell-actions.generated.nsh", `; Generated by scripts/generate-native-contracts.mjs. Do not edit.
${windowsActions.map((action) => `!define ${nsisClsidName(action)} "{${action.windowsClsid.toUpperCase()}}"`).join("\n")}

!macro ZM_REGISTER_GENERATED_SHELL_EXTENSION_CLASSES
${windowsActions.map((action) => `  !insertmacro ZM_REGISTER_COM_CLASS "\${${nsisClsidName(action)}}"`).join("\n")}
!macroend

!macro ZM_UNREGISTER_GENERATED_SHELL_EXTENSION_CLASSES
${windowsActions.map((action) => `  !insertmacro ZM_UNREGISTER_COM_CLASS "\${${nsisClsidName(action)}}"`).join("\n")}
!macroend

!macro ZM_REGISTER_GENERATED_ORDERED_SUBCOMMANDS
${nsisActionRows("archiveSingle", false)}
${nsisActionRows("creation", false)}
${nsisActionRows("container", true)}
!macroend
`);

const linuxDesktopActions = orderedContextActions("linuxDesktop", "archiveSingle");
const linuxMimeTypes = `${archive.packageAssociationProfiles.linux.mimeTypes.join(";")};`;
const desktopActionBlocks = (exec) => linuxDesktopActions.map((action) => `
[Desktop Action ${action.nativeVerb}]
Name=${action.canonicalLabel}
Exec=${exec} --quick-action ${action.compatibilityAliases[0]} --path ${action.multiplicity === "exactly-one" ? "%f" : "%F"}
Icon=${exec === "{{exec}}" ? "{{icon}}" : "zmanager-desktop"}`).join("\n");
const desktopActionNames = linuxDesktopActions.map(({ nativeVerb }) => nativeVerb).join(";");
put("packaging/linux/zmanager-desktop.desktop", `[Desktop Entry]
Categories=Utility;
Comment=Safe archive manager for Windows, Linux, and macOS
Exec=zmanager-desktop %U
Icon=zmanager-desktop
MimeType=${linuxMimeTypes}
Name=ZManager
StartupWMClass=zmanager-desktop
StartupNotify=true
Terminal=false
Type=Application
Actions=${desktopActionNames};
${desktopActionBlocks("zmanager-desktop")}
`);
put("packaging/linux/zmanager.desktop.hbs", `[Desktop Entry]
Categories={{categories}}
{{#if comment}}Comment={{comment}}{{/if}}
Exec={{exec}} %U
Icon={{icon}}
MimeType=${linuxMimeTypes}
Name={{name}}
NoDisplay=true
StartupWMClass=zmanager-desktop
StartupNotify=true
Terminal=false
Type=Application
Actions=${desktopActionNames};
${desktopActionBlocks("{{exec}}")}
`);

const kdeFile = (contexts, mimeTypes) => {
  const actions = shell.actions
    .filter((action) => action.nativeSurfaces.includes("linuxKde")
      && action.contextMenuContexts.some((context) => contexts.includes(context)))
    .sort((left, right) => left.contextMenuOrder - right.contextMenuOrder);
  return `[Desktop Entry]
Type=Service
Name=ZManager
X-KDE-ServiceTypes=KonqPopupMenu/Plugin
MimeType=${mimeTypes}
Actions=${actions.map(({ nativeVerb }) => nativeVerb).join(";")};
X-KDE-Priority=TopLevel
X-KDE-Submenu=ZManager
${actions.map((action) => `
[Desktop Action ${action.nativeVerb}]
Name=${action.canonicalLabel}
Icon=zmanager-desktop
Exec=zmanager-desktop --quick-action ${action.compatibilityAliases[0]} --path ${action.multiplicity === "exactly-one" ? "%f" : "%F"}`).join("\n")}
`;
};
put(
  "packaging/linux/kde/zmanager-servicemenu.desktop",
  kdeFile(["creation", "container"], "application/octet-stream;inode/directory;"),
);
put(
  "packaging/linux/kde/zmanager-archive-servicemenu.desktop",
  kdeFile(["archiveSingle", "archiveMultiple"], linuxMimeTypes),
);

const nautilusArchiveActions = orderedContextActions("linuxNautilus", "archiveSingle")
  .filter(({ contextMenuContexts }) => contextMenuContexts.some((context) =>
    context === "archiveSingle" || context === "archiveMultiple"));
const nautilusCreateActions = orderedContextActions("linuxNautilus", "creation");
const archiveSuffixes = [
  ...archive.splitArchiveSuffixes,
  ...archive.compoundExtensions.map((extension) => `.${extension}`),
  ...archive.singleExtensions.map((extension) => `.${extension}`),
].sort((left, right) => right.length - left.length || left.localeCompare(right));
put("packaging/linux/nautilus/zmanager_shell_actions_generated.py", `# Generated by scripts/generate-native-contracts.mjs. Do not edit.
ARCHIVE_SUFFIXES = (
${archiveSuffixes.map((suffix) => `    ${JSON.stringify(suffix)},`).join("\n")}
)

ARCHIVE_ACTIONS = (
${nautilusArchiveActions.map((action) => `    (${JSON.stringify(action.nativeVerb)}, ${JSON.stringify(action.canonicalLabel)}, ${JSON.stringify(action.compatibilityAliases[0])}, ${action.contextMenuContexts.includes("archiveMultiple") ? "True" : "False"}),`).join("\n")}
)

CREATE_ACTIONS = (
${nautilusCreateActions.map((action) => `    (${JSON.stringify(action.nativeVerb)}, ${JSON.stringify(action.canonicalLabel)}, ${JSON.stringify(action.compatibilityAliases[0])}, ${action.multiplicity === "one-or-more" ? "True" : "False"}),`).join("\n")}
)
`);

let windowsHook = readFileSync(resolve(root, "packaging/windows/nsis-context-menu.nsh"), "utf8");
const windowsExtensions = [...new Set(supportedAssociations)]
  .map((extension) => `.${extension}`)
  .sort((a, b) => a.localeCompare(b));
const newline = windowsHook.includes("\r\n") ? "\r\n" : "\n";
for (const [macro, inserted] of [["ZM_REGISTER_ARCHIVE_EXTENSIONS", "ZM_REGISTER_ARCHIVE_EXTENSION"], ["ZM_UNREGISTER_ARCHIVE_EXTENSIONS", "ZM_UNREGISTER_ARCHIVE_EXTENSION"]]) {
  const body = windowsExtensions.map((extension) => `  !insertmacro ${inserted} "${extension}"`).join(newline);
  windowsHook = windowsHook.replace(new RegExp(`(!macro ${macro}\\r?\\n)[\\s\\S]*?(!macroend)`), `$1${body}${newline}$2`);
}
const appliesToBody = windowsExtensions.map((extension) => `NOT System.FileExtension:=${extension}`).join(" AND ");
windowsHook = windowsHook.replace(/(!define ZM_NON_ARCHIVE_FILE_APPLIES_TO ")[^"]+(")/, `$1${appliesToBody}$2`);
put("packaging/windows/nsis-context-menu.nsh", windowsHook);

// macOS FFI generator
{
  let rust = `// GENERATED FILE - DO NOT EDIT\n\n#[allow(dead_code)]\nunsafe extern "C" {\n`;
  let swift = `// GENERATED FILE - DO NOT EDIT\n\nimport Foundation\n\n`;

  for (const op of macosFfi.operations) {
    if (op.type === "async-json") {
      rust += `    pub fn ${op.name}(\n        bytes: *const u8,\n        length: usize,\n        callback: Option<extern "C" fn(*const u8, usize, *mut c_void)>,\n        context: *mut c_void,\n    ) -> i32;\n`;
    } else if (op.type === "lifecycle") {
      if (op.name === "zmanager_macos_host_start") {
        rust += `    pub fn ${op.name}(\n        callback: Option<extern "C" fn(*const u8, usize, *mut c_void)>,\n        context: *mut c_void,\n    ) -> i32;\n`;
      } else if (op.name === "zmanager_macos_host_is_running") {
        rust += `    pub fn ${op.name}() -> i32;\n`;
      } else {
        rust += `    pub fn ${op.name}();\n`;
      }
    } else if (op.type === "async-drag") {
      rust += `    pub fn ${op.name}(\n        view: *mut c_void,\n        session_bytes: *const u8,\n        session_length: usize,\n        item_bytes: *const u8,\n        item_length: usize,\n        write: Option<extern "C" fn(*const u8, usize, *const u8, usize, *mut c_void) -> i32>,\n        outcome: Option<extern "C" fn(i32, *mut c_void)>,\n        release: Option<extern "C" fn(*mut c_void)>,\n        context: *mut c_void,\n    ) -> i32;\n`;
    }
  }
  rust += `}\n\n`;

  rust += `\n#[allow(dead_code)]\npub const MAX_REQUEST_BYTES: usize = ${macosFfi.limits.maxRequestBytes};\n`;
  rust += `#[allow(dead_code)]\npub const MAX_RESPONSE_BYTES: usize = ${macosFfi.limits.maxResponseBytes};\n`;
  rust += `#[allow(dead_code)]\npub const MAX_DRAG_ITEMS: usize = ${macosFfi.limits.maxDragItems};\n`;
  
  swift += `public enum MacOSFFILimits {\n`;
  swift += `    public static let maxRequestBytes = ${macosFfi.limits.maxRequestBytes}\n`;
  swift += `    public static let maxResponseBytes = ${macosFfi.limits.maxResponseBytes}\n`;
  swift += `    public static let maxDragItems = ${macosFfi.limits.maxDragItems}\n`;
  swift += `}\n\n`;

  swift += `public enum MacOSFFIErrorMapping {\n`;
  for (const [key, val] of Object.entries(macosFfi.errorMapping)) {
    swift += `    public static let ${key}: Int32 = ${val}\n`;
  }
  swift += `}\n`;
  
  put("src-tauri/src/generated/macos_ffi.generated.rs", rust);
  put("native/macos/Sources/ZManagerGenerated/MacOSFFI.generated.swift", swift);
}

const drift = [];
for (const [path, content] of outputs) {
  const absolute = resolve(root, path);
  if (check) {
    let existing = null;
    try { existing = readFileSync(absolute, "utf8"); } catch {}
    if (existing !== content) drift.push(path);
  } else {
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
}
if (drift.length) {
  console.error(`generated native contracts are stale:\n${drift.map((path) => `  ${path}`).join("\n")}\nRun npm run generate:contracts.`);
  process.exit(1);
}
console.log(check ? `generated native contracts are current (${outputs.size} outputs)` : `generated native contracts written (${outputs.size} outputs)`);
