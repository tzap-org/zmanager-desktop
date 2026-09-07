import {
  Archive,
  ChevronDown,
  Copy,
  File,
  Folder,
  Plus,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { getKnownArchiveSuffix } from "../../../app/archiveFileTypes";
import { formatBytes, formatDate } from "../../../app/formatting";
import type { ArchiveWorkspaceDetailsModel } from "../../../app/workspaces/archiveWorkspace";
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
import { translatorForSnapshot } from "../shell/shellHelpers";
import {
  nativeIconDataUrlForArchivePath,
  nativeIconDataUrlForEntry,
  nativeIconDataUrlForFolder,
} from "./archiveNativeIcons";
import { useExtractPasswordState } from "./ExtractPasswordContext";

type ArchiveEntryKind = Extract<
  ArchiveWorkspaceDetailsModel,
  { kind: "entry" }
>["entry"]["kind"];

export function ArchiveDetailsPane() {
  const snapshot = useZManagerSnapshot();
  const i18n = translatorForSnapshot(snapshot);

  return (
    <aside
      id="details-pane"
      data-workspace-content
      className="min-h-0 min-w-[220px] overflow-x-hidden overflow-y-auto bg-slate-50/70 dark:bg-slate-950/70"
      aria-label={i18n.t("workspace.details.aria")}
    >
      <div className="min-w-0 overflow-x-hidden">
        <ExtractOptions />
        <TzapVerification />
        <section
          className="border-t border-slate-200 p-3 [@media(max-height:560px)]:hidden dark:border-slate-800"
          aria-labelledby="extract-details-title"
        >
          <h2
            id="extract-details-title"
            className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
          >
            {i18n.t("pane.details")}
          </h2>
          <div id="details-content">
            <DetailsContent model={snapshot.archive.view.details} />
          </div>
        </section>
      </div>
    </aside>
  );
}

function TzapVerification() {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();
  const i18n = translatorForSnapshot(snapshot);
  const verification = snapshot.extract.tzapVerification;
  const isTzap = snapshot.archive.currentArchivePath
    .toLowerCase()
    .includes(".tzap");
  if (!isTzap) {
    return null;
  }

  const busy = verification.state === "checking";
  const successful =
    verification.state === "trusted" || verification.state === "signatureValid" || verification.state === "verifiedOffline" || verification.state === "verifiedWithCaveat";
  const hasCaveat = verification.state === "verifiedWithCaveat";
  return (
    <section
      className="rounded-xl border border-black/10 bg-white/70 p-3 shadow-sm dark:border-white/10 dark:bg-white/[0.035]"
      aria-labelledby="tzap-verification-title"
    >
      <div className="flex items-start gap-2">
        <span
          className={`mt-0.5 rounded-lg p-1.5 ${hasCaveat ? "bg-amber-500/10 text-amber-700" : successful ? "bg-emerald-500/10 text-emerald-700" : verification.state === "error" ? "bg-red-500/10 text-red-700" : "bg-blue-500/10 text-blue-700"}`}
          aria-hidden="true"
        >
          {verification.state === "error" ? (
            <ShieldAlert className="size-4" />
          ) : (
            <ShieldCheck className="size-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="tzap-verification-title" className="text-xs font-semibold">
            {i18n.t("extract.tzapVerification.title")}
          </h3>
          <p className="mt-0.5 text-[11px] opacity-70">
            {i18n.t("extract.tzapVerification.description")}
          </p>
        </div>
      </div>

      <label className="mt-3 grid gap-1 text-[11px] font-medium">
        <span>{i18n.t("extract.tzapVerification.mode")}</span>
        <Select
          value={verification.validateTrust ? "trust" : "signature"}
          disabled={busy}
          onValueChange={(value) =>
            actions.handleArchiveIntent({
              type: "setTzapVerificationOptions",
              patch: { validateTrust: value === "trust" },
            })
          }
        >
          <SelectTrigger id="tzap-verification-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="signature">
              {i18n.t("extract.tzapVerification.signatureOnly")}
            </SelectItem>
            <SelectItem value="trust">
              {i18n.t("extract.tzapVerification.validateTrust")}
            </SelectItem>
          </SelectContent>
        </Select>
      </label>

      {verification.validateTrust ? (
        <div className="mt-3 grid gap-2 rounded-lg bg-black/[0.025] p-2 dark:bg-white/[0.035]">
          <label className="flex items-center gap-2 text-[11px]">
            <Checkbox
              id="tzap-official-root"
              checked={verification.includeOfficialTzapRoot}
              disabled={busy}
              onCheckedChange={(checked) =>
                actions.handleArchiveIntent({
                  type: "setTzapVerificationOptions",
                  patch: {
                    includeOfficialTzapRoot: checked === true,
                  },
                })
              }
            />
            <span>{i18n.t("extract.tzapVerification.officialRoot")}</span>
          </label>
          <label className="flex items-center gap-2 text-[11px]">
            <Checkbox
              id="tzap-system-roots"
              checked={verification.trustedSystemRoots}
              disabled={busy}
              onCheckedChange={(checked) =>
                actions.handleArchiveIntent({
                  type: "setTzapVerificationOptions",
                  patch: { trustedSystemRoots: checked === true },
                })
              }
            />
            <span>{i18n.t("extract.tzapVerification.systemRoots")}</span>
          </label>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium">
              {i18n.t("extract.tzapVerification.customCAs")}
            </span>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] hover:bg-black/5 dark:hover:bg-white/5"
              disabled={busy}
              onClick={() =>
                actions.handleArchiveIntent({ type: "chooseTzapTrustedCAs" })
              }
            >
              <Plus className="size-3" />
              {i18n.t("common.add")}
            </button>
          </div>
          {verification.trustedCaCertificatePaths.map((path) => (
            <div
              className="flex min-w-0 items-center gap-1 rounded-md border border-black/10 bg-white/70 px-2 py-1 dark:border-white/10 dark:bg-black/10"
              key={path}
            >
              <span
                className="min-w-0 flex-1 truncate text-[10px]"
                title={path}
              >
                {path.split(/[\\/]/).at(-1)}
              </span>
              <button
                type="button"
                className="rounded p-0.5 hover:bg-black/5"
                aria-label={i18n.t("common.remove")}
                onClick={() =>
                  actions.handleArchiveIntent({
                    type: "removeTzapTrustedCA",
                    path,
                  })
                }
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <label className="mt-3 flex items-center gap-2 text-[11px]">
        <Checkbox
          id="tzap-current-status"
          checked={verification.checkCurrentStatus}
          disabled={busy}
          onCheckedChange={(checked) =>
            actions.handleArchiveIntent({
              type: "setTzapVerificationOptions",
              patch: { checkCurrentStatus: checked === true },
            })
          }
        />
        <span>{i18n.t("extract.tzapVerification.currentStatus")}</span>
      </label>

      <button
        type="button"
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
        disabled={
          busy ||
          (verification.validateTrust &&
            !verification.includeOfficialTzapRoot &&
            !verification.trustedSystemRoots &&
            verification.trustedCaCertificatePaths.length === 0)
        }
        onClick={() =>
          actions.handleArchiveIntent({ type: "verifyTzapCertificate" })
        }
      >
        {busy
          ? i18n.t("extract.tzapVerification.checking")
          : verification.checkCurrentStatus
            ? i18n.t("extract.tzapVerification.checkCurrentStatus")
            : verification.validateTrust
            ? i18n.t("extract.tzapVerification.validate")
            : i18n.t("extract.tzapVerification.inspect")}
      </button>

      {verification.result ? (
        <div className="mt-3 grid gap-1 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] p-2 text-[10px]">
          <strong className="text-emerald-700">
            {hasCaveat
              ? i18n.t("extract.tzapVerification.verifiedWithCaveat")
              : verification.state === "verifiedOffline"
              ? i18n.t("extract.tzapVerification.verifiedOffline")
              : verification.state === "trusted"
              ? i18n.t("extract.tzapVerification.trusted")
              : i18n.t("extract.tzapVerification.signatureValid")}
          </strong>
          <span className="truncate" title={verification.result.subject}>
            {verification.result.subject}
          </span>
          <span
            className="truncate opacity-70"
            title={verification.result.issuer}
          >
            {verification.result.issuer}
          </span>
          <code
            className="truncate opacity-70"
            title={verification.result.certificateSha256}
          >
            {verification.result.certificateSha256}
          </code>
          {hasCaveat && verification.result.statusReason ? (
            <span className="text-amber-700 dark:text-amber-300">{i18n.t("extract.tzapVerification.statusReason")}: {verification.result.statusReason}</span>
          ) : null}
        </div>
      ) : null}
      {verification.error ? (
        <p className="mt-2 text-[10px] text-red-700" role="alert">
          {verification.error}
        </p>
      ) : null}
    </section>
  );
}

function ExtractOptions() {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();
  const i18n = translatorForSnapshot(snapshot);
  const options = snapshot.extract;
  const passwordState = useExtractPasswordState();
  const [advancedOpen, setAdvancedOpen] = useState(options.passwordPromptOpen);
  const isTzap =
    getKnownArchiveSuffix(snapshot.archive.currentArchivePath) === ".tzap";
  const recipientKeys = snapshot.account.recipientKeys.filter(
    (key) => key.lifecycle === "active" || key.lifecycle === "retired",
  );

  useEffect(() => {
    if (options.passwordPromptOpen) {
      setAdvancedOpen(true);
    }
  }, [options.passwordPromptOpen]);

  return (
    <section
      className="min-w-0 space-y-3 border-0 bg-transparent p-3 shadow-none"
      aria-labelledby="extract-options-title"
    >
      <div className="flex items-start gap-3 border-b border-slate-200 px-1 pb-4 pt-1 dark:border-slate-800">
        <div className="mt-0.5 rounded-lg bg-blue-600 p-2 text-white shadow-sm">
          <SlidersHorizontal className="size-4" />
        </div>
        <div className="min-w-0">
          <h3
            id="extract-options-title"
            className="text-sm font-semibold tracking-tight"
          >
            {i18n.t("extract.options.title")}
          </h3>
          <p className="mt-1 text-[11px] leading-4 text-slate-500 dark:text-slate-400">
            {options.usesGlobalDefaults
              ? i18n.t("extract.usingGlobalDefaults")
              : i18n.t("extract.overriddenDefaults")}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3 [@media(max-height:560px)]:grid-cols-2">
        <label className="!grid-cols-1 !items-stretch !gap-1.5">
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            {i18n.t("extract.pathMode")}
            <InfoTip content={i18n.t("extract.pathMode.tooltip")} />
          </span>
          <Select
            value={options.pathMode}
            onValueChange={(value) =>
              actions.handleArchiveIntent({
                type: "setExtractOptions",
                patch: {
                  pathMode: value as typeof options.pathMode,
                },
              })
            }
          >
            <SelectTrigger id="extract-path-mode" className="w-full">
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
        </label>
        <label className="!grid-cols-1 !items-stretch !gap-1.5">
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            {i18n.t("extract.overwritePolicy")}
            <InfoTip content={i18n.t("extract.overwritePolicy.tooltip")} />
          </span>
          <Select
            value={options.overwrite}
            onValueChange={(value) =>
              actions.handleArchiveIntent({
                type: "setExtractOptions",
                patch: {
                  overwrite: value as typeof options.overwrite,
                },
              })
            }
          >
            <SelectTrigger id="extract-overwrite" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="refuse">{i18n.t("extract.overwrite.refuse")}</SelectItem>
              <SelectItem value="ask">{i18n.t("extract.overwrite.ask")}</SelectItem>
              <SelectItem value="rename">{i18n.t("extract.overwrite.rename")}</SelectItem>
              <SelectItem value="replace">
                {i18n.t("extract.overwrite.replace")}
              </SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="grid min-h-10 grid-cols-[auto_1fr] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
          <Checkbox
            id="extract-deduplicate-root"
            checked={options.deduplicateRoot}
            onCheckedChange={(checked) =>
              actions.handleArchiveIntent({
                type: "setExtractOptions",
                patch: { deduplicateRoot: checked === true },
              })
            }
          />
          <span className="inline-flex items-center gap-1">
            {i18n.t("extract.deduplicateRoot")}
            <InfoTip content={i18n.t("extract.deduplicateRoot.tooltip")} />
          </span>
        </label>
        <label className="grid min-h-10 grid-cols-[auto_1fr] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
          <Checkbox
            id="extract-ignore-symlinks"
            checked={options.ignoreSymlinks}
            onCheckedChange={(checked) =>
              actions.handleArchiveIntent({
                type: "setExtractOptions",
                patch: { ignoreSymlinks: checked === true },
              })
            }
          />
          <span className="inline-flex items-center gap-1">
            {i18n.t("extract.ignoreSymlinks")}
            <InfoTip content={i18n.t("extract.ignoreSymlinks.tooltip")} />
          </span>
        </label>
      </div>
      <button
        className="ml-0 inline-flex rounded-lg border-0 bg-transparent px-2 py-1.5 text-[11px] hover:bg-slate-100 dark:hover:bg-slate-800 [@media(max-height:560px)]:hidden"
        type="button"
        onClick={() => {
          actions.handleArchiveIntent({ type: "resetExtractDefaults" });
          passwordState.reset();
        }}
      >
        {i18n.t("extract.resetGlobalDefaults")}
      </button>
      <details
        className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/80"
        open={advancedOpen}
        onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
      >
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3.5 py-3 text-xs font-semibold transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 [&::-webkit-details-marker]:hidden">
          <span>{i18n.t("extract.advancedOptions")}</span>
          <ChevronDown className="size-4 text-slate-400 transition-transform group-open:rotate-180" />
        </summary>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3 border-t border-slate-200 p-3.5 dark:border-slate-800 [&>label]:grid [&>label]:grid-cols-1 [&>label]:items-stretch [&>label]:gap-1.5 [&>label>span]:text-[11px] [&>label>span]:font-semibold">
          <label>
            <span className="inline-flex items-center gap-1">
              {i18n.t("extract.stripComponents")}
              <InfoTip content={i18n.t("extract.stripComponents.tooltip")} />
            </span>
            <input
              id="extract-strip-components"
              type="number"
              min="0"
              value={options.stripComponents}
              onChange={(event) =>
                actions.handleArchiveIntent({
                  type: "setExtractOptions",
                  patch: {
                    stripComponents: Math.max(
                      0,
                      Number.parseInt(event.currentTarget.value, 10) || 0,
                    ),
                  },
                })
              }
            />
          </label>
          <label>
            <span className="inline-flex items-center gap-1">
              {i18n.t("extract.password")}
              <InfoTip content={i18n.t("extract.password.tooltip")} />
            </span>
            <input
              id="extract-password"
              type={passwordState.showPassword ? "text" : "password"}
              value={passwordState.password}
              disabled={Boolean(options.tzapRecipientKeyId)}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (value.trim() && options.tzapRecipientKeyId) {
                  actions.handleArchiveIntent({
                    type: "setExtractOptions",
                    patch: { tzapRecipientKeyId: "" },
                  });
                }
                passwordState.setPassword(value);
              }}
            />
          </label>
          {isTzap ? (
            <div className="grid gap-3 rounded-xl border border-blue-500/20 bg-blue-500/[0.04] p-3">
              {recipientKeys.length > 0 ? (
                <label className="grid gap-1.5">
                  <span className="inline-flex items-center gap-1">
                    {i18n.t("extract.tzapRecipientKey")}
                    <InfoTip content={i18n.t("extract.password.tooltip")} />
                  </span>
                  <Select
                    value={options.tzapRecipientKeyId || "password"}
                    onValueChange={(value) => {
                      actions.handleArchiveIntent({
                        type: "setExtractOptions",
                        patch: {
                          tzapRecipientKeyId: value === "password" ? "" : value,
                        },
                      });
                      if (value !== "password") {
                        passwordState.reset();
                      }
                    }}
                  >
                    <SelectTrigger id="extract-tzap-recipient-key">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="password">
                        {i18n.t("extract.tzapRecipientKey.password")}
                      </SelectItem>
                      {recipientKeys.map((key) => (
                        <SelectItem key={key.keyId} value={key.keyId}>
                          {key.label || i18n.t("extract.tzapRecipientKey.local")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              ) : (
                <p className="text-[10px] font-normal leading-4 text-slate-500 dark:text-slate-400">
                  {i18n.t("extract.tzapRecipientKey.none")}
                </p>
              )}
              <label className="grid gap-1.5">
                <span className="inline-flex items-center gap-1">
                  {i18n.t("extract.tzapRestorePolicy")}
                  <InfoTip content={i18n.t("extract.tzapRestorePolicy.tooltip")} />
                </span>
                <Select
                  value={options.tzapRestorePolicy}
                  onValueChange={(value) =>
                    actions.handleArchiveIntent({
                      type: "setExtractOptions",
                      patch: {
                        tzapRestorePolicy:
                          value as typeof options.tzapRestorePolicy,
                        ...(value === "content" || value === "portable"
                          ? { tzapAllowDegraded: false }
                          : {}),
                      },
                    })
                  }
                >
                  <SelectTrigger id="extract-tzap-restore-policy">
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
                <span className="text-[10px] font-normal leading-4 text-slate-500 dark:text-slate-400">
                  {i18n.t(
                    `extract.tzapRestorePolicy.${options.tzapRestorePolicy}.help`,
                  )}
                </span>
              </label>
              <label className="flex items-start gap-2 text-[11px] font-medium">
                <Checkbox
                  id="extract-tzap-allow-degraded"
                  checked={options.tzapAllowDegraded}
                  disabled={
                    options.tzapRestorePolicy === "content" ||
                    options.tzapRestorePolicy === "portable"
                  }
                  onCheckedChange={(checked) =>
                    actions.handleArchiveIntent({
                      type: "setExtractOptions",
                      patch: { tzapAllowDegraded: checked === true },
                    })
                  }
                />
                <span className="inline-flex items-center gap-1">
                  <span>{i18n.t("extract.tzapAllowDegraded")}</span>
                  <InfoTip content={i18n.t("extract.tzapAllowDegraded.tooltip")} />
                </span>
              </label>
              <label className="flex items-start gap-2 text-[11px] font-medium">
                <Checkbox
                  id="extract-tzap-allow-absolute-symlinks"
                  checked={options.tzapAllowAbsoluteSymlinks}
                  onCheckedChange={(checked) =>
                    actions.handleArchiveIntent({
                      type: "setExtractOptions",
                      patch: { tzapAllowAbsoluteSymlinks: checked === true },
                    })
                  }
                />
                <span className="inline-flex items-center gap-1">
                  <span>{i18n.t("extract.tzapAllowAbsoluteSymlinks")}</span>
                  <InfoTip content={i18n.t("extract.tzapAllowAbsoluteSymlinks.tooltip")} />
                </span>
              </label>
            </div>
          ) : null}
          <label className="grid grid-cols-[auto_1fr] items-center gap-2">
            <input
              id="extract-show-password"
              type="checkbox"
              checked={passwordState.showPassword}
              onChange={(event) =>
                passwordState.setShowPassword(event.currentTarget.checked)
              }
            />
            <span>{i18n.t("extract.showPassword")}</span>
          </label>
        </div>
      </details>
    </section>
  );
}

function DetailsContent({
  model,
}: Readonly<{ model: ArchiveWorkspaceDetailsModel }>) {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();
  const i18n = translatorForSnapshot(snapshot);
  const openCommandState = snapshot.commands.states.open;

  switch (model.kind) {
    case "noArchive":
      return (
        <div className="grid gap-2 rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          <h3>No archive open</h3>
          <p>{i18n.t("browse.noArchiveOpen")}</p>
          <button
            className="min-h-9 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            type="button"
            data-details-action="open-archive"
            disabled={!openCommandState.enabled}
            title={
              openCommandState.enabled ? undefined : openCommandState.reason
            }
            onClick={() =>
              actions.handleArchiveIntent({
                type: "runDetailsAction",
                action: "open-archive",
              })
            }
          >
            {i18n.t("browse.emptyOpenAction")}
          </button>
        </div>
      );
    case "hiddenSelection":
      return (
        <DetailBlock
          title={i18n.t("detail.selectionHiddenBySearch")}
          rows={[
            ["Selected", String(model.selectedCount)],
            ["Search", model.searchQuery],
            [
              "First selected",
              model.firstSelectedEntryName || model.firstSelectedEntryPath,
            ],
          ]}
        >
          <button
            className="min-h-9 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            type="button"
            data-details-action="clear-search"
            onClick={() =>
              actions.handleArchiveIntent({
                type: "runDetailsAction",
                action: "clear-search",
              })
            }
          >
            {i18n.t("search.clear")}
          </button>
        </DetailBlock>
      );
    case "archiveSummary":
      return (
        <DetailBlock
          title={
            model.archivePath.split(/[\\/]/).filter(Boolean).at(-1) ??
            model.archivePath
          }
          icon={<Archive />}
          iconKind="archive"
          nativeIconDataUrl={nativeIconDataUrlForArchivePath(
            snapshot,
            model.archivePath,
          )}
          rows={[
            ["Archive path", model.archivePath],
            [i18n.t("detail.format"), archiveFormatLabel(model.archivePath)],
            ["Entries", String(model.entryCount)],
            ["Folder", model.currentFolder || "/"],
            [
              "Unpacked size",
              model.unpackedSize === null
                ? ""
                : formatBytes(model.unpackedSize, {
                    locale: snapshot.display.resolvedLocale,
                  }),
            ],
            [
              "Packed size",
              model.packedSize === null
                ? ""
                : formatBytes(model.packedSize, {
                    locale: snapshot.display.resolvedLocale,
                  }),
            ],
          ]}
        />
      );
    case "syntheticFolder":
      return (
        <DetailBlock
          title={model.row.name}
          icon={<Folder />}
          iconKind="folder"
          nativeIconDataUrl={nativeIconDataUrlForFolder(snapshot)}
          rows={[
            ["Name", model.row.name],
            ["Path", model.row.path],
            ["Type", i18n.t("entryKind.directory")],
          ]}
        />
      );
    case "entry":
      return (
        <DetailBlock
          title={model.entry.path.split("/").at(-1) ?? model.entry.path}
          icon={model.entry.kind === "directory" ? <Folder /> : <File />}
          iconKind={model.entry.kind === "directory" ? "folder" : "file"}
          nativeIconDataUrl={nativeIconDataUrlForEntry(snapshot, model.entry)}
          rows={[
            ["Path", model.entry.path],
            ["Type", entryKindLabel(model.entry.kind, i18n)],
            [
              "Size",
              formatBytes(model.entry.size, {
                locale: snapshot.display.resolvedLocale,
                emptyValue: "",
              }),
            ],
            [
              "Packed size",
              formatBytes(model.entry.compressedSize, {
                locale: snapshot.display.resolvedLocale,
                emptyValue: "",
              }),
            ],
            [
              i18n.t("detail.modified"),
              formatDate(model.entry.modified, {
                locale: snapshot.display.resolvedLocale,
                emptyValue: "",
              }),
            ],
            [i18n.t("detail.mode"), formatArchiveMode(model.entry.mode)],
            [
              i18n.t("detail.metadataDiagnostics"),
              model.entry.metadataDiagnostics?.join("\n"),
            ],
          ]}
        >
          {model.entry.kind !== "directory" ? (
            <button
              className="min-h-9 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              type="button"
              data-details-action="preview"
              onClick={() =>
                actions.handleArchiveIntent({
                  type: "runDetailsAction",
                  action: "preview",
                })
              }
            >
              {i18n.t("command.view")}
            </button>
          ) : null}
        </DetailBlock>
      );
    case "multipleSelection":
      return (
        <DetailBlock
          title={`${model.selectedCount} entries selected`}
          rows={[
            ["Files", String(model.selectedFiles)],
            ["Folders", String(model.selectedFolders)],
            [
              "Total size",
              model.totalSize === null
                ? ""
                : formatBytes(model.totalSize, {
                    locale: snapshot.display.resolvedLocale,
                  }),
            ],
          ]}
        >
          <button
            className="min-h-9 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            type="button"
            data-details-action="extract-selected"
            onClick={() =>
              actions.handleArchiveIntent({
                type: "runDetailsAction",
                action: "extract-selected",
              })
            }
          >
            Extract Selected
          </button>
        </DetailBlock>
      );
  }
}

function DetailBlock({
  children,
  icon,
  iconKind,
  nativeIconDataUrl,
  rows,
  title,
}: Readonly<{
  children?: ReactNode;
  icon?: ReactNode;
  iconKind?: string;
  nativeIconDataUrl?: string | null;
  rows: readonly (readonly [string, string | null | undefined])[];
  title: string;
}>) {
  const actions = useZManagerActions();

  return (
    <div className="grid gap-2">
      <h3
        className={
          icon
            ? "flex min-w-0 items-center gap-2 font-semibold"
            : "font-semibold"
        }
      >
        {icon ? (
          <span
            className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${iconKind === "folder" ? "bg-amber-50 text-amber-600 dark:bg-amber-950" : "bg-blue-50 text-blue-600 dark:bg-blue-950"}`}
            aria-hidden="true"
            draggable={false}
          >
            {nativeIconDataUrl ? (
              <img
                className="size-7 object-contain"
                src={nativeIconDataUrl}
                alt=""
                draggable={false}
              />
            ) : (
              icon
            )}
          </span>
        ) : null}
        <span>{title}</span>
      </h3>
      {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
      <dl className="grid gap-1 text-xs [&>div]:grid [&>div]:grid-cols-[minmax(76px,34%)_minmax(0,1fr)] [&>div]:gap-2 [&_dt]:text-slate-500 dark:[&_dt]:text-slate-400">
        {rows
          .filter(([, value]) => Boolean(value))
          .map(([label, value]) => (
            <DetailDefinition
              label={label}
              value={value ?? ""}
              actions={actions}
              key={label}
            />
          ))}
      </dl>
    </div>
  );
}

function DetailDefinition({
  actions,
  label,
  value,
}: Readonly<{
  actions: ReturnType<typeof useZManagerActions>;
  label: string;
  value: string;
}>) {
  const valueMode = detailValueMode(value);
  const displayValue =
    valueMode === "middle" ? middleTruncateDetailValue(value) : value;

  return (
    <div>
      <dt>{label}</dt>
      <dd
        className="flex min-w-0 items-start gap-1"
        title={value}
        aria-label={`${label}: ${value}`}
      >
        {valueMode === "middle" ? (
          <>
            <span
              className="min-w-0 flex-1 truncate font-mono"
              aria-hidden="true"
            >
              {displayValue}
            </span>
            <span className="sr-only">{value}</span>
          </>
        ) : (
          <span className="min-w-0 flex-1 break-words">{displayValue}</span>
        )}
        <button
          className="grid size-6 shrink-0 place-items-center rounded border-0 bg-transparent p-0 hover:bg-slate-200 dark:hover:bg-slate-800"
          type="button"
          data-copy-value={value}
          aria-label={`Copy ${label}`}
          title="Copy"
          onClick={() =>
            actions.handleArchiveIntent({ type: "copyDetailsValue", value })
          }
        >
          <Copy className="size-3.5" aria-hidden="true" />
        </button>
      </dd>
    </div>
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

function entryKindLabel(
  kind: ArchiveEntryKind,
  i18n: ReturnType<typeof translatorForSnapshot>,
): string {
  switch (kind) {
    case "directory":
      return i18n.t("entryKind.directory");
    case "hardlink":
      return i18n.t("entryKind.hardlink");
    case "symlink":
      return i18n.t("entryKind.symlink");
    case "special":
      return i18n.t("entryKind.special");
    case "file":
      return i18n.t("entryKind.file");
  }
}

function formatArchiveMode(mode?: number): string {
  return typeof mode === "number" ? mode.toString(8).padStart(4, "0") : "";
}

function archiveFormatLabel(path: string): string | null {
  const suffix = getKnownArchiveSuffix(path);
  return suffix ? suffix.slice(1).toUpperCase() : null;
}
