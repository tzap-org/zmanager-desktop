import { beforeEach, describe, expect, it, vi } from "vitest";

import rustMainSource from "../../src-tauri/src/main.rs?raw";
import * as api from "./commands";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

const COMMAND_WRAPPERS = [
  { command: "healthcheck", call: () => api.fetchHealthcheck() },
  { command: "project_contract", call: () => api.fetchProjectContract() },
  {
    command: "system_file_icons",
    request: { entries: [{ key: "root", path: "C:/demo/root.txt", isDirectory: false }] },
    call: () => api.fetchSystemFileIcons({ entries: [{ key: "root", path: "C:/demo/root.txt", isDirectory: false }] }),
  },
  { command: "default_handler_status", call: () => api.fetchDefaultHandlerStatus() },
  { command: "default_handler_set", call: () => api.setDefaultHandlers() },
  { command: "default_handler_restore", call: () => api.restoreDefaultHandlers() },

  {
    command: "validate_directory",
    request: { path: "C:/output" },
    call: () => api.validateDirectory({ path: "C:/output" }),
  },
  {
    command: "record_diagnostic_event",
    request: {
      scope: "quickAction",
      name: "requestReceived",
      fields: { action: "compressZip", pathCount: 2 },
    },
    call: () => api.recordDiagnosticEvent({
      scope: "quickAction",
      name: "requestReceived",
      fields: { action: "compressZip", pathCount: 2 },
    }),
  },
  { command: "diagnostic_log_info", call: () => api.fetchDiagnosticLogInfo() },
  { command: "quick_action_startup_state", call: () => api.fetchQuickActionStartupState() },
  {
    command: "native_frontend_ready",
    args: { windowLabel: "main" },
    call: () => api.nativeFrontendReady("main"),
  },
  {
    command: "acknowledge_native_event",
    args: { windowLabel: "main", eventId: "event-1234567890" },
    call: () => api.acknowledgeNativeEvent("main", "event-1234567890"),
  },
  { command: "account_snapshot", call: () => api.fetchAccountSnapshot() },
  {
    command: "account_begin_hosted_auth",
    request: { environment: "prod", audience: "sign.tzap.org" },
    call: () => api.beginAccountHostedAuth("prod"),
  },
  {
    command: "account_apply_hosted_callback",
    request: { state: "state-1234567890", result: "completed" },
    call: () => api.applyAccountHostedCallback({ state: "state-1234567890", result: "completed" }),
  },
  {
    command: "account_complete_hosted_auth",
    request: { state: "state-1234567890", handoffCode: "handoff-code-1234567890" },
    call: () => api.completeAccountHostedAuth({ state: "state-1234567890", handoffCode: "handoff-code-1234567890" }),
  },
  { command: "account_enroll_certificate", call: () => api.enrollAccountCertificate() },
  {
    command: "account_renew_certificate",
    request: { certificateId: "certificate-online-1" },
    call: () => api.renewAccountCertificate("certificate-online-1"),
  },
  { command: "account_retire_device", call: () => api.retireAccountDevice() },
  { command: "account_fetch_current_user", call: () => api.fetchAccountCurrentUser() },
  { command: "account_forget", call: () => api.forgetAccount() },
  {
    command: "account_generate_recipient_key",
    request: { label: "Personal" },
    call: () => api.generateAccountRecipientKey("Personal"),
  },
  {
    command: "account_generate_signing_identity",
    request: {
      commonName: "Local Signing Identity",
      label: "Local",
    },
    call: () => api.generateAccountSigningIdentity({
      commonName: "Local Signing Identity",
      label: "Local",
    }),
  },
  {
    command: "account_import_signing_identity",
    request: { identityPath: "C:/certs/imported.p12", password: "bundle-password", label: "Imported" },
    call: () => api.importAccountSigningIdentity({
      identityPath: "C:/certs/imported.p12",
      password: "bundle-password",
      label: "Imported",
    }),
  },
  {
    command: "account_install_signing_certificate",
    request: {
      identityId: "signing-local-1",
      certificateId: "certificate-online-1",
      certificateChainDer: [[1, 2, 3]],
      issuerCertificateSha256: "sha256:issuer",
      issuerKeyIdentifier: "key-id",
      serialNumber: "serial-1",
      notBeforeUnixSeconds: 1,
      notAfterUnixSeconds: 2,
      assuranceLevel: "enrolled",
      signDeviceId: "device-1",
    },
    call: () => api.installAccountSigningCertificate({
      identityId: "signing-local-1",
      certificateId: "certificate-online-1",
      certificateChainDer: [[1, 2, 3]],
      issuerCertificateSha256: "sha256:issuer",
      issuerKeyIdentifier: "key-id",
      serialNumber: "serial-1",
      notBeforeUnixSeconds: 1,
      notAfterUnixSeconds: 2,
      assuranceLevel: "enrolled",
      signDeviceId: "device-1",
    }),
  },
  {
    command: "account_remove_signing_identity",
    request: { id: "signing-local-1" },
    call: () => api.removeAccountSigningIdentity("signing-local-1"),
  },
  {
    command: "account_remove_recipient_key",
    request: { id: "recipient-1" },
    call: () => api.removeAccountRecipientKey("recipient-1"),
  },
  {
    command: "account_set_default_signing_identity",
    request: { id: "identity-1" },
    call: () => api.setDefaultAccountSigningIdentity("identity-1"),
  },
  {
    command: "account_remove_contact",
    request: { id: "contact-1" },
    call: () => api.removeAccountContact("contact-1"),
  },
  {
    command: "account_inspect_contact_card",
    request: { contactCard: { version: 1 } },
    call: () => api.inspectAccountContactCard({ version: 1 }),
  },
  {
    command: "account_accept_contact_card",
    request: { contactCard: { version: 1 } },
    call: () => api.acceptAccountContactCard({ version: 1 }),
  },
  { command: "account_sync_contacts", call: () => api.syncAccountContacts() },
  { command: "account_start_mfa_step_up", call: () => api.startAccountMfaStepUp() },
  {
    command: "account_verify_mfa_step_up",
    request: { code: "123456" },
    call: () => api.verifyAccountMfaStepUp("123456"),
  },
  {
    command: "start_archive_index",
    request: { archivePath: "C:/archives/demo.zip" },
    call: () => api.startArchiveIndex({ archivePath: "C:/archives/demo.zip" }),
  },
  {
    command: "wait_archive_index",
    request: { sessionId: "archive-1" },
    call: () => api.waitArchiveIndex({ sessionId: "archive-1" }),
  },
  {
    command: "get_archive_children",
    request: { sessionId: "archive-1", parentPath: "folder", limit: 200 },
    call: () => api.getArchiveChildren({
      sessionId: "archive-1",
      parentPath: "folder",
      limit: 200,
    }),
  },
  {
    command: "search_archive_index",
    request: { sessionId: "archive-1", query: "readme", limit: 200 },
    call: () => api.searchArchiveIndex({
      sessionId: "archive-1",
      query: "readme",
      limit: 200,
    }),
  },
  {
    command: "close_archive_index",
    request: { sessionId: "archive-1" },
    call: () => api.closeArchiveIndex({ sessionId: "archive-1" }),
  },
  {
    command: "plan_create",
    request: {
      sources: ["C:/source"],
      cleanSource: false,
      respectGitignore: true,
      followSymlinks: false,
    },
    call: () => api.runPlanCreate({
      sources: ["C:/source"],
      cleanSource: false,
      respectGitignore: true,
      followSymlinks: false,
    }),
  },
  {
    command: "start_create",
    request: {
      sources: ["C:/source"],
      destinationPath: "C:/output/demo.zip",
      format: "zip",
      cleanSource: false,
      replaceExisting: false,
      preserveMetadata: true,
      volumeCount: 3,
    },
    call: () => api.runStartCreate({
      sources: ["C:/source"],
      destinationPath: "C:/output/demo.zip",
      format: "zip",
      cleanSource: false,
      replaceExisting: false,
      preserveMetadata: true,
      volumeCount: 3,
    }),
  },
  {
    command: "start_extract",
    request: {
      archivePath: "C:/archives/demo.zip",
      destinationPath: "C:/output",
      overwrite: "refuse",
      stripComponents: 0,
      tzapRestorePolicy: "portable",
      tzapAllowDegraded: false,
      tzapAllowAbsoluteSymlinks: false,
      ignoreSymlinks: false,
    },
    call: () => api.runStartExtract({
      archivePath: "C:/archives/demo.zip",
      destinationPath: "C:/output",
      overwrite: "refuse",
      stripComponents: 0,
      tzapRestorePolicy: "portable",
      tzapAllowDegraded: false,
      tzapAllowAbsoluteSymlinks: false,
      ignoreSymlinks: false,
    }),
  },
  {
    command: "verify_tzap_certificate",
    request: {
      archivePath: "C:/archives/demo.tzap",
      validateTrust: true,
      trustedCaCertificatePaths: ["C:/certs/root.pem"],
      trustedSystemRoots: false,
      includeOfficialTzapRoot: true,
      checkCurrentStatus: false,
      environment: "prod",
    },
    call: () => api.verifyTzapCertificate({
      archivePath: "C:/archives/demo.tzap",
      validateTrust: true,
      trustedCaCertificatePaths: ["C:/certs/root.pem"],
      trustedSystemRoots: false,
      includeOfficialTzapRoot: true,
      checkCurrentStatus: false,
      environment: "prod",
    }),
  },
  {
    command: "validate_tzap_signing_identity",
    request: { identityPath: "C:/certs/signer.p12", password: "bundle-password" },
    call: () => api.validateTzapSigningIdentity({ identityPath: "C:/certs/signer.p12", password: "bundle-password" }),
  },
  {
    command: "preview_entry",
    request: {
      archivePath: "C:/archives/demo.zip",
      entryPath: "root.txt",
      overwrite: "refuse",
      stripComponents: 0,
    },
    call: () => api.runPreviewEntry({
      archivePath: "C:/archives/demo.zip",
      entryPath: "root.txt",
      overwrite: "refuse",
      stripComponents: 0,
    }),
  },
  {
    command: "start_native_file_drag",
    request: {
      archivePath: "C:/archives/demo.zip",
      entryPaths: ["root.txt"],
      stripComponents: 0,
    },
    call: () => api.runStartNativeFileDrag({
      archivePath: "C:/archives/demo.zip",
      entryPaths: ["root.txt"],
      stripComponents: 0,
    }),
  },
  { command: "cleanup_preview_roots", call: () => api.cleanupPreviewRoots() },
  {
    command: "test_archive",
    request: { archivePath: "C:/archives/demo.zip" },
    call: () => api.runTestArchive({ archivePath: "C:/archives/demo.zip" }),
  },
  {
    command: "detect_archive_format",
    request: { path: "C:/archives/demo.zip" },
    call: () => api.detectArchiveFormat({ path: "C:/archives/demo.zip" }),
  },
  { command: "subscribe_job", args: { request: { jobId: "job-1" }, onSnapshot: null }, call: () => api.subscribeJob({ jobId: "job-1" }, null as never) },
  { command: "get_job_snapshot", request: { jobId: "job-1" }, call: () => api.getJobSnapshot({ jobId: "job-1" }) },
  { command: "subscribe_job_catalog", args: { onSnapshot: null }, call: () => api.subscribeJobCatalog(null as never) },
  { command: "ack_subscription", request: { subscriptionId: "subscription-1", revision: "1" }, call: () => api.ackSubscription({ subscriptionId: "subscription-1", revision: "1" }) },
  { command: "unsubscribe_job", request: { subscriptionId: "subscription-1" }, call: () => api.unsubscribeJob({ subscriptionId: "subscription-1" }) },
  {
    command: "cancel_job",
    request: { jobId: "job-1" },
    call: () => api.cancelJob({ jobId: "job-1" }),
  },
  {
    command: "pause_job",
    request: { jobId: "job-1" },
    call: () => api.pauseJob({ jobId: "job-1" }),
  },
  {
    command: "resume_job",
    request: { jobId: "job-1" },
    call: () => api.resumeJob({ jobId: "job-1" }),
  },
  {
    command: "dismiss_job",
    request: { jobId: "job-1" },
    call: () => api.dismissJob({ jobId: "job-1" }),
  },
  {
    command: "localsend_discover",
    request: { alias: "ZManager Desktop", timeoutMs: 3000 },
    call: () => api.runLocalSendDiscover({ alias: "ZManager Desktop", timeoutMs: 3000 }),
  },
  {
    command: "enqueue_share",
    request: { mode: "directShare", clientRequestId: "request-1", senderAlias: "ZManager Desktop", artifactPath: "C:/output/archive.zip", receiver: null },
    call: () => api.enqueueShare({ mode: "directShare", clientRequestId: "request-1", senderAlias: "ZManager Desktop", artifactPath: "C:/output/archive.zip", receiver: null }),
  },
  {
    command: "set_share_receiver",
    request: { shareId: "share-1", receiver: { alias: "Peer", fingerprint: "fingerprint-1", port: 53317, protocol: "http", ip: "192.168.1.20", deviceModel: null } },
    call: () => api.setShareReceiver({ shareId: "share-1", receiver: { alias: "Peer", fingerprint: "fingerprint-1", port: 53317, protocol: "http", ip: "192.168.1.20", deviceModel: null } }),
  },
  {
    command: "start_share",
    request: { shareId: "share-1", acknowledgeDeliveryUncertainty: false },
    call: () => api.startShare({ shareId: "share-1", acknowledgeDeliveryUncertainty: false }),
  },
  { command: "get_share_queue", call: () => api.getShareQueue() },
  { command: "skip_share", request: { shareId: "share-1" }, call: () => api.skipShare({ shareId: "share-1" }) },
  { command: "cancel_share", request: { shareId: "share-1" }, call: () => api.cancelShare({ shareId: "share-1" }) },
  { command: "remove_share", request: { shareId: "share-1" }, call: () => api.removeShare({ shareId: "share-1" }) },
  {
    command: "localsend_respond_to_transfer",
    request: { requestId: "request-1", decision: "accept" },
    call: () => api.runLocalSendRespondToTransfer({ requestId: "request-1", decision: "accept" }),
  },
  {
    command: "localsend_start_receiver",
    request: { alias: "ZManager Desktop", receiveFolderPath: "C:/receive" },
    call: () => api.runLocalSendStartReceiver({ alias: "ZManager Desktop", receiveFolderPath: "C:/receive" }),
  },
  { command: "localsend_stop_receiver", call: () => api.runLocalSendStopReceiver() },
  { command: "localsend_list_trusted_devices", call: () => api.runLocalSendListTrustedDevices() },
  {
    command: "localsend_trust_device",
    args: { fingerprint: "fingerprint-1" },
    call: () => api.runLocalSendTrustDevice("fingerprint-1"),
  },
  {
    command: "localsend_untrust_device",
    args: { fingerprint: "fingerprint-1" },
    call: () => api.runLocalSendUntrustDevice("fingerprint-1"),
  },
] as const;

