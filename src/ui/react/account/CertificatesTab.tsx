import { ShieldCheck, Plus, FileUp, Key, Trash2, CheckCircle, Award, RefreshCw, ExternalLink } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useZManagerActions, useZManagerSnapshot } from "../AppProviders";
import { useState } from "react";
import { InventorySection } from "./InventorySection";

export function CertificatesTab() {
  const fullSnapshot = useZManagerSnapshot();
  const snapshot = fullSnapshot.account;
  const preferences = fullSnapshot.preferences;
  const actions = useZManagerActions();
  const hostedEnvironment = preferences.tzapEnvironment;
  const isSignedIn = snapshot.authStatus === "signedIn";

  const [identityName, setIdentityName] = useState("TZAP Signing Identity");
  const [identityImportLabel, setIdentityImportLabel] = useState("");
  const [identityImportPassword, setIdentityImportPassword] = useState("");
  const [identityPendingRemoval, setIdentityPendingRemoval] = useState<string | null>(null);
  const hostedCertificates = snapshot.certificates.filter((certificate) => certificate.identityType === "hosted" && certificate.state === "active");
  const canManageHostedCertificates = snapshot.authStatus === "signedIn" && snapshot.capabilities.enrollment === "available";
  const canLaunchHostedAuth = snapshot.capabilities.auth === "launch_only" || snapshot.capabilities.auth === "handoff_exchange";
  const showHostedAuthAction = hostedCertificates.length === 0 || (!isSignedIn && canLaunchHostedAuth);
  const formatExpiry = (unixSeconds: number) => unixSeconds > 0
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(unixSeconds * 1000))
    : "Unknown";

  return (
    <div className="grid gap-6">
      <InventorySection
        title="Signing Identities & Certificates"
        icon={<ShieldCheck className="size-4 text-blue-600 dark:text-blue-400" />}
        empty="No local signing certificates found."
      >
        <section className="grid gap-3 rounded-xl border border-blue-200 bg-blue-50/60 p-4 dark:border-blue-900/60 dark:bg-blue-950/30">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <strong className="text-xs font-semibold text-blue-950 dark:text-blue-100">
                Hosted certificate
              </strong>
              <p className="text-[11px] leading-relaxed text-blue-900/80 dark:text-blue-200/80">
                Hosted certificates are account-backed and remain usable offline while their cached certificate is valid. A fresh sign-in is required for enrollment and renewal.
              </p>
            </div>
            {showHostedAuthAction ? (
              <Button
                className="shrink-0 bg-blue-600 text-xs text-white shadow hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500"
                disabled={snapshot.busy || (!canManageHostedCertificates && !canLaunchHostedAuth)}
                onClick={() => canManageHostedCertificates
                  ? actions.handleAccountIntent({ type: "enrollCertificate" })
                  : actions.handleAccountIntent({ type: "beginHostedAuth", environment: hostedEnvironment })}
              >
                {canManageHostedCertificates ? <Award className="mr-1.5 size-3.5" /> : <ExternalLink className="mr-1.5 size-3.5" />}
                {canManageHostedCertificates ? "Enroll this device" : canLaunchHostedAuth
                  ? hostedCertificates.length > 0 ? "Sign in to manage" : "Sign in to enroll"
                  : "Hosted enrollment unavailable"}
              </Button>
            ) : null}
          </div>
          {hostedCertificates.length === 0 ? (
            <p className="text-[11px] font-medium text-blue-800 dark:text-blue-200">
              {canManageHostedCertificates
                ? "No active hosted identity is enrolled on this device."
                : canLaunchHostedAuth
                  ? "Enrollment is unavailable until the hosted session is active."
                  : "Hosted enrollment is unavailable until the hosted-auth security and OAuth registration gates are approved."}
            </p>
          ) : !isSignedIn && canLaunchHostedAuth ? (
            <p className="text-[11px] font-medium text-blue-800 dark:text-blue-200">
              Sign in to manage or renew the hosted identity on this device.
            </p>
          ) : null}
        </section>

        {/* Creation & Import Panel */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Create Self-Signed Identity Card */}
          <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/60 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/40">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="grid size-7 place-items-center rounded-lg bg-blue-600/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400">
                  <Plus className="size-4" />
                </div>
                <strong className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Create local self-signed identity
                </strong>
              </div>
              <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                Generates a P-256 key pair. The private key remains secured in native storage and the public certificate is cataloged locally.
              </p>
            </div>
            
            <div className="mt-4 space-y-3">
              <label className="grid gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
                Common Name
                <Input
                  className="h-8 text-xs"
                  placeholder="e.g. Personal Signing Key"
                  value={identityName}
                  onChange={(event) => setIdentityName(event.currentTarget.value)}
                />
              </label>
              <Button
                className="w-full bg-blue-600 text-xs text-white shadow hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500"
                disabled={snapshot.busy || !identityName.trim()}
                onClick={() => {
                  actions.handleAccountIntent({
                    type: "createSelfSignedCertificateStore",
                    commonName: identityName,
                  });
                }}
              >
                <Plus className="mr-1.5 size-3.5" />
                {snapshot.busy ? "Creating…" : "Create identity"}
              </Button>
            </div>
          </div>

          {/* Import P12/PFX Identity Card */}
          <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/60 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/40">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="grid size-7 place-items-center rounded-lg bg-purple-600/10 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400">
                  <FileUp className="size-4" />
                </div>
                <strong className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Import existing P12/PFX identity
                </strong>
              </div>
              <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                Imports a PKCS#12 certificate bundle into the native secure store and registers the certificate chain.
              </p>
            </div>

            <div className="mt-4 space-y-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  className="h-8 text-xs"
                  placeholder="Label (optional)"
                  value={identityImportLabel}
                  onChange={(event) => setIdentityImportLabel(event.currentTarget.value)}
                />
                <Input
                  className="h-8 text-xs"
                  type="password"
                  placeholder="Password (optional)"
                  value={identityImportPassword}
                  onChange={(event) => setIdentityImportPassword(event.currentTarget.value)}
                  autoComplete="off"
                />
              </div>
              <Button
                variant="secondary"
                className="w-full border-slate-300 bg-white text-xs hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
                disabled={snapshot.busy}
                onClick={() => {
                  actions.handleAccountIntent({
                    type: "importSigningIdentity",
                    password: identityImportPassword,
                    label: identityImportLabel || undefined,
                  });
                  setIdentityImportPassword("");
                }}
              >
                <FileUp className="mr-1.5 size-3.5 text-slate-600 dark:text-slate-400" />
                {snapshot.busy ? "Importing…" : "Choose P12/PFX File"}
              </Button>
            </div>
          </div>
        </div>

        {/* Existing Certificates List */}
        <div className="mt-4 space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Cataloged Identities ({snapshot.certificates.length})
          </h4>

          {snapshot.certificates.map((certificate) => {
            const tzapDefaults = preferences.createFormatDefaults.tzap;
            const isDirectGlobalDefault = tzapDefaults.tzapSigningDefault === "identity" && tzapDefaults.tzapDefaultSigningIdentityId === certificate.identityId;
            const isAccountDefault = snapshot.defaultSigningIdentityId === certificate.identityId;
            const isUsedInGlobalDefaults = isDirectGlobalDefault || (tzapDefaults.tzapSigningDefault === "accountDefault" && isAccountDefault);

            return (
              <article
                className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all dark:border-slate-800 dark:bg-slate-950"
                key={certificate.identityId}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="grid size-8 place-items-center rounded-lg bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300">
                      <Key className="size-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <strong className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                          {certificate.label || certificate.identityId}
                        </strong>
                        {isAccountDefault ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-800 dark:bg-blue-950/80 dark:text-blue-300">
                            <CheckCircle className="size-3" />
                            Default Identity
                          </span>
                        ) : null}
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-900 dark:text-slate-400">
                          {certificate.identityType}
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        {certificate.certificateId}
                      </span>
                    </div>
                  </div>

                  {/* Actions Group */}
                  <div className="flex items-center gap-2">
                    {!isAccountDefault ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-7 text-[11px]"
                        disabled={snapshot.busy || certificate.state !== "active"}
                        onClick={() => actions.handleAccountIntent({ type: "setDefaultSigningIdentity", id: certificate.identityId })}
                      >
                        Set as Default
                      </Button>
                    ) : null}

                    {identityPendingRemoval !== certificate.identityId ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-[11px] text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/50"
                        disabled={snapshot.busy}
                        onClick={() => setIdentityPendingRemoval(certificate.identityId)}
                      >
                        <Trash2 className="mr-1 size-3" />
                        Delete identity
                      </Button>
                    ) : null}
                  </div>
                </div>

                {/* Fingerprint Box */}
                <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-900/60">
                  <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
                    <span>SHA-256 Fingerprint</span>
                    <span>State: {certificate.state}</span>
                  </div>
                  <code className="mt-1 block truncate font-mono text-[11px] text-slate-700 dark:text-slate-300">
                    {certificate.certificateSha256}
                  </code>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                    <span>Expires {formatExpiry(certificate.notAfterUnixSeconds)}</span>
                    <span>{certificate.assuranceLevel}</span>
                  </div>
                </div>

                {certificate.identityType === "hosted" && certificate.renewalRecommended ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
                    <span className="text-[11px] font-medium">Renewal recommended before this certificate expires.</span>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-7 text-[11px]"
                      disabled={snapshot.busy || certificate.state !== "active" || (!canManageHostedCertificates && !canLaunchHostedAuth)}
                      onClick={() => canManageHostedCertificates
                        ? actions.handleAccountIntent({ type: "renewCertificate", certificateId: certificate.certificateId })
                        : actions.handleAccountIntent({ type: "beginHostedAuth", environment: hostedEnvironment })}
                    >
                      <RefreshCw className="mr-1 size-3" />
                      {canManageHostedCertificates ? "Renew certificate" : "Sign in to renew"}
                    </Button>
                  </div>
                ) : null}

                {/* Delete Confirmation Card */}
                {identityPendingRemoval === certificate.identityId ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50/80 p-3 text-xs text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
                    <span className="flex-1 text-[11px]">
                      {isUsedInGlobalDefaults
                        ? "This identity is currently set as your default in Global Options. Deleting it will reset Global Options to 'No signature'."
                        : "Removes this private key from native secure storage and catalog."}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-7 text-[11px]"
                        disabled={snapshot.busy}
                        onClick={() => {
                          actions.handleAccountIntent({ type: "removeSigningIdentity", id: certificate.identityId });
                          if (isUsedInGlobalDefaults) {
                            actions.handleDialogIntent({
                              type: "preferencesSaveDirectPatch",
                              patch: {
                                createFormatDefaults: {
                                  ...preferences.createFormatDefaults,
                                  tzap: {
                                    ...tzapDefaults,
                                    tzapSigningDefault: "none",
                                    tzapDefaultSigningIdentityId: null,
                                  },
                                },
                              },
                            });
                          }
                          setIdentityPendingRemoval(null);
                        }}
                      >
                        Confirm Delete
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-[11px]"
                        onClick={() => setIdentityPendingRemoval(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </InventorySection>
    </div>
  );
}
