import { Laptop2, AlertTriangle } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useState } from "react";
import { useZManagerActions, useZManagerSnapshot } from "../AppProviders";
import { InventorySection } from "./InventorySection";

export function DeviceTab() {
  const fullSnapshot = useZManagerSnapshot();
  const snapshot = fullSnapshot.account;
  const actions = useZManagerActions();
  const [retirementConfirmationOpen, setRetirementConfirmationOpen] = useState(false);
  const hostedEnvironment = fullSnapshot.preferences.tzapEnvironment;
  const canRetireHostedDevice = snapshot.authStatus === "signedIn" && snapshot.capabilities.auth === "handoff_exchange";
  const isRetirementPending = snapshot.lifecycleOperation === "retireDevice"
    && (snapshot.lifecycleOutcome === "approval_required" || snapshot.lifecycleOutcome === "device_linkage_pending");
  const isRetirementIncomplete = snapshot.lifecycleOperation === "retireDevice" && snapshot.lifecycleOutcome === "incomplete";
  const isRetirementComplete = snapshot.lifecycleOperation === "retireDevice" && snapshot.lifecycleOutcome === "complete";
  const needsOrganizationSession = isRetirementIncomplete
    && snapshot.lifecycleIncompleteReasons.includes("organization_session_required");
  const needsSigningSession = isRetirementIncomplete
    && snapshot.lifecycleIncompleteReasons.includes("sign_session_required");

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
                ? "The server confirmed retirement. Affected signing certificates are now non-signing locally; archives, recipient keys, and local key material remain available."
                : "The server has not confirmed retirement for every affected device. Keep local signing records unchanged until approval or reconciliation confirms completion."}
            </p>
            {snapshot.lifecycleIncompleteReasons.length ? (
              <p className="mt-2 text-[11px]">
                Reasons: {snapshot.lifecycleIncompleteReasons.map(retirementReasonLabel).join(", ")}
              </p>
            ) : null}
            {needsOrganizationSession ? (
              <Button
                variant="secondary"
                size="sm"
                className="mt-3 h-7 text-[11px]"
                disabled={snapshot.busy}
                onClick={() => actions.handleAccountIntent({ type: "beginHostedAuth", environment: hostedEnvironment, audience: "login.tzap.org" })}
              >
                Sign in for organization retirement
              </Button>
            ) : null}
            {needsSigningSession ? (
              <Button
                variant="secondary"
                size="sm"
                className="mt-3 h-7 text-[11px]"
                disabled={snapshot.busy}
                onClick={() => actions.handleAccountIntent({ type: "beginHostedAuth", environment: hostedEnvironment, audience: "sign.tzap.org" })}
              >
                Sign in for signing operations
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              className={`${needsOrganizationSession || needsSigningSession ? "mt-2" : "mt-3"} h-7 text-[11px]`}
              disabled={snapshot.busy}
              onClick={() => actions.handleAccountIntent({ type: "forget" })}
            >
              Clear hosted session
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
                Retire Hosted Device
              </strong>
              <p className="text-[11px] leading-relaxed text-red-800/90 dark:text-red-300/90">
                This asks the TZAP server to revoke signing identities associated with this device. Archives, recipient keys, and local key material are preserved; approval or linkage checks may leave the operation incomplete.
              </p>
            </div>
          </div>

          {retirementConfirmationOpen ? (
            <div className="grid gap-3 rounded-lg border border-red-300 bg-red-100/70 p-3 text-xs text-red-950 dark:border-red-800 dark:bg-red-950/50 dark:text-red-100" role="alert">
              <strong>Retire this hosted device?</strong>
              <span className="text-[11px] leading-relaxed">This cannot be undone. Affected hosted signing certificates will stop signing; local key material and archives remain available.</span>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-7 text-[11px]"
                  disabled={snapshot.busy}
                  onClick={() => {
                    setRetirementConfirmationOpen(false);
                    actions.handleAccountIntent({ type: "retireDevice" });
                  }}
                >
                  Confirm Retire
                </Button>
                <Button variant="secondary" size="sm" className="h-7 text-[11px]" onClick={() => setRetirementConfirmationOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="destructive"
              className="w-full text-xs shadow"
              disabled={snapshot.busy || !canRetireHostedDevice}
              onClick={() => setRetirementConfirmationOpen(true)}
            >
              <Laptop2 className="mr-1.5 size-3.5" />
              {snapshot.busy ? "Retiring Hosted Device…" : canRetireHostedDevice ? "Retire Hosted Device" : "Sign in to retire device"}
            </Button>
          )}
          {!canRetireHostedDevice ? (
            <p className="text-[11px] leading-relaxed text-red-800/80 dark:text-red-300/80">
              Hosted sign-in is required before the server can retire this device.
            </p>
          ) : null}
        </div>
      </InventorySection>
    </div>
  );
}

function retirementReasonLabel(reason: string): string {
  switch (reason) {
    case "organization_session_required": return "organization sign-in required";
    case "sign_session_required": return "standard sign-in required";
    case "unsupported_session_audience": return "unsupported sign-in scope";
    default: return reason;
  }
}
