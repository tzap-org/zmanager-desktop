import { Laptop2, AlertTriangle } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useZManagerActions, useZManagerSnapshot } from "../AppProviders";
import { InventorySection } from "./InventorySection";

export function DeviceTab() {
  const fullSnapshot = useZManagerSnapshot();
  const snapshot = fullSnapshot.account;
  const actions = useZManagerActions();
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

        <div className="space-y-4 rounded-xl border border-amber-200 bg-amber-50/60 p-5 shadow-sm dark:border-amber-900/60 dark:bg-amber-950/30">
          <div className="flex items-start gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300">
              <AlertTriangle className="size-5" />
            </div>
            <div className="space-y-1">
              <strong className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                Retire Hosted Device
              </strong>
              <p className="text-[11px] leading-relaxed text-amber-900/90 dark:text-amber-200/90">
                Retiring a device revokes its signing identities on the TZAP server, which now
                requires a multi-factor verification step. The desktop app cannot perform that
                step yet, and a verification done elsewhere does not carry over to this app's
                session, so retirement lives in the hosted console for now.
              </p>
              <p className="text-[11px] leading-relaxed text-amber-900/90 dark:text-amber-200/90">
                Open <strong>Account → Devices</strong> in the hosted console to retire this
                device, then reopen this app to refresh its status. Archives, recipient keys, and
                local key material are unaffected either way.
              </p>
            </div>
          </div>

          {!canRetireHostedDevice ? (
            <p className="text-[11px] leading-relaxed text-amber-900/80 dark:text-amber-200/80">
              Hosted sign-in is still required before the console can retire this device.
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
