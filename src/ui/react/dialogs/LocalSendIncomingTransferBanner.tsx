import { formatVolumeSize } from "../../../app/volumeSizePresets";
import { Button } from "../../components/ui/button";
import { useZManagerActions, useZManagerSnapshot } from "../AppProviders";
import { translatorForSnapshot } from "../shell/shellHelpers";

export function LocalSendIncomingTransferBanner() {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();
  const i18n = translatorForSnapshot(snapshot);
  const transfer = snapshot.localSendIncomingTransfers[0];

  if (!transfer) {
    return null;
  }

  const totalBytes = transfer.files.reduce((sum, file) => sum + file.size, 0);

  function respond(decision: "accept" | "decline") {
    actions.handleDialogIntent({
      type: "localSendIncomingRespond",
      requestId: transfer.requestId,
      decision,
    });
  }

  return (
    <div
      role="alertdialog"
      aria-labelledby="localsend-incoming-title"
      className="fixed right-4 top-4 z-[210] w-[min(380px,calc(100vw-32px))] rounded-xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900"
    >
      <h3 id="localsend-incoming-title" className="text-sm font-semibold">
        {i18n.t("localSendIncoming.title", { device: transfer.sender.alias })}
      </h3>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        {i18n.t("localSendIncoming.summary", {
          fileCount: transfer.files.length,
          size: formatVolumeSize(totalBytes),
        })}
      </p>
      <ul className="mt-2 max-h-24 space-y-0.5 overflow-y-auto text-xs">
        {transfer.files.map((file) => (
          <li key={file.id} className="truncate" title={file.fileName}>
            {file.fileName}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="dialog" size="unset" onClick={() => respond("decline")}>
          {i18n.t("localSendIncoming.decline")}
        </Button>
        <Button type="button" variant="dialogPrimary" size="unset" onClick={() => respond("accept")}>
          {i18n.t("localSendIncoming.accept")}
        </Button>
      </div>
    </div>
  );
}
