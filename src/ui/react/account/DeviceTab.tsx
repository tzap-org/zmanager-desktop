import { Laptop2, AlertTriangle } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useZManagerActions, useZManagerSnapshot } from "../AppProviders";
import { InventorySection } from "./InventorySection";

export function DeviceTab() {
  const fullSnapshot = useZManagerSnapshot();
  const snapshot = fullSnapshot.account;
  const actions = useZManagerActions();
  const isRetirementPending = snapshot.lifecycleOperation === "retireDevice"
    && (snapshot.lifecycleOutcome === "approval_required" || snapshot.lifecycleOutcome === "device_linkage_pending");
  const isRetirementIncomplete = snapshot.lifecycleOperation === "retireDevice" && snapshot.lifecycleOutcome === "incomplete";
  const isRetirementComplete = snapshot.lifecycleOperation === "retireDevice" && snapshot.lifecycleOutcome === "complete";

  return (
    <div className="grid gap-6">
      <InventorySection
        title="Device Administration"
        icon={<Laptop2 className="size-4 text-red-600 dark:text-red-400" />}
        empty=""
      >
        {isRetirementPending || isRetirementIncomplete || isRetirementComplete ? (
          <div className={`rounded-xl border p-4 text-xs ${
            isRetirementComplete
              ? "border-emerald-200 bg-emerald-50/70 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100"
              : "border-amber-200 bg-amber-50/70 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100"
          }`} role="status">
            <strong className="font-semibold">
              {isRetirementComplete ? "Retirement completed" : isRetirementPending ? "Retirement pending approval" : "Retirement incomplete"}
            </strong>
            <p className="mt-1 text-[11px] leading-relaxed opacity-85">
              {isRetirementComplete
                ? "The server operation completed. Local cached identity material remains available for offline inspection until you clear the local session below."
                : "The server has not confirmed retirement for every affected device. Keep this result visible and refresh after approval or reconciliation."}
            </p>
            {snapshot.lifecycleIncompleteReasons.length ? (
              <p className="mt-2 text-[11px]">Reasons: {snapshot.lifecycleIncompleteReasons.join(", ")}</p>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              className="mt-3 h-7 text-[11px]"
              disabled={snapshot.busy}
              onClick={() => actions.handleAccountIntent({ type: "forget" })}
            >
              Clear local session cache
            </Button>
          </div>
        ) : null}

        <div className="space-y-4 rounded-xl border border-red-200 bg-red-50/50 p-5 shadow-sm dark:border-red-900/60 dark:bg-red-950/30">
          <div className="flex items-start gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-red-100 text-red-600 dark:bg-red-900/60 dark:text-red-400">
              <AlertTriangle className="size-5" />
            </div>
            <div className="space-y-1">
              <strong className="text-xs font-semibold text-red-900 dark:text-red-200">
                Retire Local Device &amp; Revoke Session
              </strong>
              <p className="text-[11px] leading-relaxed text-red-800/90 dark:text-red-300/90">
                Retiring this device notifies the central administration server to revoke device certificates and clears local identity catalog cache on this computer.
              </p>
            </div>
          </div>

          <Button
            variant="destructive"
            className="w-full text-xs shadow"
            disabled={snapshot.busy}
            onClick={() => {
              if (window.confirm("Are you sure you want to retire this device? This action cannot be undone.")) {
                actions.handleAccountIntent({ type: "retireDevice" });
              }
            }}
          >
            <Laptop2 className="mr-1.5 size-3.5" />
            {snapshot.busy ? "Retiring Device…" : "Retire Device"}
          </Button>
        </div>
      </InventorySection>
    </div>
  );
}
