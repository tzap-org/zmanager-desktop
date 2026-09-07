import {
  ArchiveRestore,
  CheckSquare,
  FileArchive,
  FolderOpen,
  Share2,
  SquareMinus,
  Trash2,
  UserRound,
  type LucideIcon,
} from "lucide-react";

import { createPlanRowInclusionState } from "../../../app/createFlow";
import {
  toolbarGroupsForWorkspaceMode,
  type CommandBarGroup,
  type CommandId,
} from "../../../app/classicCommands";
import type { CommandRouterPayload } from "../../../app/commands/commandRouter";
import { Button } from "../../components/ui/button";
import { cn } from "../../../lib/utils";
import { useZManagerActions, useZManagerSnapshot } from "../AppProviders";
import type { ZManagerReactSnapshot } from "../appRuntime";
import { useCreatePasswordState } from "../create/CreatePasswordContext";
import { useExtractPasswordState } from "../archive/ExtractPasswordContext";
import {
  commandButtonId,
  commandIcon,
  commandShortcut,
  commandStateFor,
  localizedCommandLabel,
  localizedCommandTooltip,
  translatorForSnapshot,
} from "./shellHelpers";

export function CommandToolbar() {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();
  const i18n = translatorForSnapshot(snapshot);
  const toolbarGroups = toolbarGroupsForWorkspaceMode(
    snapshot.shell.activeMode,
  );
  return (
    <header
      className="flex h-12 min-h-12 shrink-0 flex-nowrap items-center gap-1 overflow-hidden border-b border-slate-200 bg-white px-3 py-1.5 dark:border-slate-800 dark:bg-slate-900"
      data-shell-chrome="toolbar"
      role="toolbar"
      aria-label={i18n.t("workspace.toolbar.aria")}
    >
      <WorkspaceModeTabs />
      <div className="flex min-w-0 flex-1 items-center overflow-x-auto overflow-y-hidden [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {snapshot.shell.activeMode === "compress" ? (
          <CompressToolbarGroups />
        ) : (
          <ExtractToolbarGroups groups={toolbarGroups} />
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label="TZAP Account"
        title="TZAP Account"
        onClick={() => actions.handleAccountIntent({ type: "open" })}
      >
        <UserRound className="size-4" />
      </Button>
    </header>
  );
}

function ExtractToolbarGroups({
  groups,
}: Readonly<{ groups: readonly CommandBarGroup[] }>) {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();
  const i18n = translatorForSnapshot(snapshot);
  const passwordState = useExtractPasswordState();
  const canExtract =
    snapshot.archive.command.canUseArchive &&
    Boolean(snapshot.extract.destinationPath.trim());
  const selectedCount = snapshot.archive.view.selection.selectedCount;

  return (
    <>
      <div
        className="inline-flex min-w-max items-center gap-0.5 border-r border-slate-200 px-1 dark:border-slate-700"
        role="group"
        aria-label="Extract"
        data-command-group="extract"
      >
        <span className="max-w-[92px] truncate px-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
          Extract
        </span>
        <ToolbarButton commandId="open" />
        <ToolbarButton commandId="closeArchive" />
        <ToolbarActionButton
          id="extract-all"
          label={i18n.t("extract.allAction")}
          title={
            canExtract
              ? i18n.t("extract.allAction")
              : i18n.t("extract.chooseDestinationFirst")
          }
          Icon={ArchiveRestore}
          primary={canExtract}
          disabled={!canExtract}
          onClick={() => {
            actions.handleArchiveIntent({
              type: "runExtract",
              mode: "archive",
              password: passwordState.password,
            });
            passwordState.reset();
          }}
        />
        <ToolbarActionButton
          id="extract-selected"
          label={i18n.t("extract.selectedCountAction", {
            count: selectedCount,
          })}
          title={
            selectedCount
              ? i18n.t("extract.selectedAction")
              : i18n.t("extract.selectEntryFirst")
          }
          Icon={ArchiveRestore}
          disabled={!canExtract || selectedCount === 0}
          onClick={() => {
            actions.handleArchiveIntent({
              type: "runExtract",
              mode: "selection",
              password: passwordState.password,
            });
            passwordState.reset();
          }}
        />
        <ToolbarButton commandId="test" />
      </div>
      {groups.slice(1).map((group) => (
        <ToolbarGroup group={group} key={group.id} showSeparator />
      ))}
    </>
  );
}

