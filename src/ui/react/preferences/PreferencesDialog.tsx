import { useEffect, useState, type ButtonHTMLAttributes } from "react";
import {
  Archive,
  Columns,
  FolderOpen,
  Monitor,
  ShieldCheck,
  Sparkles,
  Wifi,
  X,
} from "lucide-react";

import {
  createFormatSupportsPassword,
  TZAP_RECOVERY_PERCENTAGE_DEFAULT,
  TZAP_RECOVERY_PERCENTAGE_MAX,
  TZAP_RECOVERY_PERCENTAGE_MIN,
} from "../../../app/createFlow";
import {
  createDefaultsForFormat,
  type AppPreferences,
  type FormatCreateDefaults,
} from "../../../app/preferences";
import { FIXED_TZAP_BUILD_ENVIRONMENT } from "../../../app/tzapEnvironment";
import { createFormatCapabilities, supportedCreateFormats } from "../../../app/createFormatCapabilities";
import {
  formatVolumeSize,
  formatVolumeSizePresetList,
  parseVolumeSizePresetList,
} from "../../../app/volumeSizePresets";
import { GroupedColumnPreferences } from "./GroupedColumnPreferences";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { InfoTip } from "../../components/ui/info-tip";
import { useZManagerActions, useZManagerSnapshot } from "../AppProviders";
import { translatorForSnapshot } from "../shell/shellHelpers";
import { CompressionLevelSelect } from "../create/CompressionLevelSelect";
import { DesktopDialog } from "../dialogs/DesktopDialog";
import {
  fieldValidationProps,
  FieldMessage,
} from "../../components/ui/field-message";

type PreferencePage =
  "folders" | "archive" | "columns" | "extraction" | "interface" | "lanSharing" | "safety" | "advanced";
type CreateFormat = AppPreferences["defaultArchiveFormat"];

const FORMAT_LABELS: Record<CreateFormat, string> = {
  zip: "ZIP",
  tarZst: "TZST",
  tarGz: "TGZ",
  tzap: "TZAP",
  sevenZ: "7Z",
  appleArchive: "AAR",
};

const PAGE_ICONS: Record<PreferencePage, typeof FolderOpen> = {
  folders: FolderOpen,
  archive: Archive,
  columns: Columns,
  extraction: Sparkles,
  interface: Monitor,
  lanSharing: Wifi,
  safety: ShieldCheck,
  advanced: Sparkles, // reusing Sparkles or maybe Settings if imported, but let's use Sparkles for now
};

const PREFERENCE_PAGE_CLASS = [
  "space-y-5",
  "[&>h3]:text-xl [&>h3]:font-semibold [&>h3]:tracking-tight",
].join(" ");

const DESCRIPTION_CLASS =
  "-mt-3 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400";
const SETTING_GRID_CLASS = "grid gap-3 lg:grid-cols-2";
const SETTING_ROW_CLASS =
  "grid grid-cols-1 items-start gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/70 [&>label]:text-sm [&>label]:font-semibold";
const SETTING_CONTROL_CLASS = "min-w-0 space-y-2 [&_select]:w-full";
const SETTING_DESCRIPTION_CLASS =
  "text-xs leading-5 text-slate-500 dark:text-slate-400";
const QUICK_BADGE_CLASS =
  "mr-1 inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300";
const INLINE_FIELD_CLASS = "grid grid-cols-[minmax(0,1fr)_auto] gap-2";
const TOGGLE_GRID_CLASS = "grid gap-3 lg:grid-cols-2";
const TOGGLE_LINE_CLASS =
  "flex min-h-11 items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900/70";

const PAGES: readonly Readonly<{
  id: PreferencePage;
  labelKey: Parameters<ReturnType<typeof translatorForSnapshot>["t"]>[0];
}>[] = [
  { id: "folders", labelKey: "preferences.folders.title" },
  { id: "archive", labelKey: "preferences.archiveDefaults.title" },
  { id: "columns", labelKey: "preferences.columns.title" },
  { id: "extraction", labelKey: "preferences.extraction.title" },
  { id: "interface", labelKey: "preferences.interface.title" },
  { id: "lanSharing", labelKey: "preferences.lanSharing.title" },
  { id: "safety", labelKey: "preferences.safety.title" },
  { id: "advanced", labelKey: "preferences.advanced.title" },
];

