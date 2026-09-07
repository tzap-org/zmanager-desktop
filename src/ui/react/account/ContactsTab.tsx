import { UserRound, Trash2, ShieldCheck, KeyRound, Plus, UserCheck, RefreshCw, Smartphone } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { useZManagerActions, useZManagerSnapshot } from "../AppProviders";
import { useState } from "react";
import { InventorySection } from "./InventorySection";

export function ContactsTab() {
  const fullSnapshot = useZManagerSnapshot();
  const snapshot = fullSnapshot.account;
  const actions = useZManagerActions();
  const hostedEnvironment = fullSnapshot.preferences.tzapEnvironment;

  const [contactCardText, setContactCardText] = useState("");
  const [verifiedContactCardText, setVerifiedContactCardText] = useState("");

  const activeRecipientKeys = snapshot.recipientKeys.filter((key) => key.lifecycle === "active");
  const retiredRecipientKeys = snapshot.recipientKeys.filter((key) => key.lifecycle === "retired");
  const isSignedIn = snapshot.authStatus === "signedIn";
  const canLaunchHostedAuth = snapshot.capabilities.auth === "launch_only" || snapshot.capabilities.auth === "handoff_exchange";
  const syncCounts = snapshot.contactSyncCounts;
  const syncStatus = syncCounts?.statusRefreshFailed
    ? `${syncCounts.statusRefreshFailed} status checks unavailable`
    : "Current certificate status available when online";
  const lastSync = snapshot.lastContactSyncAt
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(snapshot.lastContactSyncAt * 1000))
    : "Not synced yet";

  return (
    <div className="grid gap-6">
      {/* Recipient Keys Section */}
      <InventorySection
        title="Your Recipient Encryption Keys"
        icon={<KeyRound className="size-4 text-emerald-600 dark:text-emerald-400" />}
        empty="No recipient encryption keys found."
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Recipient keys allow others to encrypt archives specifically for your device.
          </p>
          <Button
            className="bg-emerald-600 text-xs text-white shadow hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            disabled={snapshot.busy}
            onClick={() =>
              actions.handleAccountIntent({
                type: "generateRecipientKey",
                label: "Personal share key",
              })
            }
          >
            <Plus className="mr-1.5 size-3.5" />
            Generate Key
          </Button>
        </div>

        <div className="grid gap-2 rounded-lg border border-slate-200/80 bg-slate-50/70 p-3 text-[11px] dark:border-slate-800/80 dark:bg-slate-900/30">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-slate-700 dark:text-slate-300">Last successful sync</span>
            <span className="text-slate-500 dark:text-slate-400">{lastSync}</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-slate-700 dark:text-slate-300">Status refresh</span>
            <span className={syncCounts?.statusRefreshFailed ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}>{syncStatus}</span>
          </div>
          {syncCounts ? (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-slate-500 dark:text-slate-400">
              <span>{syncCounts.imported} imported</span>
              <span>{syncCounts.updated} updated</span>
              <span>{syncCounts.removed} removed locally</span>
              <span>{syncCounts.rejected} rejected</span>
              {syncCounts.rejectedReasons.length ? <span>({syncCounts.rejectedReasons.join(", ")})</span> : null}
            </div>
          ) : null}
          <p className="leading-relaxed text-slate-500 dark:text-slate-400">
            Removing a contact here only removes this desktop copy. Remove it on the phone to change the source snapshot globally.
          </p>
        </div>

        {/* Active Keys List */}
        <div className="mt-3 space-y-3">
          {activeRecipientKeys.map((key) => (
            <article
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950"
              key={key.keyId}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <strong className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {key.label || key.keyId}
                  </strong>
                  <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300">
                    Active
                  </span>
                </div>
                <code className="block truncate font-mono text-[11px] text-slate-600 dark:text-slate-400">
                  {key.publicKeyFingerprint}
                </code>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-slate-500 hover:bg-red-50 hover:text-red-700 dark:text-slate-400 dark:hover:bg-red-950/50 dark:hover:text-red-300"
                aria-label={`Retire ${key.label || key.keyId}`}
                disabled={snapshot.busy}
                onClick={() =>
                  actions.handleAccountIntent({
                    type: "removeRecipientKey",
                    id: key.keyId,
                  })
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </article>
          ))}
          {!activeRecipientKeys.length ? (
            <p className="text-xs italic text-slate-500 dark:text-slate-400">No active recipient keys.</p>
          ) : null}
        </div>

        {/* Retired Keys Section */}
        {retiredRecipientKeys.length ? (
          <div className="mt-4 space-y-2.5 rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 dark:border-slate-800/80 dark:bg-slate-900/30">
            <strong className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Retired recipient keys ({retiredRecipientKeys.length})
            </strong>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Retired keys remain available for decrypting existing archives but are not offered for new archives.
            </p>
            {retiredRecipientKeys.map((key) => (
              <div
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950 opacity-75"
                key={key.keyId}
              >
                <div className="min-w-0 flex-1">
                  <strong className="text-xs text-slate-800 dark:text-slate-200">{key.label || key.keyId}</strong>
                  <code className="block truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
                    {key.publicKeyFingerprint}
                  </code>
                </div>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-900 dark:text-slate-400">
                  Retired
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/50"
                  aria-label={`Permanently delete ${key.label || key.keyId}`}
                  disabled={snapshot.busy}
                  onClick={() =>
                    actions.handleAccountIntent({
                      type: "removeRecipientKey",
                      id: key.keyId,
                    })
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </InventorySection>

      {/* Trusted Contacts Section */}
      <InventorySection
        title="Trusted Contacts"
        icon={<UserCheck className="size-4 text-blue-600 dark:text-blue-400" />}
        empty="No trusted contacts added yet."
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Contacts synced from your phone or verified via contact card.
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="h-8 text-xs shadow-sm"
            disabled={snapshot.busy || (!isSignedIn && !canLaunchHostedAuth)}
            onClick={() => actions.handleAccountIntent(
              isSignedIn
                ? { type: "syncContacts" }
                : { type: "beginHostedAuth", environment: hostedEnvironment },
            )}
          >
            <RefreshCw className={`mr-1.5 size-3.5 ${snapshot.busy ? "animate-spin" : ""}`} />
            {isSignedIn ? "Download from Phone" : canLaunchHostedAuth ? "Sign in to sync contacts" : "Contact sync unavailable"}
          </Button>
        </div>

        <div className="mt-3 space-y-3">
          {snapshot.contacts.map((contact) => (
            <article
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950"
              key={contact.contactId}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="grid size-8 place-items-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
                  <UserRound className="size-4" />
                </div>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <strong className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {contact.displayName}
                    </strong>
                    {contact.phoneSourced ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-800 dark:bg-blue-950/80 dark:text-blue-300">
                        <Smartphone className="size-2.5" />
                        From Phone
                      </span>
                    ) : null}
                  </div>
                  <code className="block truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
                    {contact.recipientPublicKeyFingerprint}
                  </code>
                  <p className={`text-[10px] ${contact.verificationState === "valid_now" ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>
                    {contactTrustLabel(contact.verificationState)}
                    {contact.missingStatusCaveat ? " — current server status was not established" : ""}
                  </p>
                  {contact.phoneSourced ? (
                    <p className="text-[10px] text-slate-400 dark:text-slate-500">
                      Removed here; remove it on your phone to remove it everywhere.
                    </p>
                  ) : null}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-slate-500 hover:bg-red-50 hover:text-red-700 dark:text-slate-400 dark:hover:bg-red-950/50 dark:hover:text-red-300"
                aria-label={
                  contact.phoneSourced
                    ? `Remove ${contact.displayName} (removed here; remove it on your phone to remove it everywhere)`
                    : `Remove ${contact.displayName}`
                }
                title={
                  contact.phoneSourced
                    ? "Removed here; remove it on your phone to remove it everywhere."
                    : `Remove ${contact.displayName}`
                }
                disabled={snapshot.busy}
                onClick={() =>
                  actions.handleAccountIntent({
                    type: "removeContact",
                    id: contact.contactId,
                  })
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </article>
          ))}
        </div>

        {/* Verification Card */}
        <div className="mt-3 space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/40">
          <label className="grid gap-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100" htmlFor="contact-card-input">
            Verify &amp; Add Contact Card
            <Textarea
              id="contact-card-input"
              className="min-h-20 text-[11px] font-mono leading-relaxed"
              placeholder="Paste the signed contact-card JSON envelope"
              value={contactCardText}
              onChange={(event) => {
                setContactCardText(event.currentTarget.value);
                setVerifiedContactCardText("");
              }}
            />
          </label>
          
          <Button
            variant="secondary"
            className="border-slate-300 bg-white text-xs hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
            disabled={snapshot.busy || !contactCardText.trim()}
            onClick={() => {
              setVerifiedContactCardText(contactCardText);
              actions.handleAccountIntent({ type: "inspectContactCard", contactCard: contactCardText });
            }}
          >
            <ShieldCheck className="mr-1.5 size-3.5 text-blue-600 dark:text-blue-400" />
            Verify Contact Card
          </Button>

          {snapshot.contactCardPreview ? (
            <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/80 p-3.5 text-xs text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
              <div className="flex items-center justify-between">
                <strong className="font-semibold">{snapshot.contactCardPreview.displayName}</strong>
                <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                  {snapshot.contactCardPreview.verificationState}
                </span>
              </div>
              <code className="block truncate font-mono text-[11px]">
                {snapshot.contactCardPreview.recipientPublicKeyFingerprint}
              </code>
              <Button
                className="mt-2 w-full bg-emerald-600 text-xs text-white shadow hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                disabled={snapshot.busy || verifiedContactCardText !== contactCardText}
                onClick={() => actions.handleAccountIntent({ type: "acceptContactCard", contactCard: contactCardText })}
              >
                Accept as Trusted Contact
              </Button>
            </div>
          ) : null}
        </div>
      </InventorySection>

    </div>
  );
}

function contactTrustLabel(verificationState: string): string {
  switch (verificationState) {
    case "valid_now": return "Verified now";
    case "valid_at_trusted_time": return "Verified with trusted-time caveat";
    case "cryptographically_intact_offline": return "Verified offline";
    case "revoked": return "Revoked";
    case "suspended": return "Suspended";
    case "status_expired": return "Expired";
    case "status_unavailable": return "Status unavailable";
    case "status_mismatch": return "Status unavailable";
    case "invalid": return "Invalid contact card";
    default: return verificationState || "Verification unavailable";
  }
}