function WorkspaceModeTabs() {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();
  const i18n = translatorForSnapshot(snapshot);
  const isCompress = snapshot.shell.activeMode === "compress";

  return (
    <div
      className="inline-flex h-full items-center border-r border-slate-200 pr-1 dark:border-slate-700"
      role="tablist"
      aria-label={i18n.t("workspace.mode.aria")}
    >
      <Button
        id="mode-compress"
        variant="ghost"
        size="sm"
        className="h-full min-w-[92px] rounded-none border-transparent bg-transparent px-3.5 text-slate-950 shadow-none hover:bg-slate-100 dark:text-slate-50 dark:hover:bg-slate-800 aria-selected:bg-slate-100 aria-selected:shadow-[inset_0_-2px_0_#2563eb] dark:aria-selected:bg-slate-800"
        type="button"
        role="tab"
        data-workspace-mode="compress"
        aria-selected={isCompress}
        onClick={() => actions.setWorkspaceMode("compress")}
      >
        {i18n.t("workspace.mode.compress")}
      </Button>
      <Button
        id="mode-extract"
        variant="ghost"
        size="sm"
        className="h-full min-w-[92px] rounded-none border-transparent bg-transparent px-3.5 text-slate-950 shadow-none hover:bg-slate-100 dark:text-slate-50 dark:hover:bg-slate-800 aria-selected:bg-slate-100 aria-selected:shadow-[inset_0_-2px_0_#2563eb] dark:aria-selected:bg-slate-800"
        type="button"
        role="tab"
        data-workspace-mode="extract"
        aria-selected={!isCompress}
        onClick={() => actions.setWorkspaceMode("extract")}
      >
        {i18n.t("workspace.mode.extract")}
      </Button>
    </div>
  );
}

function ToolbarGroup({
  group,
  showSeparator,
}: Readonly<{ group: CommandBarGroup; showSeparator: boolean }>) {
  return (
    <>
      {showSeparator ? (
        <div
          className="h-full w-px bg-slate-200 dark:bg-slate-700"
          aria-hidden="true"
        />
      ) : null}
      <div
        className="inline-flex min-w-max items-center gap-0.5 border-r border-slate-200 px-1 dark:border-slate-700"
        role="group"
        aria-label={group.label}
        data-command-group={group.id}
      >
        <span className="max-w-[92px] truncate px-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
          {group.label}
        </span>
        {group.items.map((commandId) => (
          <ToolbarButton commandId={commandId} key={commandId} />
        ))}
      </div>
    </>
  );
}

function CompressToolbarGroups() {
  return (
    <>
      <div
        className="inline-flex min-w-max items-center gap-0.5 border-r border-slate-200 px-1 dark:border-slate-700"
        role="group"
        aria-label="Compress"
        data-command-group="compress"
      >
        <span className="max-w-[92px] truncate px-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
          Compress
        </span>
        <ToolbarButton commandId="add" />
        <CompressDestinationToolbarButton />
        <CreateArchiveToolbarButton />
        <CompressAndShareOnLanToolbarButton />
      </div>
      <div
        className="h-full w-px bg-slate-200 dark:bg-slate-700"
        aria-hidden="true"
      />
      <div
        className="inline-flex min-w-max items-center gap-0.5 border-r border-slate-200 px-1 dark:border-slate-700"
        role="group"
        aria-label="Table actions"
        data-command-group="table"
      >
        <span className="max-w-[92px] truncate px-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
          Table actions
        </span>
        <CompressTableToolbarButtons />
      </div>
    </>
  );
}

function CompressDestinationToolbarButton() {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();
  const i18n = translatorForSnapshot(snapshot);

  if (snapshot.shell.activeMode !== "compress") {
    return null;
  }

  return (
    <ToolbarActionButton
      id="browse-create-destination"
      label={i18n.t("compress.outputFolder")}
      title={i18n.t("create.destination.browse.title")}
      Icon={FolderOpen}
      onClick={() => actions.handleCreateIntent({ type: "browseDestination" })}
    />
  );
}

