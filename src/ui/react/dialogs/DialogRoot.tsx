import { useEffect, useRef, useState } from "react";
import { ChevronDown, FolderOutput, SlidersHorizontal, X } from "lucide-react";

import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { InfoTip } from "../../components/ui/info-tip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { useZManagerActions, useZManagerSnapshot } from "../AppProviders";
import type { ZManagerDialogSnapshot } from "../appRuntime";
import { PreferencesDialog } from "../preferences/PreferencesDialog";
import { translatorForSnapshot } from "../shell/shellHelpers";
import { DesktopDialog } from "./DesktopDialog";
import { SetupDialog } from "./SetupDialog";

export function DialogRoot() {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();

  useDialogFocusRestoration(
    snapshot.dialog,
    snapshot.archive.view.selection.focusedPath,
  );

  if (snapshot.preferencesDraft) {
    return <PreferencesDialog />;
  }

  if (snapshot.dialog.kind === "none") {
    return null;
  }

  if (snapshot.dialog.kind === "extract") {
    return <ExtractDialog dialog={snapshot.dialog} />;
  }

  if (snapshot.dialog.kind === "info") {
    return <InfoDialog dialog={snapshot.dialog} />;
  }

  if (snapshot.dialog.kind === "about") {
    return <AboutDialog dialog={snapshot.dialog} />;
  }

  if (snapshot.dialog.kind === "setup") {
    return <SetupDialog dialog={snapshot.dialog} />;
  }

  return null;
}

function useDialogFocusRestoration(
  dialog: ZManagerDialogSnapshot,
  archiveFocusedPath: string,
) {
  const previousDialogRef = useRef<ZManagerDialogSnapshot>({ kind: "none" });
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const previousDialog = previousDialogRef.current;
    if (previousDialog.kind === "none" && dialog.kind !== "none") {
      const activeElement = document.activeElement;
      returnFocusRef.current =
        activeElement instanceof HTMLElement
          ? dialogReturnFocusElement(activeElement)
          : null;
    }

    if (previousDialog.kind !== "none" && dialog.kind === "none") {
      const returnFocusTarget = returnFocusRef.current;
      returnFocusRef.current = null;
      window.requestAnimationFrame(() => {
        const fallbackTarget = focusTargetForClosedDialog(
          previousDialog,
          archiveFocusedPath,
        );
        const target =
          previousDialog.kind === "info"
            ? (fallbackTarget ?? focusableConnectedElement(returnFocusTarget))
            : (focusableConnectedElement(returnFocusTarget) ?? fallbackTarget);
        target?.focus();
      });
    }

    previousDialogRef.current = dialog;
  }, [archiveFocusedPath, dialog]);
}

function focusableConnectedElement(
  element: HTMLElement | null,
): HTMLElement | null {
  return dialogReturnFocusElement(element);
}

function dialogReturnFocusElement(
  element: HTMLElement | null,
): HTMLElement | null {
  if (!element?.isConnected) {
    return null;
  }

  if (element.closest("[hidden], #context-menu, details:not([open])")) {
    return null;
  }

  return element;
}

function focusTargetForClosedDialog(
  dialog: ZManagerDialogSnapshot,
  archiveFocusedPath: string,
): HTMLElement | null {
  if (dialog.kind === "info") {
    return (
      archiveRowElement(dialog.returnFocusPath) ??
      document.querySelector<HTMLElement>("#info-toolbar")
    );
  }

  if (dialog.kind === "extract") {
    return (
      archiveRowElement(archiveFocusedPath) ??
      document.querySelector<HTMLElement>("#extract-all")
    );
  }

  return null;
}

function archiveRowElement(path: string): HTMLElement | null {
  if (!path) {
    return null;
  }

  return document.querySelector<HTMLElement>(
    `tr[data-entry-path="${CSS.escape(path)}"]`,
  );
}