describe("Tauri command contracts", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({});
  });

  it("keeps TypeScript wrappers aligned with Rust invoke handler command names", () => {
    expect(COMMAND_WRAPPERS.map((wrapper) => wrapper.command)).toEqual(rustInvokeHandlerCommands());
  });

  it("invokes every command with the expected request envelope", async () => {
    for (const wrapper of COMMAND_WRAPPERS) {
      invokeMock.mockClear();

      await wrapper.call();

      if ("args" in wrapper) {
        expect(invokeMock).toHaveBeenCalledWith(wrapper.command, wrapper.args);
      } else if ("request" in wrapper) {
        expect(invokeMock).toHaveBeenCalledWith(wrapper.command, { request: wrapper.request });
      } else {
        expect(invokeMock).toHaveBeenCalledWith(wrapper.command);
      }
    }
  });

  it("keeps organization retirement re-authentication on the login audience", async () => {
    await api.beginAccountHostedAuth("prod", "login.tzap.org");

    expect(invokeMock).toHaveBeenCalledWith("account_begin_hosted_auth", {
      request: { environment: "prod", audience: "login.tzap.org" },
    });
  });
});

function rustInvokeHandlerCommands(): string[] {
  const handlerBlock = rustMainSource.match(/tauri::generate_handler!\[\s*([\s\S]*?)\s*\]/)?.[1] ?? "";
  return [...handlerBlock.matchAll(/(?:commands|account|default_handlers|diagnostics|migration|localsend|share_queue)::([a-zA-Z0-9_]+)/g)].map((match) => match[1]);
}