function CreateArchiveToolbarButton() {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();
  const i18n = translatorForSnapshot(snapshot);
  const createPassword = useCreatePasswordState();
  const canSubmitPassword =
    snapshot.create.options.password.visible &&
    !snapshot.create.options.password.disabled;
  const canCreate = snapshot.create.options.readiness.canCreate;

  if (snapshot.shell.activeMode !== "compress") {
    return null;
  }

  return (
    <ToolbarActionButton
      id="start-create"
      label={i18n.t("compress.createArchive")}
      title={
        canCreate
          ? i18n.t("compress.createArchive")
          : createToolbarUnavailableText(snapshot)
      }
      Icon={FileArchive}
      primary={canCreate}
      disabled={!canCreate}
      onClick={() => {
        actions.handleCreateIntent({
          type: "runCreate",
          password: canSubmitPassword ? createPassword.password : "",
          passwordConfirm: canSubmitPassword
            ? createPassword.passwordConfirm
            : "",
          signingIdentityPassword: createPassword.signingIdentityPassword,
        });
        createPassword.reset();
      }}
    />
  );
}

function CompressAndShareOnLanToolbarButton() {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();
  const i18n = translatorForSnapshot(snapshot);
  const canShare = !snapshot.create.isEmpty;

  if (snapshot.shell.activeMode !== "compress" || !snapshot.runtime.isLocalSendAvailable) {
    return null;
  }

  return (
    <ToolbarActionButton
      id="compress-share-on-lan"
      label={i18n.t("command.compressShareOnLan")}
      title={
        canShare
          ? i18n.t("command.compressShareOnLan")
          : i18n.t("create.status.needsSources")
      }
      Icon={Share2}
      disabled={!canShare}
      onClick={() => actions.handleCreateIntent({ type: "compressAndShareOnLan" })}
    />
  );
}

function CompressTableToolbarButtons() {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();
  const i18n = translatorForSnapshot(snapshot);
  const create = snapshot.create;
  const tableInclusion = compressTableInclusionSummary(snapshot);

  if (snapshot.shell.activeMode !== "compress") {
    return null;
  }

  return (
    <>
      <ToolbarActionButton
        id="include-all-sources"
        label={i18n.t("compress.includeAll")}
        title={i18n.t("compress.includeAll")}
        Icon={CheckSquare}
        disabled={!tableInclusion.canInclude}
        onClick={() =>
          actions.handleCreateIntent({
            type: "setVisibleRowsIncluded",
            included: true,
          })
        }
      />
      <ToolbarActionButton
        id="exclude-all-sources"
        label={i18n.t("compress.excludeAll")}
        title={i18n.t("compress.excludeAll")}
        Icon={SquareMinus}
        disabled={!tableInclusion.canExclude}
        onClick={() =>
          actions.handleCreateIntent({
            type: "setVisibleRowsIncluded",
            included: false,
          })
        }
      />
      <ToolbarActionButton
        id="clear-sources"
        label={i18n.t("command.clearAllSources")}
        title={i18n.t("command.clearAllSources")}
        Icon={Trash2}
        disabled={create.isEmpty}
        onClick={() => actions.handleCreateIntent({ type: "clearSources" })}
      />
    </>
  );
}

function compressTableInclusionSummary(
  snapshot: ZManagerReactSnapshot,
): Readonly<{
  canInclude: boolean;
  canExclude: boolean;
}> {
  const currentPlan = snapshot.create.plan.current;
  const visibleRows = snapshot.create.view.rows.filter(
    (row) => row.rowType !== "parent",
  );
  if (!currentPlan || visibleRows.length === 0) {
    return { canInclude: false, canExclude: false };
  }

  let canInclude = false;
  let canExclude = false;
  for (const row of visibleRows) {
    const inclusion = createPlanRowInclusionState(
      row,
      currentPlan.planEntries,
      snapshot.create.inclusion.excludedArchivePaths,
    );
    if (inclusion !== "included") {
      canInclude = true;
    }
    if (inclusion !== "excluded") {
      canExclude = true;
    }
  }

  return { canInclude, canExclude };
}

