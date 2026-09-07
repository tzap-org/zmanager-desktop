import { RefreshCw, ExternalLink, ShieldCheck, LogOut, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useZManagerActions, useZManagerSnapshot } from "../AppProviders";

export function SessionStatus() {
  const fullSnapshot = useZManagerSnapshot();
  const snapshot = fullSnapshot.account;
  const actions = useZManagerActions();
  const hostedEnvironment = fullSnapshot.preferences.tzapEnvironment;

  const isSignedIn = snapshot.authStatus === "signedIn";
  const canLaunchHostedAuth = snapshot.capabilities.auth === "launch_only" || snapshot.capabilities.auth === "handoff_exchange";

  return (
    <div className="grid gap-5">
      {/* Session Banner Card */}
      <section className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50/50 p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/40">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`grid size-10 place-items-center rounded-xl ${
              isSignedIn
                ? "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400"
                : "bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400"
            }`}>
              {isSignedIn ? <CheckCircle2 className="size-5" /> : <ShieldCheck className="size-5" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {isSignedIn ? snapshot.displayName || "Signed In Account" : "Local / Offline Mode"}
                </span>
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                  isSignedIn
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300"
                    : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                }`}>
                  {isSignedIn ? "Online Session" : "Signed Out"}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {isSignedIn
                  ? `Authenticated session active. Level: ${snapshot.assuranceLevel || "basic"}`
                  : "Running locally. Local encryption and signing identities remain 100% operational offline."}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              className="bg-blue-600 text-white shadow hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500"
              disabled={snapshot.busy || !canLaunchHostedAuth}
              onClick={() =>
                actions.handleAccountIntent({ type: "beginHostedAuth", environment: hostedEnvironment })
              }
            >
              <ExternalLink className="mr-1.5 size-3.5" />
              {canLaunchHostedAuth ? "Sign In to Hosted Account" : "Sign In Unavailable"}
            </Button>

            <Button
              variant="secondary"
              className="border-slate-300 bg-white hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
              disabled={snapshot.busy}
              onClick={() => actions.handleAccountIntent({ type: "refresh" })}
            >
              <RefreshCw className={`mr-1.5 size-3.5 ${snapshot.busy ? "animate-spin" : ""}`} />
              Refresh
            </Button>

            {isSignedIn ? (
              <Button
                variant="ghost"
                className="text-slate-600 hover:bg-red-50 hover:text-red-700 dark:text-slate-400 dark:hover:bg-red-950/50 dark:hover:text-red-300"
                disabled={snapshot.busy}
                onClick={() => actions.handleAccountIntent({ type: "forget" })}
              >
                <LogOut className="mr-1.5 size-3.5" />
                Clear Session
              </Button>
            ) : null}
          </div>
        </div>

        {/* Offline Callout Banner when Signed Out */}
        {!isSignedIn ? (
          <div className="flex items-start gap-3 rounded-lg border border-blue-200/80 bg-blue-50/60 p-3.5 text-xs text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-blue-600 dark:text-blue-400" />
            <div className="space-y-1">
              <strong className="font-semibold">Local Storage Active</strong>
              <p className="leading-relaxed opacity-90">
                You do not need to sign in to create archives, generate P-256 device signing certificates, or encrypt archives with recipient keys. Hosted sign-in is needed for enrollment, renewal, device retirement, and contact sync. Archive verification can optionally check public certificate status when online; cached hosted identities can still sign offline.
              </p>
            </div>
          </div>
        ) : null}
      </section>

      {/* Capabilities Summary */}
      <section className="grid gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Account Capabilities
        </h3>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <CapabilityTile label="Authentication" value={snapshot.capabilities.auth} />
          <CapabilityTile label="Enrollment" value={snapshot.capabilities.enrollment} />
          <CapabilityTile label="Status" value={snapshot.capabilities.status} />
          <CapabilityTile label="Account Management" value={snapshot.capabilities.accountManagement} />
        </div>
      </section>
    </div>
  );
}

function CapabilityTile({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-xs dark:border-slate-800 dark:bg-slate-950">
      <span className="font-medium text-slate-600 dark:text-slate-400">{label}</span>
      <code className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-800 dark:bg-slate-900 dark:text-slate-200">
        {value.replaceAll("_", " ")}
      </code>
    </div>
  );
}
