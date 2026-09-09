import type { NativeInboundHostedAuthEvent } from "../../api/generated/nativeInboundEvents.generated";
import type {
  AccountContactCardPreviewDto,
  AccountHostedAuthLaunchDto,
  AccountHostedAuthAudience,
  AccountContactSyncResultDto,
  AccountInstallSigningCertificateRequest,
  AccountLifecycleResultDto,
  AccountSnapshotDto,
  AccountCurrentUserDto,
} from "../../api/types";
import type { AccountWorkspace } from "../workspaces/accountWorkspace";

import type { DiagnosticRecorder } from "../diagnostics";

export type AccountControllerOptions = Readonly<{
  workspace: AccountWorkspace;
  fetchSnapshot(): Promise<AccountSnapshotDto>;
  beginHostedAuth(environment: string, audience?: AccountHostedAuthAudience): Promise<AccountHostedAuthLaunchDto>;
  applyHostedCallback(payload: NativeInboundHostedAuthEvent["payload"]): Promise<void>;
  completeHostedAuth(state: string, handoffCode: string, callbackUrl?: string): Promise<AccountSnapshotDto>;
  fetchCurrentUser(): Promise<AccountCurrentUserDto>;
  enrollDeviceCertificate(): Promise<AccountSnapshotDto | AccountLifecycleResultDto>;
  renewCertificate(certificateId: string): Promise<AccountSnapshotDto | AccountLifecycleResultDto>;
  retireDevice(): Promise<AccountSnapshotDto | AccountLifecycleResultDto>;
  forget(): Promise<AccountSnapshotDto>;
  generateRecipientKey(label?: string): Promise<AccountSnapshotDto>;
  generateSigningIdentity(commonName: string, label?: string): Promise<AccountSnapshotDto>;
  importSigningIdentity(identityPath: string, password: string, label?: string): Promise<AccountSnapshotDto>;
  installSigningCertificate(request: AccountInstallSigningCertificateRequest): Promise<AccountSnapshotDto>;
  createSelfSignedCertificateStore(commonName: string): Promise<AccountSnapshotDto>;
  removeSigningIdentity(id: string): Promise<AccountSnapshotDto>;
  removeRecipientKey(id: string): Promise<AccountSnapshotDto>;
  setDefaultSigningIdentity(id: string): Promise<AccountSnapshotDto>;
  removeContact(id: string): Promise<AccountSnapshotDto>;
  inspectContactCard(contactCard: Record<string, unknown>): Promise<AccountContactCardPreviewDto>;
  acceptContactCard(contactCard: Record<string, unknown>): Promise<AccountSnapshotDto>;
  syncContacts(): Promise<AccountSnapshotDto | AccountContactSyncResultDto>;
  openUrl(url: string): Promise<void>;
  publish(): void;
  errorMessage(error: unknown): string;
  diagnostics?: DiagnosticRecorder;
}>;

export type AccountController = ReturnType<typeof createAccountController>;

type AccountMutationResult = AccountSnapshotDto | AccountLifecycleResultDto | AccountContactSyncResultDto;

function isResultWithSnapshot(result: AccountMutationResult): result is AccountLifecycleResultDto | AccountContactSyncResultDto {
  return "snapshot" in result;
}

function isLifecycleResult(result: AccountMutationResult): result is AccountLifecycleResultDto {
  return "snapshot" in result && "outcome" in result;
}

function isContactSyncResult(result: AccountMutationResult): result is AccountContactSyncResultDto {
  return "snapshot" in result && "counts" in result;
}

function resultNotice(result: AccountLifecycleResultDto | AccountContactSyncResultDto): string {
  if ("counts" in result) {
    const { imported, updated, removed, rejected, statusRefreshFailed } = result.counts;
    return `Contacts synced: ${imported} imported, ${updated} updated, ${removed} removed, ${rejected} rejected${statusRefreshFailed ? `, ${statusRefreshFailed} status checks unavailable` : ""}.`;
  }
  switch (result.outcome) {
    case "complete": return "Account operation completed.";
    case "approval_required": return "The operation is waiting for device approval.";
    case "device_linkage_pending": return "Device linkage is pending.";
    case "device_linkage_conflict": return "Device linkage needs account attention.";
    case "incomplete": return "The operation is incomplete; review the affected devices.";
    default: return `Account operation: ${result.outcome}.`;
  }
}

function isUnauthorizedError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "unauthorized";
}

