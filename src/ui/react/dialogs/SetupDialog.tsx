import { AlertCircle, CheckCircle2, ExternalLink } from "lucide-react";

import { Button } from "../../components/ui/button";
import { useZManagerActions, useZManagerSnapshot } from "../AppProviders";
import type { ZManagerDialogSnapshot } from "../appRuntime";
import type { ZManagerSetupStepRow } from "../../../app/display/dialogSnapshots";
import { translatorForSnapshot } from "../shell/shellHelpers";
import { DesktopDialog } from "./DesktopDialog";

/**
 * First-run checklist for the macOS shell integrations.
 *
 * macOS installs ZManager's extensions but leaves them switched off, and it
 * offers no notification when that happens — the Finder submenu simply is not
 * there. Someone who does not already know that macOS files the Finder
 * extension under "File Provider" has no way to find the switch. This dialog
 * exists to close that gap: it names the outstanding item, says which switch to
 * turn on, and opens the pane holding it.
 */
export function SetupDialog({
  dialog,
}: Readonly<{ dialog: Extract<ZManagerDialogSnapshot, { kind: "setup" }> }>) {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();
  const i18n = translatorForSnapshot(snapshot);

  return (
    <DesktopDialog
      titleId="setup-title"
      descriptionId="setup-description"
      widthClassName="w-[min(720px,calc(100vw-48px))]"
      header={
        <div className="flex items-start justify-between gap-5 border-b border-slate-200 px-6 py-5 dark:border-slate-800">
          <div>
            <h2 id="setup-title">{dialog.title}</h2>
            <p id="setup-description" className="text-sm text-slate-500 dark:text-slate-400">
              {dialog.description}
            </p>
          </div>
        </div>
      }
      content={
        <div className="bg-slate-50/40 px-6 py-5 dark:bg-slate-950">
          <ul className="grid gap-3">
            {dialog.steps.map((step) => (
              <SetupStep key={step.id} step={step} />
            ))}
          </ul>
        </div>
      }
      footer={
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4 dark:border-slate-800">
          <Button
            id="setup-dialog-recheck"
            variant="dialog"
            size="unset"
            type="button"
            onClick={() => actions.handleDialogIntent({ type: "setupRecheck" })}
          >
            {i18n.t("setup.recheck")}
          </Button>
          <Button
            id="setup-dialog-close"
            variant="dialog"
            size="unset"
            type="button"
            onClick={() => actions.handleDialogIntent({ type: "closeCurrent" })}
          >
            {dialog.complete ? i18n.t("setup.done") : i18n.t("setup.dismiss")}
          </Button>
        </div>
      }
      onEscape={() => actions.handleDialogIntent({ type: "closeCurrent" })}
    />
  );
}

function SetupStep({ step }: Readonly<{ step: ZManagerSetupStepRow }>) {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();
  const i18n = translatorForSnapshot(snapshot);
  const satisfied = step.state === "satisfied";

  return (
    <li
      data-setup-step={step.id}
      data-setup-state={step.state}
      className="grid gap-2 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex items-start gap-3">
        {satisfied
          ? <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          : <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-600" />}
        <div className="grid gap-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">{step.title}</h3>
            <span className="text-xs text-slate-500 dark:text-slate-400">{step.stateLabel}</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">{step.detail}</p>
          {step.instructions
            ? <p className="text-xs text-slate-700 dark:text-slate-300">{step.instructions}</p>
            : null}
        </div>
      </div>
      {!satisfied && step.settingsUrl
        ? (
          <div className="flex justify-end">
            <Button
              variant="dialog"
              size="unset"
              type="button"
              onClick={() => actions.handleDialogIntent({ type: "setupOpenSettings" })}
            >
              <ExternalLink aria-hidden className="size-3.5" />
              {i18n.t("setup.openSettings")}
            </Button>
          </div>
        )
        : null}
    </li>
  );
}