export function PreferencesDialog() {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();
  const i18n = translatorForSnapshot(snapshot);
  const draft = snapshot.preferencesDraft;
  const [activePage, setActivePage] = useState<PreferencePage>("folders");
  const [selectedCreateFormat, setSelectedCreateFormat] =
    useState<CreateFormat>(
      draft?.defaultArchiveFormat ?? snapshot.preferences.defaultArchiveFormat,
    );
  const [customOutputFocused, setCustomOutputFocused] = useState(false);

  useEffect(() => {
    if (draft) {
      setSelectedCreateFormat(draft.defaultArchiveFormat);
    }
  }, [draft?.defaultArchiveFormat]);

  if (!draft) {
    return null;
  }

  const customOutputSelected = draft.defaultOutputLocation === "customFolder";
  const customOutputMissing =
    customOutputSelected && !draft.customOutputFolderPath.trim();
  const visiblePages = PAGES.filter(
    (page) => page.id !== "lanSharing" || snapshot.runtime.isLocalSendAvailable,
  );
  const effectiveActivePage =
    activePage === "lanSharing" && !snapshot.runtime.isLocalSendAvailable ? "folders" : activePage;

  return (
    <DesktopDialog
      titleId="preferences-title"
      descriptionId="preferences-description"
      widthClassName="w-[min(1040px,calc(100vw-48px))]"
      minHeightClassName="min-h-[min(780px,calc(100vh-48px))]"
      header={
        <div className="flex items-start justify-between gap-6 border-b border-slate-200 px-7 py-5 dark:border-slate-800">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-blue-600 dark:text-blue-400">
              <Sparkles className="size-3.5" />
              ZManager
            </div>
            <h2
              id="preferences-title"
              className="text-2xl font-semibold tracking-tight"
            >
              {i18n.t("preferences.title")}
            </h2>
            <p
              id="preferences-description"
              className="mt-1 text-sm text-slate-500 dark:text-slate-400"
            >
              {i18n.t("preferences.description")}
            </p>
          </div>
          <Button
            id="preferences-dialog-close"
            variant="dialog"
            size="unset"
            className="!size-9 !rounded-lg !border-0 !bg-transparent !p-0 hover:!bg-slate-100 dark:hover:!bg-slate-800"
            type="button"
            aria-label={i18n.t("preferences.close.aria")}
            onClick={() =>
              actions.handleDialogIntent({ type: "preferencesCancel" })
            }
          >
            <X className="size-4" />
          </Button>
        </div>
      }
      content={
        <div className="grid grid-cols-[220px_minmax(0,1fr)] max-md:grid-cols-1">
          <nav
            className="flex flex-col gap-1 border-r border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/45 max-md:flex-row max-md:overflow-x-auto max-md:border-b max-md:border-r-0"
            aria-label="Preference categories"
          >
            {visiblePages.map((page) => (
              <PreferenceNavigationButton
                icon={PAGE_ICONS[page.id]}
                type="button"
                data-pref-page-target={page.id}
                aria-selected={effectiveActivePage === page.id}
                onClick={() => setActivePage(page.id)}
                key={page.id}
              >
                {i18n.t(page.labelKey)}
              </PreferenceNavigationButton>
            ))}
          </nav>
          <div className="bg-slate-50/35 px-7 py-6 dark:bg-slate-950">
            <div className="mx-auto max-w-3xl">
              <FoldersPage
                draft={draft}
                active={effectiveActivePage === "folders"}
                customOutputFocused={customOutputFocused}
                customOutputMissing={customOutputMissing}
                setCustomOutputFocused={setCustomOutputFocused}
              />
              <ArchiveDefaultsPage
                draft={draft}
                active={effectiveActivePage === "archive"}
                selectedCreateFormat={selectedCreateFormat}
                setSelectedCreateFormat={setSelectedCreateFormat}
              />
              <ExtractionPage
                draft={draft}
                active={effectiveActivePage === "extraction"}
              />
              <InterfacePage
                draft={draft}
                active={effectiveActivePage === "interface"}
              />
              {snapshot.runtime.isLocalSendAvailable ? (
                <LanSharingPage draft={draft} active={effectiveActivePage === "lanSharing"} />
              ) : null}
              <ColumnsPage
                draft={draft}
                active={effectiveActivePage === "columns"}
              />
              <SafetyPage draft={draft} active={activePage === "safety"} />
              <AdvancedPage draft={draft} active={activePage === "advanced"} />
              <p
                id="preferences-status"
                className={`mt-6 rounded-xl border px-4 py-3 text-xs ${customOutputMissing ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" : "border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-400"}`}
              >
                {i18n.t("preferences.status.localOnly")}
              </p>
            </div>
          </div>
        </div>
      }
      footer={
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-7 py-4 dark:border-slate-800 dark:bg-slate-950">
          <Button
            id="preferences-cancel"
            type="button"
            variant="dialog"
            size="unset"
            onClick={() =>
              actions.handleDialogIntent({ type: "preferencesCancel" })
            }
          >
            {i18n.t("common.cancel")}
          </Button>
          <Button
            id="preferences-save"
            type="button"
            variant="dialogPrimary"
            size="unset"
            disabled={customOutputMissing}
            onClick={() =>
              actions.handleDialogIntent({ type: "preferencesSave" })
            }
          >
            {i18n.t("common.save")}
          </Button>
        </div>
      }
      onEscape={() => actions.handleDialogIntent({ type: "preferencesCancel" })}
      revealFirstInvalidControl={customOutputMissing}
    />
  );
}

function PreferenceNavigationButton({
  icon: Icon,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: typeof FolderOpen }) {
  return (
    <button
      {...props}
      className="flex min-w-max items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-600 transition-colors hover:bg-white hover:text-slate-950 aria-selected:bg-white aria-selected:text-blue-700 aria-selected:shadow-sm dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white dark:aria-selected:bg-slate-800 dark:aria-selected:text-blue-300"
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </button>
  );
}

function FoldersPage({
  draft,
  active,
  customOutputFocused,
  customOutputMissing,
  setCustomOutputFocused,
}: Readonly<{
  draft: AppPreferences;
  active: boolean;
  customOutputFocused: boolean;
  customOutputMissing: boolean;
  setCustomOutputFocused(value: boolean): void;
}>) {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();
  const i18n = translatorForSnapshot(snapshot);
  const customOutputSelected = draft.defaultOutputLocation === "customFolder";
  const customOutputDisplay = customOutputFocused
    ? draft.customOutputFolderPath
    : middleTruncatePath(draft.customOutputFolderPath);

  return (
    <section
      className={PREFERENCE_PAGE_CLASS}
      data-pref-page="folders"
      hidden={!active}
    >
      <h3>{i18n.t("preferences.folders.title")}</h3>
      <p className={DESCRIPTION_CLASS}>
        {i18n.t("preferences.folders.description")}
      </p>
      <div className={SETTING_ROW_CLASS}>
        <label htmlFor="pref-output-location">
          {i18n.t("preferences.folders.workingOutput")}
        </label>
        <div className={SETTING_CONTROL_CLASS}>
          <Select
            value={draft.defaultOutputLocation}
            onValueChange={(value) =>
              actions.handleDialogIntent({
                type: "preferencesPatch",
                patch: {
                  defaultOutputLocation: value as AppPreferences["defaultOutputLocation"],
                },
              })
            }
          >
            <SelectTrigger id="pref-output-location">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sourceFolder">
                {i18n.t("preferences.folders.sourceFolder")}
              </SelectItem>
              <SelectItem value="customFolder">
                {i18n.t("preferences.folders.customFolder")}
              </SelectItem>
            </SelectContent>
          </Select>
          <p className={SETTING_DESCRIPTION_CLASS}>
            <span className={QUICK_BADGE_CLASS}>
              {i18n.t("preferences.quickActions.badge")}
            </span>{" "}
            <span>{i18n.t("preferences.folders.quickDescription")}</span>
          </p>
        </div>
      </div>
      <div className={SETTING_ROW_CLASS}>
        <label htmlFor="pref-custom-output">
          {i18n.t("preferences.folders.customFolder")}
        </label>
        <div className={SETTING_CONTROL_CLASS}>
          <div className={INLINE_FIELD_CLASS}>
            <input
              id="pref-custom-output"
              className="path-input"
              type="text"
              {...fieldValidationProps(customOutputMissing, [
                "pref-custom-output-help",
                "pref-custom-output-validation",
              ])}
              placeholder={i18n.t("preferences.folders.customPlaceholder")}
              value={customOutputDisplay}
              title={draft.customOutputFolderPath}
              disabled={!customOutputSelected}
              onFocus={() => setCustomOutputFocused(true)}
              onChange={(event) =>
                actions.handleDialogIntent({
                  type: "preferencesPatch",
                  patch: { customOutputFolderPath: event.currentTarget.value },
                })
              }
              onBlur={() => setCustomOutputFocused(false)}
            />
            <Button
              id="pref-choose-output"
              type="button"
              variant="dialog"
              size="unset"
              disabled={!customOutputSelected}
              onClick={() =>
                actions.handleDialogIntent({ type: "preferencesChooseOutput" })
              }
            >
              {i18n.t("common.browse")}
            </Button>
          </div>
          <p id="pref-custom-output-help" className={SETTING_DESCRIPTION_CLASS}>
            {i18n.t("preferences.folders.customHelp")}
          </p>
          <FieldMessage
            id="pref-custom-output-validation"
            error={
              customOutputMissing
                ? i18n.t("preferences.validation.customOutputRequired")
                : null
            }
          />
        </div>
      </div>
      <div className="mt-4 rounded-lg border border-black/10 bg-black/[0.025] p-3 dark:border-white/10 dark:bg-white/[0.035]">
        <label
          className="mb-2 block text-xs font-semibold"
          htmlFor="pref-custom-extract-output"
        >
          {i18n.t("preferences.folders.extractFolder")}
        </label>
        <div className="flex gap-2">
          <input
            id="pref-custom-extract-output"
            className="min-w-0 flex-1"
            type="text"
            placeholder={i18n.t("preferences.folders.extractPlaceholder")}
            value={draft.customExtractFolderPath}
            onChange={(event) =>
              actions.handleDialogIntent({
                type: "preferencesPatch",
                patch: { customExtractFolderPath: event.currentTarget.value },
              })
            }
          />
          <Button
            id="pref-choose-extract-output"
            type="button"
            variant="dialog"
            size="unset"
            onClick={() =>
              actions.handleDialogIntent({
                type: "preferencesChooseExtractOutput",
              })
            }
          >
            {i18n.t("common.browse")}
          </Button>
        </div>
        <p className="mt-2 text-xs opacity-70">
          {i18n.t("preferences.folders.extractHelp")}
        </p>
      </div>
    </section>
  );
}