export function createAccountController(options: AccountControllerOptions) {
  async function run(operation: () => Promise<AccountMutationResult>, actionName = "operation"): Promise<void> {
    const startMs = Date.now();
    options.workspace.setBusy(true);
    options.publish();
    try {
      const result = await operation();
      options.workspace.replace(isResultWithSnapshot(result) ? result.snapshot : result);
      options.workspace.setNotice(isResultWithSnapshot(result) ? resultNotice(result) : "");
      if (isLifecycleResult(result)) {
        options.workspace.setLifecycleResult(actionName, result.outcome, result.incompleteReasons);
      } else {
        options.workspace.clearLifecycleResult();
      }
      if (isContactSyncResult(result)) options.workspace.setContactSyncResult(result);
      options.diagnostics?.record({
        scope: "account",
        name: `${actionName}Completed`,
        fields: { elapsedMs: Date.now() - startMs },
      });
    } catch (error) {
      if (isUnauthorizedError(error)) {
        try {
          options.workspace.replace(await options.fetchSnapshot());
        } catch {
          // Keep the existing snapshot if refreshing after expiry is unavailable.
        }
        options.workspace.setNotice("Session expired. Please sign in again.");
      } else {
        options.workspace.setNotice(options.errorMessage(error));
      }
      options.diagnostics?.record({
        scope: "account",
        name: `${actionName}Failed`,
        fields: { elapsedMs: Date.now() - startMs },
      });
    } finally {
      options.workspace.setBusy(false);
      options.publish();
    }
  }

  return {
    refresh: () => run(options.fetchSnapshot, "refreshSnapshot"),
    async open() {
      const startMs = Date.now();
      options.diagnostics?.record({ scope: "account", name: "openRequested" });
      options.workspace.open();
      options.publish();
      await run(options.fetchSnapshot, "openSnapshot");
      options.diagnostics?.record({
        scope: "account",
        name: "openCompleted",
        fields: { elapsedMs: Date.now() - startMs },
      });
    },
    close() { options.workspace.close(); options.publish(); },
    async beginHostedAuth(environment = "prod", audience: AccountHostedAuthAudience = "sign.tzap.org") {
      options.workspace.setBusy(true); options.publish();
      options.diagnostics?.record({
        scope: "account",
        name: "hostedAuthLaunchRequested",
        fields: { environment, audience },
      });
      try {
        const launch = await options.beginHostedAuth(environment, audience);
        const launchUrl = new URL(launch.launchUrl);
        options.diagnostics?.record({
          scope: "account",
          name: "hostedAuthLaunchPrepared",
          fields: { origin: launchUrl.origin, path: launchUrl.pathname },
        });
        await options.openUrl(launch.launchUrl);
        options.diagnostics?.record({
          scope: "account",
          name: "hostedAuthLaunchOpened",
          fields: { origin: launchUrl.origin, path: launchUrl.pathname },
        });
        options.workspace.setNotice("Hosted sign-in is pending.");
        options.workspace.replace(await options.fetchSnapshot());
      } catch (error) {
        const diagnosticMessage = options.errorMessage(error)
          .replace(/https?:\/\/[^\s]+/gu, "<url>")
          .replace(/([?&][A-Za-z0-9_.~-]+=)[^&\s]*/gu, "$1<redacted>")
          .slice(0, 160);
        options.diagnostics?.record({
          scope: "account",
          name: "hostedAuthLaunchFailed",
          fields: {
            errorType: error instanceof Error ? error.constructor.name : "unknown",
            errorMessage: diagnosticMessage,
          },
        });
        options.workspace.setNotice(options.errorMessage(error));
      } finally { options.workspace.setBusy(false); options.publish(); }
    },
    async handleHostedCallback(payload: NativeInboundHostedAuthEvent["payload"]) {
      options.workspace.setBusy(true); options.publish();
      try {
        if (payload.result === "completed" && payload.handoffCode) {
          options.workspace.replace(
            await options.completeHostedAuth(payload.state, payload.handoffCode, payload.callbackUrl)
          );
          options.workspace.setNotice("Hosted sign-in completed.");
        } else {
          await options.applyHostedCallback(payload);
          options.workspace.replace(await options.fetchSnapshot());
          options.workspace.setNotice(`Hosted sign-in ${payload.result}.`);
        }
      } catch (error) {
        options.workspace.setNotice(options.errorMessage(error));
      } finally { options.workspace.setBusy(false); options.publish(); }
    },
    async handleFetchUser() {
      options.workspace.setBusy(true); options.publish();
      try {
        await options.fetchCurrentUser();
        options.workspace.replace(await options.fetchSnapshot());
      } catch (error) {
        if (isUnauthorizedError(error)) {
          options.workspace.replace(await options.fetchSnapshot());
          options.workspace.setNotice("Session expired. Please sign in again.");
        } else {
          options.workspace.setNotice(options.errorMessage(error));
        }
      } finally { options.workspace.setBusy(false); options.publish(); }
    },
    handleEnroll: () => run(options.enrollDeviceCertificate, "enrollCertificate"),
    handleRenew: (certificateId: string) => run(() => options.renewCertificate(certificateId), "renewCertificate"),
    handleDeviceRetire: () => run(options.retireDevice, "retireDevice"),
    forget: () => run(options.forget),
    generateRecipientKey: (label?: string) => run(() => options.generateRecipientKey(label)),
    generateSigningIdentity: (commonName: string, label?: string) => run(() => options.generateSigningIdentity(commonName, label)),
    importSigningIdentity: (identityPath: string, password: string, label?: string) =>
      run(() => options.importSigningIdentity(identityPath, password, label)),
    installSigningCertificate: (request: AccountInstallSigningCertificateRequest) =>
      run(() => options.installSigningCertificate(request)),
    createSelfSignedCertificateStore: (commonName: string) =>
      run(() => options.createSelfSignedCertificateStore(commonName)),
    removeSigningIdentity: (id: string) => run(() => options.removeSigningIdentity(id)),
    removeRecipientKey: (id: string) => run(() => options.removeRecipientKey(id)),
    setDefaultSigningIdentity: (id: string) => run(() => options.setDefaultSigningIdentity(id)),
    removeContact: (id: string) => run(() => options.removeContact(id)),
    async inspectContactCard(contactCard: Record<string, unknown>) {
      options.workspace.setBusy(true); options.publish();
      try {
        options.workspace.setContactCardPreview(await options.inspectContactCard(contactCard));
        options.workspace.setNotice("Contact card verified. Review it before accepting.");
      } catch (error) {
        options.workspace.setContactCardPreview(null);
        options.workspace.setNotice(options.errorMessage(error));
      } finally { options.workspace.setBusy(false); options.publish(); }
    },
    async acceptContactCard(contactCard: Record<string, unknown>) {
      await run(options.acceptContactCard.bind(null, contactCard));
      options.workspace.setContactCardPreview(null);
      options.publish();
    },
    syncContacts: () => run(options.syncContacts, "syncContacts"),
  };
}