function InfoDialog({
  dialog,
}: Readonly<{ dialog: Extract<ZManagerDialogSnapshot, { kind: "info" }> }>) {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();
  const i18n = translatorForSnapshot(snapshot);

  return (
    <DesktopDialog
      titleId="info-title"
      descriptionId="info-description"
      header={
        <div className="flex items-start justify-between gap-5 border-b border-slate-200 px-6 py-5 dark:border-slate-800">
          <div>
            <h2 id="info-title">{dialog.title}</h2>
            <p id="info-description">{dialog.description}</p>
          </div>
        </div>
      }
      content={
        <div className="bg-slate-50/40 px-6 py-5 dark:bg-slate-950">
          <div id="info-dialog-body" className="grid gap-3">
            <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <h3>{dialog.sectionTitle}</h3>
              <dl className="grid gap-1 text-xs [&>div]:grid [&>div]:grid-cols-[minmax(100px,34%)_minmax(0,1fr)] [&>div]:gap-2 [&_dt]:text-slate-500 dark:[&_dt]:text-slate-400">
                {dialog.rows.map((row) => (
                  <div key={`${row.label}:${row.value}`}>
                    <dt>{row.label}</dt>
                    <dd
                      className="min-w-0"
                      title={row.value}
                      aria-label={`${row.label}: ${row.value}`}
                    >
                      <span
                        className={`${(row.mode ?? detailValueMode(row.value)) === "middle" ? "block truncate font-mono" : "block break-words"}`}
                      >
                        {(row.mode ?? detailValueMode(row.value)) === "middle"
                          ? middleTruncateDetailValue(row.value)
                          : row.value}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        </div>
      }
      footer={
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-950">
          <div id="info-action-group" className="flex flex-wrap gap-2">
            {dialog.actions.map((action) => (
              <Button
                type="button"
                variant={action.primary ? "dialogPrimary" : "dialog"}
                size="unset"
                title={action.title}
                aria-label={
                  action.title ? `${action.label}: ${action.title}` : undefined
                }
                onClick={() =>
                  actions.handleDialogIntent({
                    type: "infoAction",
                    action: action.action,
                    copyValue: action.copyValue,
                  })
                }
                key={`${action.label}:${action.action ?? action.copyValue ?? ""}`}
              >
                {action.label}
              </Button>
            ))}
          </div>
          <Button
            id="info-close"
            type="button"
            variant="dialog"
            size="unset"
            onClick={() => actions.handleDialogIntent({ type: "closeCurrent" })}
          >
            {i18n.t("common.close")}
          </Button>
        </div>
      }
      onEscape={() => actions.handleDialogIntent({ type: "closeCurrent" })}
    />
  );
}

function AboutDialog({
  dialog,
}: Readonly<{ dialog: Extract<ZManagerDialogSnapshot, { kind: "about" }> }>) {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();
  const i18n = translatorForSnapshot(snapshot);
  const [copied, setCopied] = useState(false);

  return (
    <DesktopDialog
      titleId="about-title"
      descriptionId="about-description"
      widthClassName="w-[min(920px,calc(100vw-48px))]"
      header={
        <div className="flex items-start justify-between gap-5 border-b border-slate-200 px-6 py-5 dark:border-slate-800">
          <div>
            <h2 id="about-title">{dialog.title}</h2>
            <p id="about-description">{i18n.t("about.description")}</p>
          </div>
          <Button
            id="about-dialog-close"
            variant="dialog"
            size="unset"
            className="icon-button"
            type="button"
            aria-label={i18n.t("about.close.aria")}
            onClick={() => actions.handleDialogIntent({ type: "closeCurrent" })}
          >
            {i18n.t("common.close")}
          </Button>
        </div>
      }
      content={
        <div className="bg-slate-50/40 px-6 py-5 dark:bg-slate-950">
          <div id="about-diagnostics" className="grid gap-3">
            {dialog.groups.map((group) => (
              <section
                className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                data-diagnostics-group
                key={group.title}
              >
                <h3>{group.title}</h3>
                <dl className="grid gap-1 text-xs [&>div]:grid [&>div]:grid-cols-[minmax(100px,34%)_minmax(0,1fr)] [&>div]:gap-2 [&_dt]:text-slate-500 dark:[&_dt]:text-slate-400">
                  {group.rows.map(([label, value]) => (
                    <div key={`${label}:${value}`}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </div>
      }
      footer={
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-950">
          <Button
            id="copy-diagnostics"
            type="button"
            variant="dialog"
            size="unset"
            onClick={() => {
              actions.handleDialogIntent({ type: "copyAboutDiagnostics" });
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1400);
            }}
          >
            {copied ? i18n.t("status.copied") : i18n.t("about.copyDiagnostics")}
          </Button>
          <Button
            id="about-close"
            type="button"
            variant="dialog"
            size="unset"
            onClick={() => actions.handleDialogIntent({ type: "closeCurrent" })}
          >
            {i18n.t("common.close")}
          </Button>
        </div>
      }
      onEscape={() => actions.handleDialogIntent({ type: "closeCurrent" })}
    />
  );
}

function ExtractDialog({
  dialog,
}: Readonly<{ dialog: Extract<ZManagerDialogSnapshot, { kind: "extract" }> }>) {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();
  const i18n = translatorForSnapshot(snapshot);
  const destinationRef = useRef<HTMLInputElement | null>(null);
  const [destination, setDestination] = useState(dialog.destination);
  const [useSubfolder, setUseSubfolder] = useState(dialog.useSubfolder);
  const [subfolder, setSubfolder] = useState(dialog.subfolder);
  const [pathMode, setPathMode] = useState(dialog.pathMode);
  const [overwrite, setOverwrite] = useState(dialog.overwrite);
  const [stripComponents, setStripComponents] = useState(
    dialog.stripComponents,
  );
  const [deduplicateRoot, setDeduplicateRoot] = useState(
    dialog.deduplicateRoot,
  );
  const [tzapRestorePolicy, setTzapRestorePolicy] = useState(
    dialog.tzapRestorePolicy,
  );
  const [tzapAllowDegraded, setTzapAllowDegraded] = useState(
    dialog.tzapAllowDegraded,
  );
  const [tzapAllowAbsoluteSymlinks, setTzapAllowAbsoluteSymlinks] = useState(
    dialog.tzapAllowAbsoluteSymlinks,
  );
  const [ignoreSymlinks, setIgnoreSymlinks] = useState(
    dialog.ignoreSymlinks,
  );
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const canExtract = destination.trim().length > 0;
  const isTzap = snapshot.archive.currentArchivePath
    .toLowerCase()
    .includes(".tzap");

  useEffect(() => {
    setDestination(dialog.destination);
    setUseSubfolder(dialog.useSubfolder);
    setSubfolder(dialog.subfolder);
    setPathMode(dialog.pathMode);
    setOverwrite(dialog.overwrite);
    setStripComponents(dialog.stripComponents);
    setDeduplicateRoot(dialog.deduplicateRoot);
    setTzapRestorePolicy(dialog.tzapRestorePolicy);
    setTzapAllowDegraded(dialog.tzapAllowDegraded);
    setTzapAllowAbsoluteSymlinks(dialog.tzapAllowAbsoluteSymlinks);
    setIgnoreSymlinks(dialog.ignoreSymlinks);
  }, [
    dialog.destination,
    dialog.useSubfolder,
    dialog.subfolder,
    dialog.pathMode,
    dialog.overwrite,
    dialog.stripComponents,
    dialog.deduplicateRoot,
    dialog.tzapRestorePolicy,
    dialog.tzapAllowDegraded,
    dialog.tzapAllowAbsoluteSymlinks,
    dialog.ignoreSymlinks,
  ]);

  useEffect(() => {
    setPassword("");
    setShowPassword(false);
  }, [dialog.mode, dialog.passwordPromptOpen]);

  useEffect(() => {
    destinationRef.current?.focus();
  }, []);

  const form = {
    destination,
    useSubfolder,
    subfolder,
    pathMode,
    overwrite,
    stripComponents,
    deduplicateRoot,
    tzapRestorePolicy,
    tzapAllowDegraded,
    tzapAllowAbsoluteSymlinks,
    ignoreSymlinks,
  };

  return (
    <DesktopDialog
      titleId="extract-title"
      descriptionId="extract-dialog-message"
      header={
        <div className="flex items-start justify-between gap-5 border-b border-slate-200 px-6 py-5 dark:border-slate-800">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-blue-600 dark:text-blue-400">
              <FolderOutput className="size-4" />
              Extraction task
            </div>
            <h2
              id="extract-title"
              className="text-xl font-semibold tracking-tight"
            >
              {dialog.title}
            </h2>
            <p
              id="extract-dialog-message"
              className="mt-1 max-w-xl text-sm leading-5 text-slate-500 dark:text-slate-400"
            >
              {dialog.message}
            </p>
          </div>
          <Button
            id="extract-dialog-close"
            variant="dialog"
            size="unset"
            className="!size-9 !rounded-lg !border-0 !bg-transparent !p-0 hover:!bg-slate-100 dark:hover:!bg-slate-800"
            type="button"
            aria-label={i18n.t("extract.close.aria")}
            onClick={() => actions.handleDialogIntent({ type: "closeCurrent" })}
          >
            <X className="size-4" />
          </Button>
        </div>
      }
      content={
        <div className="space-y-4 bg-slate-50/40 px-6 py-5 dark:bg-slate-950">
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/70 [&>label]:grid [&>label]:gap-1.5 [&>label>span]:text-xs [&>label>span]:font-semibold">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-blue-50 p-2 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
                <FolderOutput className="size-4" />
              </div>
              <h3 className="text-sm font-semibold">
                {i18n.t("extract.destination")}
              </h3>
            </div>
            <label>
              <span>{i18n.t("extract.destination")}</span>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <input
                  id="extract-destination"
                  ref={destinationRef}
                  type="text"
                  list="extract-destination-history"
                  placeholder={i18n.t("extract.destination.placeholder")}
                  value={destination}
                  onChange={(event) =>
                    setDestination(event.currentTarget.value)
                  }
                />
                <datalist id="extract-destination-history">
                  {dialog.destinationHistory.map((entry) => (
                    <option value={entry} key={entry} />
                  ))}
                </datalist>
                <Button
                  id="browse-extract-destination"
                  variant="dialog"
                  size="unset"
                  type="button"
                  onClick={() =>
                    actions.handleDialogIntent({
                      type: "browseExtractDestination",
                      ...form,
                    })
                  }
                >
                  {i18n.t("common.browse")}
                </Button>
              </div>
            </label>
            <label className="grid grid-cols-[auto_1fr] items-center gap-2">
              <input
                id="extract-use-subfolder"
                type="checkbox"
                checked={useSubfolder}
                onChange={(event) =>
                  setUseSubfolder(event.currentTarget.checked)
                }
              />
              <span className="inline-flex items-center gap-1">
                {i18n.t("extract.toSubfolder")}
                <InfoTip content={i18n.t("extract.toSubfolder.tooltip")} />
              </span>
            </label>
            <label>
              <span>{i18n.t("extract.subfolder")}</span>
              <input
                id="extract-subfolder"
                type="text"
                placeholder={i18n.t("common.optional")}
                value={subfolder}
                disabled={!useSubfolder}
                onChange={(event) => setSubfolder(event.currentTarget.value)}
              />
            </label>
          </section>
          <details className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:hover:bg-slate-800/70 [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-3">
                <span className="rounded-lg bg-slate-100 p-2 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  <SlidersHorizontal className="size-4" />
                </span>
                <span>
                  <strong className="block text-sm">
                    {i18n.t("extract.advancedOptions")}
                  </strong>
                  <span className="mt-0.5 block text-xs font-normal text-slate-500 dark:text-slate-400">
                    Path handling, collisions, password and folder structure
                  </span>
                </span>
              </span>
              <ChevronDown className="size-4 text-slate-400 transition-transform group-open:rotate-180" />
            </summary>
            <div className="space-y-4 border-t border-slate-200 p-5 dark:border-slate-800">
              <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4 [&>label]:grid [&>label]:grid-cols-1 [&>label]:items-stretch [&>label]:gap-1.5 [&>label>span]:text-xs [&>label>span]:font-semibold">
                <label>
                  <span className="inline-flex items-center gap-1">
                    {i18n.t("extract.pathMode")}
                    <InfoTip content={i18n.t("extract.pathMode.tooltip")} />
                  </span>
                  <Select
                    value={pathMode}
                    onValueChange={(value) =>
                      setPathMode(value as typeof pathMode)
                    }
                  >
                    <SelectTrigger id="extract-path-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="full">
                        {i18n.t("extract.pathMode.full")}
                      </SelectItem>
                      <SelectItem value="current">
                        {i18n.t("extract.pathMode.current")}
                      </SelectItem>
                      <SelectItem value="none">
                        {i18n.t("extract.pathMode.none")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <label>
                  <span className="inline-flex items-center gap-1">
                    {i18n.t("extract.overwritePolicy")}
                    <InfoTip content={i18n.t("extract.overwritePolicy.tooltip")} />
                  </span>
                  <Select
                    value={overwrite}
                    onValueChange={(value) =>
                      setOverwrite(value as typeof overwrite)
                    }
                  >
                    <SelectTrigger id="browse-overwrite">
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
                </label>
                <label>
                  <span className="inline-flex items-center gap-1">
                    {i18n.t("extract.stripComponents")}
                    <InfoTip content={i18n.t("extract.stripComponents.tooltip")} />
                  </span>
                  <input
                    id="browse-strip-components"
                    type="number"
                    min="0"
                    value={stripComponents}
                    onChange={(event) =>
                      setStripComponents(event.currentTarget.value)
                    }
                  />
                </label>
                <label className="grid min-h-10 grid-cols-[auto_1fr] items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-700">
                  <input
                    id="extract-deduplicate-root"
                    type="checkbox"
                    checked={deduplicateRoot}
                    onChange={(event) =>
                      setDeduplicateRoot(event.currentTarget.checked)
                    }
                  />
                  <span className="inline-flex items-center gap-1">
                    {i18n.t("extract.deduplicateRoot")}
                    <InfoTip content={i18n.t("extract.deduplicateRoot.tooltip")} />
                  </span>
                </label>
                <label className="grid min-h-10 grid-cols-[auto_1fr] items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-700">
                  <input
                    id="extract-ignore-symlinks"
                    type="checkbox"
                    checked={ignoreSymlinks}
                    onChange={(event) =>
                      setIgnoreSymlinks(event.currentTarget.checked)
                    }
                  />
                  <span className="inline-flex items-center gap-1">
                    {i18n.t("extract.ignoreSymlinks")}
                    <InfoTip content={i18n.t("extract.ignoreSymlinks.tooltip")} />
                  </span>
                </label>
                {isTzap ? (
                  <div className="grid gap-3 rounded-xl border border-blue-500/20 bg-blue-500/[0.04] p-3">
                    <label className="grid gap-1.5">
                      <span className="inline-flex items-center gap-1">
                        {i18n.t("extract.tzapRestorePolicy")}
                        <InfoTip content={i18n.t("extract.tzapRestorePolicy.tooltip")} />
                      </span>
                      <Select
                        value={tzapRestorePolicy}
                        onValueChange={(value) => {
                          setTzapRestorePolicy(
                            value as typeof tzapRestorePolicy,
                          );
                          if (value === "content" || value === "portable") {
                            setTzapAllowDegraded(false);
                          }
                        }}
                      >
                        <SelectTrigger id="browse-tzap-restore-policy">
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
                      <span className="text-[11px] font-normal leading-4 text-slate-500 dark:text-slate-400">
                        {i18n.t(
                          `extract.tzapRestorePolicy.${tzapRestorePolicy}.help`,
                        )}
                      </span>
                    </label>
                    <label className="flex items-start gap-2 text-xs font-medium">
                      <Checkbox
                        checked={tzapAllowDegraded}
                        disabled={
                          tzapRestorePolicy === "content" ||
                          tzapRestorePolicy === "portable"
                        }
                        onCheckedChange={(checked) =>
                          setTzapAllowDegraded(checked === true)
                        }
                      />
                      <span className="inline-flex items-center gap-1">
                        <span>{i18n.t("extract.tzapAllowDegraded")}</span>
                        <InfoTip content={i18n.t("extract.tzapAllowDegraded.tooltip")} />
                      </span>
                    </label>
                    <label className="flex items-start gap-2 text-xs font-medium">
                      <Checkbox
                        id="extract-tzap-allow-absolute-symlinks"
                        checked={tzapAllowAbsoluteSymlinks}
                        onCheckedChange={(checked) =>
                          setTzapAllowAbsoluteSymlinks(checked === true)
                        }
                      />
                      <span className="inline-flex items-center gap-1">
                        <span>{i18n.t("extract.tzapAllowAbsoluteSymlinks")}</span>
                        <InfoTip content={i18n.t("extract.tzapAllowAbsoluteSymlinks.tooltip")} />
                      </span>
                    </label>
                  </div>
                ) : null}
              </div>
              <details
                className="group/password overflow-hidden rounded-xl border border-slate-200 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-950/40"
                open={dialog.passwordPromptOpen}
              >
                <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-xs font-semibold [&::-webkit-details-marker]:hidden">
                  {i18n.t("extract.password")}
                  <ChevronDown className="size-4 text-slate-400 transition-transform group-open/password:rotate-180" />
                </summary>
                <div className="grid gap-3 border-t border-slate-200 p-4 dark:border-slate-700">
                  <label>
                    <span className="inline-flex items-center gap-1">
                      {i18n.t("extract.password")}
                      <InfoTip content={i18n.t("extract.password.tooltip")} />
                    </span>
                    <input
                      id="browse-password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(event) =>
                        setPassword(event.currentTarget.value)
                      }
                    />
                  </label>
                  <label className="grid grid-cols-[auto_1fr] items-center gap-2">
                    <input
                      id="browse-show-password"
                      type="checkbox"
                      checked={showPassword}
                      onChange={(event) =>
                        setShowPassword(event.currentTarget.checked)
                      }
                    />
                    <span>{i18n.t("extract.showPassword")}</span>
                  </label>
                </div>
              </details>
            </div>
          </details>
        </div>
      }
      footer={
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-950">
          <Button
            id="extract-cancel"
            variant="dialog"
            size="unset"
            type="button"
            onClick={() => actions.handleDialogIntent({ type: "closeCurrent" })}
          >
            {i18n.t("common.cancel")}
          </Button>
          <Button
            id="extract-start"
            variant={canExtract ? "dialogPrimary" : "dialog"}
            size="unset"
            type="button"
            className="min-w-24"
            aria-disabled={!canExtract}
            disabled={!canExtract}
            onClick={() =>
              actions.handleDialogIntent({
                type: "submitExtract",
                mode: dialog.mode,
                ...form,
                password,
              })
            }
          >
            {dialog.startLabel}
          </Button>
        </div>
      }
      onEscape={() => actions.handleDialogIntent({ type: "closeCurrent" })}
    />
  );
}

function detailValueMode(value: string): "wrap" | "middle" {
  return /[\\/]/.test(value) && value.length > 48 ? "middle" : "wrap";
}

function middleTruncateDetailValue(value: string, maxLength = 88): string {
  if (value.length <= maxLength) {
    return value;
  }

  const headLength = Math.ceil((maxLength - 3) * 0.56);
  const tailLength = Math.floor((maxLength - 3) * 0.44);
  return `${value.slice(0, headLength)}...${value.slice(value.length - tailLength)}`;
}