function ToolbarActionButton({
  disabled,
  Icon,
  id,
  label,
  onClick,
  primary,
  title,
}: Readonly<{
  disabled?: boolean;
  Icon: LucideIcon;
  id: string;
  label: string;
  onClick(): void;
  primary?: boolean;
  title?: string;
}>) {
  return (
    <Button
      id={id}
      variant={primary ? "default" : "ghost"}
      size="sm"
      className={cn(
        "gap-1.5 h-8 px-2 text-xs",
        disabled && "opacity-50",
      )}
      type="button"
      title={title ?? label}
      aria-label={label}
      disabled={disabled}
      aria-disabled={disabled ? true : undefined}
      onClick={onClick}
    >
      <Icon className="size-[15px] opacity-90" aria-hidden="true" />
      <ToolbarLabel>{label}</ToolbarLabel>
    </Button>
  );
}

function ToolbarButton({ commandId }: Readonly<{ commandId: CommandId }>) {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();
  const state = commandStateFor(snapshot.commands.states, commandId);
  const Icon = commandIcon(commandId);
  const primary = snapshot.commands.primaryCommandIds.includes(commandId);
  const secondary = snapshot.commands.secondaryCommandIds.includes(commandId);
  const pressed = snapshot.commands.pressed[commandId];
  const label = toolbarCommandLabel(commandId, snapshot);
  return (
    <Button
      id={commandButtonId(commandId)}
      variant={primary ? "default" : "ghost"}
      size="sm"
      className={cn(
        "gap-1.5 h-8 px-2 text-xs",
        secondary && "text-slate-600 dark:text-slate-300",
        pressed && "bg-slate-200 dark:bg-slate-700",
      )}
      type="button"
      data-command-id={commandId}
      aria-label={label}
      title={
        state.reason && !state.enabled
          ? state.reason
          : localizedCommandTooltip(commandId, snapshot)
      }
      aria-keyshortcuts={commandShortcut(commandId)}
      aria-disabled={!state.enabled}
      aria-pressed={typeof pressed === "boolean" ? pressed : undefined}
      disabled={!state.enabled}
      onClick={(event) =>
        actions.executeCommand(
          commandId,
          toolbarCommandPayload(commandId, event.currentTarget),
        )
      }
    >
      <Icon className="size-[15px] opacity-90" aria-hidden="true" />
      <ToolbarLabel>{label}</ToolbarLabel>
    </Button>
  );
}

function ToolbarLabel({ children }: Readonly<{ children: string }>) {
  const snapshot = useZManagerSnapshot();
  return snapshot.preferences.showToolbarLabels ? (
    <span className="inline-flex">{children}</span>
  ) : null;
}

function toolbarCommandLabel(
  commandId: CommandId,
  snapshot: ZManagerReactSnapshot,
): string {
  const i18n = translatorForSnapshot(snapshot);

  if (snapshot.shell.activeMode === "extract") {
    if (commandId === "open") {
      return i18n.t("commands.openArchive");
    }

    if (commandId === "extract") {
      return i18n.t("extract.allAction");
    }
  }

  if (snapshot.shell.activeMode === "compress" && commandId === "add") {
    return i18n.t("compress.addSources");
  }

  return localizedCommandLabel(commandId, snapshot);
}

function createToolbarUnavailableText(snapshot: ZManagerReactSnapshot): string {
  const i18n = translatorForSnapshot(snapshot);
  const reason = snapshot.create.options.readiness.unavailableReason;

  switch (reason) {
    case "needsSources":
      return i18n.t("create.status.needsSources");
    case "needsIncludedEntries":
      return i18n.t("create.status.needsIncludedEntries");
    case "needsDestination":
      return i18n.t("create.status.needsDestination");
    case "planning":
      return i18n.t("create.status.planning");
    case "starting":
      return i18n.t("create.status.starting");
    case "needsPlan":
      return i18n.t("create.status.needsPlan");
    case "invalidSplitConfiguration":
      return i18n.t("create.status.invalidSplitConfiguration");
    case null:
      return i18n.t("compress.createArchive");
  }
}

function toolbarCommandPayload(
  commandId: CommandId,
  button: HTMLElement,
): CommandRouterPayload | undefined {
  if (commandId === "add") {
    const rect = button.getBoundingClientRect();

    return {
      addSourcesMenuAnchor: {
        x: rect.left,
        y: rect.bottom + 4,
      },
    };
  }

  if (commandId === "extract") {
    return { extractMode: "archive" };
  }

  return undefined;
}