export function ArchiveDefaultsPage({
  draft,
  active,
  selectedCreateFormat,
  setSelectedCreateFormat,
}: Readonly<{
  draft: AppPreferences;
  active: boolean;
  selectedCreateFormat: CreateFormat;
  setSelectedCreateFormat(format: CreateFormat): void;
}>) {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();
  const i18n = translatorForSnapshot(snapshot);
  const defaults = createDefaultsForFormat(draft, selectedCreateFormat);
  const supportsTzapRecovery = selectedCreateFormat === "tzap";
  const supportsPassword = createFormatSupportsPassword(selectedCreateFormat);
  const capabilities = createFormatCapabilities(selectedCreateFormat);
  const activeSigningIdentities = snapshot.account.certificates.filter(
    (certificate) => certificate.state === "active",
  );
  const selectedTzapSigningDefault = defaults.tzapSigningDefault === "identity" &&
      defaults.tzapDefaultSigningIdentityId &&
      activeSigningIdentities.some(
        (certificate) => certificate.identityId === defaults.tzapDefaultSigningIdentityId,
      )
    ? `identity:${defaults.tzapDefaultSigningIdentityId}`
    : defaults.tzapSigningDefault ?? "accountDefault";
  const volumeSizeChoices =
    defaults.volumeSize !== null &&
    !draft.volumeSizePresets.includes(defaults.volumeSize)
      ? [defaults.volumeSize, ...draft.volumeSizePresets]
      : draft.volumeSizePresets;

  return (
    <section
      className={PREFERENCE_PAGE_CLASS}
      data-pref-page="archive"
      hidden={!active}
    >
      <h3>{i18n.t("preferences.archiveDefaults.title")}</h3>
      <p className={DESCRIPTION_CLASS}>
        {i18n.t("preferences.archiveDefaults.description")}
      </p>
      <div className={SETTING_GRID_CLASS}>
        <div className={SETTING_ROW_CLASS}>
          <label htmlFor="pref-default-format">
            {i18n.t("preferences.archiveDefaults.defaultFormat")}
          </label>
          <div className={SETTING_CONTROL_CLASS}>
            <FormatSelect
              id="pref-default-format"
              value={draft.defaultArchiveFormat}
              isMacOs={snapshot.runtime.isMacOs}
              onChange={(format) => {
                setSelectedCreateFormat(format);
                actions.handleDialogIntent({
                  type: "preferencesPatch",
                  patch: {
                    defaultArchiveFormat: format,
                    defaultCleanSourceEnabled: createDefaultsForFormat(
                      draft,
                      format,
                    ).cleanSource,
                  },
                });
              }}
            />
            <p className={SETTING_DESCRIPTION_CLASS}>
              <span className={QUICK_BADGE_CLASS}>
                {i18n.t("preferences.quickActions.badge")}
              </span>{" "}
              <span>
                {i18n.t("preferences.archiveDefaults.formatQuickDescription")}
              </span>
            </p>
          </div>
        </div>
        <div className={SETTING_ROW_CLASS}>
          <label htmlFor="pref-create-format">
            {i18n.t("preferences.archiveDefaults.editFormat")}
          </label>
          <div className={SETTING_CONTROL_CLASS}>
            <FormatSelect
              id="pref-create-format"
              value={selectedCreateFormat}
              isMacOs={snapshot.runtime.isMacOs}
              onChange={setSelectedCreateFormat}
            />
          </div>
        </div>
        <div
          className={SETTING_ROW_CLASS}
          hidden={!capabilities.compressionLevel}
        >
          <label htmlFor="pref-create-compression-level">
            {i18n.t("preferences.archiveDefaults.compressionLevel")}
          </label>
          <div className={SETTING_CONTROL_CLASS}>
            <CompressionLevelSelect
              id="pref-create-compression-level"
              value={defaults.compressionLevel}
              i18n={i18n}
              onChange={(value) =>
                patchCreateDefaults(actions, selectedCreateFormat, {
                  compressionLevel: optionalNumber(value),
                })
              }
            />
          </div>
        </div>
        <div className={SETTING_ROW_CLASS} hidden={!capabilities.splitVolumes}>
          <label htmlFor="pref-create-volume">
            {i18n.t("create.splitSize")}
          </label>
          <div className={SETTING_CONTROL_CLASS}>
            <Select
              value={defaults.volumeSize ? String(defaults.volumeSize) : "noSplit"}
              onValueChange={(value) =>
                patchCreateDefaults(actions, selectedCreateFormat, {
                  volumeSize: optionalPositiveNumber(value === "noSplit" ? "" : value),
                })
              }
            >
              <SelectTrigger id="pref-create-volume">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="noSplit">{i18n.t("create.noSplit")}</SelectItem>
                {volumeSizeChoices.map((bytes) => (
                  <SelectItem value={String(bytes)} key={bytes}>
                    {formatVolumeSize(bytes)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div
          id="pref-create-tzap-recovery-field"
          className={SETTING_ROW_CLASS}
          hidden={!supportsTzapRecovery}
        >
          <label htmlFor="pref-create-tzap-recovery">
            {i18n.t("create.tzapRecovery")}
          </label>
          <div className={SETTING_CONTROL_CLASS}>
            <input
              id="pref-create-tzap-recovery"
              type="number"
              min={TZAP_RECOVERY_PERCENTAGE_MIN}
              max={TZAP_RECOVERY_PERCENTAGE_MAX}
              disabled={!supportsTzapRecovery}
              value={
                supportsTzapRecovery
                  ? (defaults.tzapRecoveryPercentage ??
                    TZAP_RECOVERY_PERCENTAGE_DEFAULT)
                  : ""
              }
              onChange={(event) =>
                patchCreateDefaults(actions, selectedCreateFormat, {
                  tzapRecoveryPercentage: optionalNumber(
                    event.currentTarget.value,
                  ),
                })
              }
            />
          </div>
        </div>
        <div
          className={SETTING_ROW_CLASS}
          hidden={!capabilities.zipCompression}
        >
          <label htmlFor="pref-create-zip-compression">
            {i18n.t("create.zipCompression")}
          </label>
          <div className={SETTING_CONTROL_CLASS}>
            <Select
              value={defaults.zipCompression ?? "deflate"}
              onValueChange={(value) =>
                patchCreateDefaults(actions, selectedCreateFormat, {
                  zipCompression: value as "store" | "deflate",
                })
              }
            >
              <SelectTrigger id="pref-create-zip-compression">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="deflate">Deflate</SelectItem>
                <SelectItem value="store">{i18n.t("common.store")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div
          className={SETTING_ROW_CLASS}
          hidden={!capabilities.tzapVolumeLossTolerance}
        >
          <label htmlFor="pref-create-tzap-volume-tolerance">
            {i18n.t("create.tzapVolumeLossTolerance")}
          </label>
          <div className={SETTING_CONTROL_CLASS}>
            <input
              id="pref-create-tzap-volume-tolerance"
              type="number"
              min="0"
              max="16"
              disabled={!defaults.volumeSize}
              value={
                defaults.volumeSize
                  ? (defaults.tzapVolumeLossTolerance ?? 1)
                  : 0
              }
              onChange={(event) =>
                patchCreateDefaults(actions, selectedCreateFormat, {
                  tzapVolumeLossTolerance:
                    optionalNumber(event.currentTarget.value) ?? 0,
                })
              }
            />
          </div>
        </div>
        <div
          className={SETTING_ROW_CLASS}
          hidden={!capabilities.sevenZAdvanced}
        >
          <label htmlFor="pref-create-7z-threads">
            {i18n.t("create.sevenZThreads")}
          </label>
          <div className={SETTING_CONTROL_CLASS}>
            <input
              id="pref-create-7z-threads"
              type="number"
              min="1"
              max="256"
              placeholder={i18n.t("preferences.archiveDefaults.backendDefault")}
              value={defaults.sevenZThreads ?? ""}
              onChange={(event) =>
                patchCreateDefaults(actions, selectedCreateFormat, {
                  sevenZThreads: optionalPositiveNumber(
                    event.currentTarget.value,
                  ),
                })
              }
            />
          </div>
        </div>
      </div>
      <VolumeSizePresetEditor draft={draft} />
      {selectedCreateFormat === "tzap" ? (
        <section className="mt-4 rounded-xl border border-black/10 bg-black/[0.025] p-4 dark:border-white/10 dark:bg-white/[0.035]">
          <h4 className="text-xs font-semibold">
            {i18n.t("preferences.archiveDefaults.signingIdentity")}
          </h4>
          <div className="mt-2 max-w-xl space-y-2">
            <Select
              value={selectedTzapSigningDefault}
              onValueChange={(value) => {
                if (value === "accountDefault" || value === "none") {
                  patchCreateDefaults(actions, selectedCreateFormat, {
                    tzapSigningDefault: value,
                    tzapDefaultSigningIdentityId: null,
                  });
                  return;
                }
                if (value.startsWith("identity:")) {
                  patchCreateDefaults(actions, selectedCreateFormat, {
                    tzapSigningDefault: "identity",
                    tzapDefaultSigningIdentityId: value.slice("identity:".length),
                  });
                }
              }}
            >
              <SelectTrigger id="pref-create-tzap-signing-default">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="accountDefault">
                  {i18n.t("preferences.archiveDefaults.signingAccountDefault")}
                </SelectItem>
                <SelectItem value="none">
                  {i18n.t("preferences.archiveDefaults.signingNone")}
                </SelectItem>
                {activeSigningIdentities.map((certificate) => (
                  <SelectItem
                    key={certificate.identityId}
                    value={`identity:${certificate.identityId}`}
                  >
                    {certificate.label || certificate.certificateId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs opacity-65">
              {i18n.t("preferences.archiveDefaults.signingIdentityHelp")}
            </p>
          </div>
        </section>
      ) : null}
      <div className="mt-5 grid grid-cols-2 gap-2 rounded-xl border border-black/10 bg-black/[0.025] p-3 dark:border-white/10 dark:bg-white/[0.035]">
        <PreferenceCheckbox
          id="pref-create-clean-source"
          label={i18n.t("create.cleanSource")}
          tooltip={i18n.t("create.cleanSource.tooltip")}
          checked={defaults.cleanSource}
          onChange={(checked) =>
            patchCreateDefaults(actions, selectedCreateFormat, {
              cleanSource: checked,
            })
          }
        />
        <PreferenceCheckbox
          id="pref-create-respect-gitignore"
          label={i18n.t("create.respectGitignore")}
          tooltip={i18n.t("create.respectGitignore.tooltip")}
          checked={Boolean(defaults.respectGitignore)}
          onChange={(checked) =>
            patchCreateDefaults(actions, selectedCreateFormat, {
              respectGitignore: checked,
            })
          }
        />
        <PreferenceCheckbox
          id="pref-create-follow-symlinks"
          label={i18n.t("create.followSymlinks")}
          tooltip={i18n.t("create.followSymlinks.tooltip")}
          checked={Boolean(defaults.followSymlinks)}
          onChange={(checked) =>
            patchCreateDefaults(actions, selectedCreateFormat, {
              followSymlinks: checked,
            })
          }
        />
        <PreferenceCheckbox
          id="pref-create-preserve-metadata"
          label={i18n.t("create.preserveMetadata")}
          tooltip={i18n.t(
            `create.preserveMetadata.${selectedCreateFormat}.tooltip`,
          )}
          checked={defaults.preserveMetadata}
          onChange={(checked) =>
            patchCreateDefaults(actions, selectedCreateFormat, {
              preserveMetadata: checked,
            })
          }
        />
        <PreferenceCheckbox
          id="pref-create-replace-existing"
          label={i18n.t("create.replaceExisting")}
          tooltip={i18n.t("create.replaceExisting.tooltip")}
          checked={defaults.replaceExisting}
          onChange={(checked) =>
            patchCreateDefaults(actions, selectedCreateFormat, {
              replaceExisting: checked,
            })
          }
        />
        <PreferenceCheckbox
          id="pref-create-prompt-password"
          label={i18n.t("create.promptForPassword")}
          tooltip={i18n.t("create.promptForPassword.tooltip")}
          checked={supportsPassword && defaults.promptForPassword}
          disabled={!supportsPassword}
          onChange={(checked) =>
            patchCreateDefaults(actions, selectedCreateFormat, {
              promptForPassword: checked,
            })
          }
        />
        {capabilities.sevenZAdvanced ? (
          <PreferenceCheckbox
            id="pref-create-7z-solid"
            label={i18n.t("create.sevenZSolid")}
            tooltip={i18n.t("create.sevenZSolid.tooltip")}
            checked={defaults.sevenZSolid ?? true}
            onChange={(checked) =>
              patchCreateDefaults(actions, selectedCreateFormat, {
                sevenZSolid: checked,
              })
            }
          />
        ) : null}
        {capabilities.sevenZAdvanced ? (
          <PreferenceCheckbox
            id="pref-create-7z-encrypt-names"
            label={i18n.t("create.sevenZEncryptFileNames")}
            tooltip={i18n.t("create.sevenZEncryptFileNames.tooltip")}
            checked={defaults.sevenZEncryptFileNames ?? true}
            onChange={(checked) =>
              patchCreateDefaults(actions, selectedCreateFormat, {
                sevenZEncryptFileNames: checked,
              })
            }
          />
        ) : null}
      </div>
      <p className={`${SETTING_DESCRIPTION_CLASS} mt-2`}>
        <span className={QUICK_BADGE_CLASS}>
          {i18n.t("preferences.quickActions.badge")}
        </span>{" "}
        <span>{i18n.t("preferences.safety.quickDescription")}</span>
      </p>
    </section>
  );
}

function VolumeSizePresetEditor({
  draft,
}: Readonly<{ draft: AppPreferences }>) {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();
  const i18n = translatorForSnapshot(snapshot);
  const canonical = formatVolumeSizePresetList(draft.volumeSizePresets);
  const [value, setValue] = useState(canonical);
  const parsed = parseVolumeSizePresetList(value);

  useEffect(() => setValue(canonical), [canonical]);

  const commit = () => {
    if (parsed) {
      actions.handleDialogIntent({
        type: "preferencesPatch",
        patch: { volumeSizePresets: parsed },
      });
    } else {
      setValue(canonical);
    }
  };

  return (
    <div className="mt-4 rounded-xl border border-black/10 bg-black/[0.025] p-3 dark:border-white/10 dark:bg-white/[0.035]">
      <label
        className="mb-2 block text-xs font-semibold"
        htmlFor="pref-volume-size-presets"
      >
        {i18n.t("preferences.archiveDefaults.volumeChoices")}
      </label>
      <input
        id="pref-volume-size-presets"
        className="w-full"
        type="text"
        value={value}
        aria-invalid={parsed === null}
        onChange={(event) => setValue(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
      />
      <p className="mt-2 text-xs opacity-70">
        {i18n.t("preferences.archiveDefaults.volumeChoicesHelp")}
      </p>
    </div>
  );
}

function ExtractionPage({
  draft,
  active,
}: Readonly<{ draft: AppPreferences; active: boolean }>) {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();
  const i18n = translatorForSnapshot(snapshot);
  return (
    <section
      className={PREFERENCE_PAGE_CLASS}
      data-pref-page="extraction"
      hidden={!active}
    >
      <h3>{i18n.t("preferences.extraction.title")}</h3>
      <p className={DESCRIPTION_CLASS}>
        {i18n.t("preferences.extraction.description")}
      </p>
      <div className={SETTING_ROW_CLASS}>
        <label htmlFor="pref-default-extraction">
          {i18n.t("preferences.archiveDefaults.defaultExtraction")}
        </label>
        <div className={SETTING_CONTROL_CLASS}>
          <Select
            value={draft.defaultExtractionBehavior}
            onValueChange={(value) =>
              actions.handleDialogIntent({
                type: "preferencesPatch",
                patch: {
                  defaultExtractionBehavior: value as AppPreferences["defaultExtractionBehavior"],
                },
              })
            }
          >
            <SelectTrigger id="pref-default-extraction">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="askEveryTime">
                {i18n.t("preferences.extraction.askEveryTime")}
              </SelectItem>
              <SelectItem value="extractHere">
                {i18n.t("preferences.extraction.extractHere")}
              </SelectItem>
              <SelectItem value="extractToFolder">
                {i18n.t("preferences.extraction.extractToFolder")}
              </SelectItem>
            </SelectContent>
          </Select>
          <p className={SETTING_DESCRIPTION_CLASS}>
            <span className={QUICK_BADGE_CLASS}>
              {i18n.t("preferences.quickActions.badge")}
            </span>{" "}
            <span>{i18n.t("preferences.extraction.quickDescription")}</span>
          </p>
        </div>
      </div>
      <div className={SETTING_GRID_CLASS}>
        <div className={SETTING_ROW_CLASS}>
          <label htmlFor="pref-extract-path-mode" className="flex items-center gap-1">
            {i18n.t("extract.pathMode")}
            <InfoTip content={i18n.t("extract.pathMode.tooltip")} />
          </label>
          <div className={SETTING_CONTROL_CLASS}>
            <Select
              value={draft.defaultExtractPathMode}
              onValueChange={(value) =>
                actions.handleDialogIntent({
                  type: "preferencesPatch",
                  patch: {
                    defaultExtractPathMode: value as AppPreferences["defaultExtractPathMode"],
                  },
                })
              }
            >
              <SelectTrigger id="pref-extract-path-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full">{i18n.t("extract.pathMode.full")}</SelectItem>
                <SelectItem value="current">
                  {i18n.t("extract.pathMode.current")}
                </SelectItem>
                <SelectItem value="none">{i18n.t("extract.pathMode.none")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className={SETTING_ROW_CLASS}>
          <label htmlFor="pref-extract-overwrite" className="flex items-center gap-1">
            {i18n.t("extract.overwritePolicy")}
            <InfoTip content={i18n.t("extract.overwritePolicy.tooltip")} />
          </label>
          <div className={SETTING_CONTROL_CLASS}>
            <Select
              value={draft.defaultExtractOverwrite}
              onValueChange={(value) =>
                actions.handleDialogIntent({
                  type: "preferencesPatch",
                  patch: {
                    defaultExtractOverwrite: value as AppPreferences["defaultExtractOverwrite"],
                  },
                })
              }
            >
              <SelectTrigger id="pref-extract-overwrite">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="refuse">
                  {i18n.t("extract.overwrite.refuse")}
                </SelectItem>
                <SelectItem value="ask">
                  {i18n.t("extract.overwrite.ask")}
                </SelectItem>
                <SelectItem value="rename">
                  {i18n.t("extract.overwrite.rename")}
                </SelectItem>
                <SelectItem value="replace">
                  {i18n.t("extract.overwrite.replace")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className={SETTING_ROW_CLASS}>
          <label htmlFor="pref-extract-strip-components" className="flex items-center gap-1">
            {i18n.t("extract.stripComponents")}
            <InfoTip content={i18n.t("extract.stripComponents.tooltip")} />
          </label>
          <div className={SETTING_CONTROL_CLASS}>
            <input
              id="pref-extract-strip-components"
              type="number"
              min="0"
              value={draft.defaultExtractStripComponents}
              onChange={(event) =>
                actions.handleDialogIntent({
                  type: "preferencesPatch",
                  patch: {
                    defaultExtractStripComponents: Math.max(
                      0,
                      Number.parseInt(event.currentTarget.value, 10) || 0,
                    ),
                  },
                })
              }
            />
          </div>
        </div>
      </div>
      <PreferenceCheckbox
        id="pref-extract-deduplicate-root"
        label={i18n.t("extract.deduplicateRoot")}
        tooltip={i18n.t("extract.deduplicateRoot.tooltip")}
        checked={draft.defaultExtractDeduplicateRoot}
        onChange={(checked) =>
          actions.handleDialogIntent({
            type: "preferencesPatch",
            patch: { defaultExtractDeduplicateRoot: checked },
          })
        }
      />
      <div className="mt-4 grid gap-3 rounded-xl border border-blue-500/20 bg-blue-500/[0.04] p-4">
        <div>
          <h4 className="text-xs font-semibold">
            {i18n.t("preferences.extraction.tzapMetadata")}
          </h4>
          <p className="mt-1 text-xs leading-5 opacity-70">
            {i18n.t("preferences.extraction.tzapMetadata.help")}
          </p>
        </div>
        <label className="grid gap-1.5 text-xs font-semibold">
          <span className="inline-flex items-center gap-1">
            {i18n.t("extract.tzapRestorePolicy")}
            <InfoTip content={i18n.t("extract.tzapRestorePolicy.tooltip")} />
          </span>
          <Select
            value={draft.defaultTzapRestorePolicy}
            onValueChange={(value) =>
              actions.handleDialogIntent({
                type: "preferencesPatch",
                patch: {
                  defaultTzapRestorePolicy:
                    value as AppPreferences["defaultTzapRestorePolicy"],
                  ...(value === "content" || value === "portable"
                    ? { defaultTzapAllowDegraded: false }
                    : {}),
                },
              })
            }
          >
            <SelectTrigger id="pref-tzap-restore-policy">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="content">
                {i18n.t("extract.tzapRestorePolicy.content")}
              </SelectItem>
              <SelectItem value="portable">
                {i18n.t("extract.tzapRestorePolicy.portable")}
              </SelectItem>
              <SelectItem value="sameOs">
                {i18n.t("extract.tzapRestorePolicy.sameOs")}
              </SelectItem>
              <SelectItem value="system">
                {i18n.t("extract.tzapRestorePolicy.system")}
              </SelectItem>
            </SelectContent>
          </Select>
          <span className="text-[11px] font-normal leading-4 opacity-70">
            {i18n.t(
              `extract.tzapRestorePolicy.${draft.defaultTzapRestorePolicy}.help`,
            )}
          </span>
        </label>
        <label className="flex items-start gap-2 text-xs font-medium">
          <Checkbox
            id="pref-tzap-allow-degraded"
            checked={draft.defaultTzapAllowDegraded}
            disabled={
              draft.defaultTzapRestorePolicy === "content" ||
              draft.defaultTzapRestorePolicy === "portable"
            }
            onCheckedChange={(checked) =>
              actions.handleDialogIntent({
                type: "preferencesPatch",
                patch: { defaultTzapAllowDegraded: checked === true },
              })
            }
          />
          <span className="inline-flex items-center gap-1">
            <span>{i18n.t("extract.tzapAllowDegraded")}</span>
            <InfoTip content={i18n.t("extract.tzapAllowDegraded.tooltip")} />
          </span>
        </label>
      </div>
    </section>
  );
}

function InterfacePage({
  draft,
  active,
}: Readonly<{ draft: AppPreferences; active: boolean }>) {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();
  const i18n = translatorForSnapshot(snapshot);
  return (
    <section
      className={PREFERENCE_PAGE_CLASS}
      data-pref-page="interface"
      hidden={!active}
    >
      <h3>{i18n.t("preferences.interface.title")}</h3>
      <p className={DESCRIPTION_CLASS}>
        {i18n.t("preferences.interface.description")}
      </p>
      <div className={TOGGLE_GRID_CLASS}>
        <PreferenceCheckbox
          id="pref-show-parent"
          label={i18n.t("preferences.interface.showParent")}
          checked={draft.showParentFolderItem}
          onChange={(checked) =>
            actions.handleDialogIntent({
              type: "preferencesPatch",
              patch: { showParentFolderItem: checked },
            })
          }
        />
        <PreferenceCheckbox
          id="pref-real-file-icons"
          label={i18n.t("preferences.interface.realFileIcons")}
          checked={draft.showRealFileIcons}
          onChange={(checked) =>
            actions.handleDialogIntent({
              type: "preferencesPatch",
              patch: { showRealFileIcons: checked },
            })
          }
        />
        <PreferenceCheckbox
          id="pref-full-row-select"
          label={i18n.t("preferences.interface.fullRowSelect")}
          checked={draft.fullRowSelect}
          onChange={(checked) =>
            actions.handleDialogIntent({
              type: "preferencesPatch",
              patch: { fullRowSelect: checked },
            })
          }
        />
        <PreferenceCheckbox
          id="pref-show-grid"
          label={i18n.t("preferences.interface.showGrid")}
          checked={draft.showGridLines}
          onChange={(checked) =>
            actions.handleDialogIntent({
              type: "preferencesPatch",
              patch: { showGridLines: checked },
            })
          }
        />
        <PreferenceCheckbox
          id="pref-single-click"
          label={i18n.t("preferences.interface.singleClick")}
          checked={draft.singleClickOpen}
          onChange={(checked) =>
            actions.handleDialogIntent({
              type: "preferencesPatch",
              patch: { singleClickOpen: checked },
            })
          }
        />
        <PreferenceCheckbox
          id="pref-alternative-selection"
          label={i18n.t("preferences.interface.alternativeSelection")}
          checked={draft.alternativeSelectionMode}
          onChange={(checked) =>
            actions.handleDialogIntent({
              type: "preferencesPatch",
              patch: { alternativeSelectionMode: checked },
            })
          }
        />
        <PreferenceCheckbox
          id="pref-toolbar-labels"
          label={i18n.t("preferences.interface.toolbarLabels")}
          checked={draft.showToolbarLabels}
          onChange={(checked) =>
            actions.handleDialogIntent({
              type: "preferencesPatch",
              patch: { showToolbarLabels: checked },
            })
          }
        />
        <PreferenceCheckbox
          id="pref-flat-view"
          label={i18n.t("preferences.interface.flatView")}
          checked={draft.flatViewDefault}
          onChange={(checked) =>
            actions.handleDialogIntent({
              type: "preferencesPatch",
              patch: { flatViewDefault: checked },
            })
          }
        />
      </div>
      <div className={SETTING_ROW_CLASS}>
        <label htmlFor="pref-language">
          {i18n.t("preferences.language.title")}
        </label>
        <div className={SETTING_CONTROL_CLASS}>
          <Select
            value={draft.locale}
            onValueChange={(value) =>
              actions.handleDialogIntent({
                type: "preferencesPatch",
                patch: {
                  locale: value as AppPreferences["locale"],
                },
              })
            }
          >
            <SelectTrigger id="pref-language">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">
                {i18n.t("preferences.language.systemDefault")}
              </SelectItem>
              <SelectItem value="en">{i18n.t("preferences.language.english")}</SelectItem>
              <SelectItem value="zh-CN">
                {i18n.t("preferences.language.chineseSimplified")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </section>
  );
}

function LanSharingPage({
  draft,
  active,
}: Readonly<{ draft: AppPreferences; active: boolean }>) {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();
  const i18n = translatorForSnapshot(snapshot);
  const trustedDevices = snapshot.localSendTrustedDevices;

  return (
    <section
      className={PREFERENCE_PAGE_CLASS}
      data-pref-page="lanSharing"
      hidden={!active}
    >
      <h3>{i18n.t("preferences.lanSharing.title")}</h3>
      <p className={DESCRIPTION_CLASS}>
        {i18n.t("preferences.lanSharing.description")}
      </p>
      <div className={SETTING_ROW_CLASS}>
        <label htmlFor="pref-lan-share-alias">
          {i18n.t("preferences.lanSharing.alias")}
        </label>
        <div className={SETTING_CONTROL_CLASS}>
          <input
            id="pref-lan-share-alias"
            className="path-input"
            type="text"
            placeholder={i18n.t("preferences.lanSharing.aliasPlaceholder")}
            value={draft.lanShareAlias}
            onChange={(event) =>
              actions.handleDialogIntent({
                type: "preferencesPatch",
                patch: { lanShareAlias: event.currentTarget.value },
              })
            }
          />
          <p className={SETTING_DESCRIPTION_CLASS}>
            {i18n.t("preferences.lanSharing.aliasHelp")}
          </p>
        </div>
      </div>
      <div className={TOGGLE_GRID_CLASS}>
        <PreferenceCheckbox
          id="pref-lan-share-enable-receiving"
          label={i18n.t("preferences.lanSharing.enableReceiving")}
          tooltip={i18n.t("preferences.lanSharing.enableReceivingHelp")}
          checked={draft.lanShareEnableReceiving}
          onChange={(checked) =>
            actions.handleDialogIntent({
              type: "preferencesPatch",
              patch: { lanShareEnableReceiving: checked },
            })
          }
        />
        <PreferenceCheckbox
          id="pref-lan-share-auto-extract"
          label={i18n.t("preferences.lanSharing.autoExtract")}
          tooltip={i18n.t("preferences.lanSharing.autoExtractHelp")}
          checked={draft.lanShareAutoExtract}
          disabled={!draft.lanShareEnableReceiving}
          onChange={(checked) =>
            actions.handleDialogIntent({
              type: "preferencesPatch",
              patch: { lanShareAutoExtract: checked },
            })
          }
        />
      </div>
      <div className={SETTING_ROW_CLASS}>
        <label htmlFor="pref-lan-share-receive-folder">
          {i18n.t("preferences.lanSharing.receiveFolder")}
        </label>
        <div className={SETTING_CONTROL_CLASS}>
          <div className={INLINE_FIELD_CLASS}>
            <input
              id="pref-lan-share-receive-folder"
              className="path-input"
              type="text"
              placeholder={i18n.t("preferences.lanSharing.receiveFolderPlaceholder")}
              value={draft.lanShareReceiveFolderPath}
              disabled={!draft.lanShareEnableReceiving}
              onChange={(event) =>
                actions.handleDialogIntent({
                  type: "preferencesPatch",
                  patch: { lanShareReceiveFolderPath: event.currentTarget.value },
                })
              }
            />
            <Button
              id="pref-choose-lan-share-receive-folder"
              type="button"
              variant="dialog"
              size="unset"
              disabled={!draft.lanShareEnableReceiving}
              onClick={() =>
                actions.handleDialogIntent({
                  type: "preferencesChooseLanShareReceiveFolder",
                })
              }
            >
              {i18n.t("common.browse")}
            </Button>
          </div>
          <p className={SETTING_DESCRIPTION_CLASS}>
            {i18n.t("preferences.lanSharing.receiveFolderHelp")}
          </p>
        </div>
      </div>
      <div className={SETTING_ROW_CLASS}>
        <label>{i18n.t("preferences.lanSharing.trustedDevices")}</label>
        <div className={SETTING_CONTROL_CLASS}>
          <p className={SETTING_DESCRIPTION_CLASS}>
            {i18n.t("preferences.lanSharing.trustedDevicesHelp")}
          </p>
          {trustedDevices.status === "error" ? (
            <div className={SETTING_DESCRIPTION_CLASS}>
              <p role="alert">
                {trustedDevices.error ?? i18n.t("preferences.lanSharing.trustedDevicesLoadFailed")}
              </p>
              <Button
                type="button"
                variant="dialog"
                size="unset"
                onClick={() =>
                  actions.handleDialogIntent({ type: "localSendTrustRefresh" })
                }
              >
                {i18n.t("common.refresh")}
              </Button>
            </div>
          ) : trustedDevices.status !== "loading" && trustedDevices.fingerprints.length === 0 ? (
            <p className={SETTING_DESCRIPTION_CLASS}>
              {i18n.t("preferences.lanSharing.trustedDevicesEmpty")}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {trustedDevices.fingerprints.map((fingerprint) => (
                <li
                  key={fingerprint}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900/70"
                >
                  <span className="min-w-0 truncate font-mono" title={fingerprint}>
                    {fingerprint}
                  </span>
                  <Button
                    type="button"
                    variant="dialog"
                    size="unset"
                    disabled={trustedDevices.status === "loading"}
                    onClick={() =>
                      actions.handleDialogIntent({
                        type: "localSendTrustForget",
                        fingerprint,
                      })
                    }
                  >
                    {i18n.t("common.remove")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function SafetyPage({
  draft,
  active,
}: Readonly<{
  draft: AppPreferences;
  active: boolean;
}>) {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();
  const i18n = translatorForSnapshot(snapshot);

  return (
    <section
      className={PREFERENCE_PAGE_CLASS}
      data-pref-page="safety"
      hidden={!active}
    >
      <h3>{i18n.t("preferences.safety.title")}</h3>
      <p className={DESCRIPTION_CLASS}>
        {i18n.t("preferences.safety.description")}
      </p>
      <div className={SETTING_ROW_CLASS}>
        <label htmlFor="pref-preview-cleanup">
          {i18n.t("preferences.archiveDefaults.previewCleanup")}
        </label>
        <div className={SETTING_CONTROL_CLASS}>
          <Select
            value={draft.previewCleanupPolicy}
            onValueChange={(value) =>
              actions.handleDialogIntent({
                type: "preferencesPatch",
                patch: {
                  previewCleanupPolicy: value as AppPreferences["previewCleanupPolicy"],
                },
              })
            }
          >
            <SelectTrigger id="pref-preview-cleanup">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="beforeNextPreview">
                {i18n.t("preferences.previewCleanup.beforeNextPreview")}
              </SelectItem>
              <SelectItem value="whenAppCloses">
                {i18n.t("preferences.previewCleanup.whenAppCloses")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {snapshot.defaultHandlers.status !== "idle" ? (
        <div className={SETTING_ROW_CLASS} data-default-handler-settings>
          <label>{i18n.t("preferences.defaultHandlers.title")}</label>
          <div className={SETTING_CONTROL_CLASS}>
            <p className={SETTING_DESCRIPTION_CLASS}>
              {snapshot.defaultHandlers.error ??
                i18n.t("preferences.defaultHandlers.status", {
                  current: snapshot.defaultHandlers.entries.filter(
                    (entry) => entry.isCurrentApplication,
                  ).length,
                  total: snapshot.defaultHandlers.entries.length,
                })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="dialogPrimary"
                size="unset"
                disabled={snapshot.defaultHandlers.status === "loading"}
                onClick={() =>
                  actions.handleDialogIntent({ type: "defaultHandlersSet" })
                }
              >
                {i18n.t("preferences.defaultHandlers.set")}
              </Button>
              <Button
                type="button"
                variant="dialog"
                size="unset"
                disabled={
                  !snapshot.defaultHandlers.canRestore ||
                  snapshot.defaultHandlers.status === "loading"
                }
                onClick={() =>
                  actions.handleDialogIntent({ type: "defaultHandlersRestore" })
                }
              >
                {i18n.t("preferences.defaultHandlers.restore")}
              </Button>
              <Button
                type="button"
                variant="dialog"
                size="unset"
                disabled={snapshot.defaultHandlers.status === "loading"}
                onClick={() =>
                  actions.handleDialogIntent({ type: "defaultHandlersRefresh" })
                }
              >
                {i18n.t("common.refresh")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function PreferenceCheckbox({
  id,
  label,
  tooltip,
  checked,
  disabled = false,
  onChange,
}: Readonly<{
  id: string;
  label: string;
  tooltip?: string;
  checked: boolean;
  disabled?: boolean;
  onChange(checked: boolean): void;
}>) {
  return (
    <label className={TOGGLE_LINE_CLASS}>
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(c) => onChange(c === true)}
      />{" "}
      <span className="flex items-center gap-1">
        {label}
        <InfoTip content={tooltip} />
      </span>
    </label>
  );
}

function FormatSelect({
  id,
  value,
  onChange,
  isMacOs,
}: Readonly<{
  id: string;
  value: CreateFormat;
  onChange(format: CreateFormat): void;
  isMacOs: boolean;
}>) {
  return (
    <Select
      value={value}
      onValueChange={(newValue) => onChange(newValue as CreateFormat)}
    >
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {supportedCreateFormats(isMacOs).map((format) => (
          <SelectItem key={format} value={format}>
            {FORMAT_LABELS[format]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function patchCreateDefaults(
  actions: ReturnType<typeof useZManagerActions>,
  format: CreateFormat,
  patch: Partial<FormatCreateDefaults>,
): void {
  actions.handleDialogIntent({
    type: "preferencesCreateDefaultsPatch",
    format,
    patch,
  });
}

function optionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function optionalPositiveNumber(value: string): number | null {
  const parsed = optionalNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

const CUSTOM_OUTPUT_TRUNCATE_LENGTH = 40;
const CUSTOM_OUTPUT_TRUNCATE_HEAD = 21;
const CUSTOM_OUTPUT_TRUNCATE_TAIL = 13;

function middleTruncatePath(value: string): string {
  return value.length <= CUSTOM_OUTPUT_TRUNCATE_LENGTH
    ? value
    : `${value.slice(0, CUSTOM_OUTPUT_TRUNCATE_HEAD)}...${value.slice(-CUSTOM_OUTPUT_TRUNCATE_TAIL)}`;
}

function ColumnsPage({
  active,
}: Readonly<{
  draft: AppPreferences;
  active: boolean;
}>) {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();
  const i18n = translatorForSnapshot(snapshot);
  const visibility = snapshot.columnVisibilityDraft;

  if (!visibility) {
    return (
      <section
        className={PREFERENCE_PAGE_CLASS}
        data-pref-page="columns"
        hidden={!active}
      >
        <h3>Columns</h3>
        <p className={DESCRIPTION_CLASS}>Loading column preferences...</p>
      </section>
    );
  }

  return (
    <section
      className={PREFERENCE_PAGE_CLASS}
      data-pref-page="columns"
      hidden={!active}
    >
      <h3>Columns</h3>
      <p className={DESCRIPTION_CLASS}>
        Choose which columns are visible in Compress and Extract tables.
        Per-format overrides apply only to Extract tables for that archive type.
      </p>
      <GroupedColumnPreferences
        visibility={visibility}
        i18n={i18n}
        onChange={(newVisibility) => {
          actions.handleDialogIntent({
            type: "columnVisibilityPatch",
            visibility: newVisibility,
          });
        }}
      />
    </section>
  );
}
function AdvancedPage({
  draft,
  active,
}: {
  draft: AppPreferences;
  active: boolean;
}) {
  const actions = useZManagerActions();
  const isOfficialRelease = !import.meta.env.DEV;
  const fixedEnvironment = FIXED_TZAP_BUILD_ENVIRONMENT;

  return (
    <div className={PREFERENCE_PAGE_CLASS} hidden={!active}>
      <h3>Advanced</h3>
      <p className={DESCRIPTION_CLASS}>
        Developer settings and experimental features.
      </p>

      <section className="mt-6 space-y-4">
        <div className={SETTING_ROW_CLASS}>
          <label>TZAP Server Environment</label>
          <div className={SETTING_CONTROL_CLASS}>
            {fixedEnvironment || isOfficialRelease ? (
              <p className={SETTING_DESCRIPTION_CLASS}>
                {(fixedEnvironment ?? "prod") === "staging" ? "Staging" : "Production"}
              </p>
            ) : (
              <>
                <Select
                  value={draft.tzapEnvironment}
                  onValueChange={(val: "prod" | "staging") => {
                    actions.handleDialogIntent({
                      type: "preferencesPatch",
                      patch: { tzapEnvironment: val },
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="prod">Production</SelectItem>
                    <SelectItem value="staging">Staging</SelectItem>
                  </SelectContent>
                </Select>
                <p className={SETTING_DESCRIPTION_CLASS}>
                  Controls which backend environment the application connects to for TZAP hosted features.
                </p>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
