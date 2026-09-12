import { describe, expect, it, vi } from "vitest";

import { createAccountWorkspace } from "../workspaces/accountWorkspace";
import { createAccountController } from "./accountController";

const empty = { authStatus: "signedOut" as const, pendingState: null, defaultSigningIdentityId: null, capabilities: { auth: "launch_only", enrollment: "unavailable", status: "offline_cache_only", accountManagement: "external_browser" }, certificates: [], recipientKeys: [], contacts: [], displayName: null, publicSignerId: null, assuranceLevel: null, sessionExpiresAtUnixSeconds: null };

describe("account controller", () => {
  it("keeps typed lifecycle outcomes visible for enrollment and renewal", async () => {
    const workspace = createAccountWorkspace();
    const enrollDeviceCertificate = vi.fn(async () => ({
      snapshot: { ...empty, authStatus: "signedIn" as const },
      outcome: "approval_required",
      attemptedDeviceIds: ["device-1"],
      incompleteReasons: ["device_approval_required"],
    }));
    const renewCertificate = vi.fn(async () => ({
      snapshot: { ...empty, authStatus: "signedIn" as const },
      outcome: "incomplete",
      attemptedDeviceIds: ["device-1"],
      incompleteReasons: ["catalog_write_failed"],
    }));
    const controller = createAccountController({
      workspace,
      fetchSnapshot: async () => empty,
      beginHostedAuth: async () => ({ launchUrl: "", state: "", expiresAtUnixSeconds: 0 }),
      applyHostedCallback: async () => {},
      completeHostedAuth: async () => empty,
      fetchCurrentUser: async () => ({ displayName: "Test", assuranceLevel: "basic" }),
      enrollDeviceCertificate,
      renewCertificate,
      forget: async () => empty,
      generateRecipientKey: async () => empty,
      generateSigningIdentity: async () => empty,
      importSigningIdentity: async () => empty,
      installSigningCertificate: async () => empty,
      createSelfSignedCertificateStore: async () => empty,
      removeSigningIdentity: async () => empty,
      removeRecipientKey: async () => empty,
      setDefaultSigningIdentity: async () => empty,
      removeContact: async () => empty,
      inspectContactCard: async () => ({ displayName: "Test", signingCertificateSha256: "", recipientPublicKeyFingerprint: "", trustSource: "official_pinned_root", verificationState: "verified", missingStatusCaveat: false }),
      acceptContactCard: async () => empty,
      syncContacts: async () => empty,
      openUrl: async () => {},
      publish: () => {},
      errorMessage: String,
    });

    await controller.handleEnroll();
    expect(enrollDeviceCertificate).toHaveBeenCalledOnce();
    expect(workspace.getSnapshot().lifecycleOperation).toBe("enrollCertificate");
    expect(workspace.getSnapshot().lifecycleOutcome).toBe("approval_required");
    expect(workspace.getSnapshot().lifecycleIncompleteReasons).toEqual(["device_approval_required"]);

    await controller.handleRenew("certificate-1");
    expect(renewCertificate).toHaveBeenCalledWith("certificate-1");
    expect(workspace.getSnapshot().lifecycleOperation).toBe("renewCertificate");
    expect(workspace.getSnapshot().lifecycleOutcome).toBe("incomplete");
  });

  it("loads through injected APIs and never persists callback material", async () => {
    const workspace = createAccountWorkspace();
    const publish = vi.fn();
    const applyHostedCallback = vi.fn(async () => {});
    const controller = createAccountController({
      workspace,
      fetchSnapshot: async () => empty,
      beginHostedAuth: async () => ({ launchUrl: "https://login.tzap.org/auth", state: "state-1234567890", expiresAtUnixSeconds: 2 }),
      applyHostedCallback,
      completeHostedAuth: async () => empty,
      fetchCurrentUser: async () => ({ displayName: "Test User", assuranceLevel: "basic" }),
      enrollDeviceCertificate: async () => empty,
      renewCertificate: async () => empty,
      forget: async () => empty,
      generateRecipientKey: async () => empty,
      generateSigningIdentity: async () => empty,
      importSigningIdentity: async () => empty,
      installSigningCertificate: async () => empty,
      createSelfSignedCertificateStore: async () => empty,
      removeSigningIdentity: async () => empty,
      removeRecipientKey: async () => empty,
      setDefaultSigningIdentity: async () => empty,
      removeContact: async () => empty,
      inspectContactCard: async () => ({ displayName: "Test", signingCertificateSha256: "sha256:test", recipientPublicKeyFingerprint: "sha256:key", trustSource: "official_pinned_root", verificationState: "verified", missingStatusCaveat: false }),
      acceptContactCard: async () => empty,
      syncContacts: async () => empty,
      openUrl: async () => {},
      publish,
      errorMessage: String,
    });
    await controller.open();
    await controller.handleHostedCallback({ state: "state-1234567890", result: "completed" });
    expect(workspace.getSnapshot().authStatus).toBe("signedOut");
    expect(applyHostedCallback).toHaveBeenCalledWith({ state: "state-1234567890", result: "completed" });
    expect(JSON.stringify(workspace.getSnapshot())).not.toContain("token");
    expect(publish).toHaveBeenCalled();
  });

  it("normalizes failures into workspace notice state", async () => {
    const workspace = createAccountWorkspace();
    const controller = createAccountController({
      workspace,
      fetchSnapshot: async () => { throw new Error("offline"); },
      beginHostedAuth: async () => { throw new Error("offline"); },
      applyHostedCallback: async () => {},
      completeHostedAuth: async () => empty,
      fetchCurrentUser: async () => ({ displayName: "Test User", assuranceLevel: "basic" }),
      enrollDeviceCertificate: async () => empty,
      renewCertificate: async () => empty,
      forget: async () => empty,
      generateRecipientKey: async () => empty,
      generateSigningIdentity: async () => empty,
      importSigningIdentity: async () => empty,
      installSigningCertificate: async () => empty,
      createSelfSignedCertificateStore: async () => empty,
      removeSigningIdentity: async () => empty,
      removeRecipientKey: async () => empty,
      setDefaultSigningIdentity: async () => empty,
      removeContact: async () => empty,
      inspectContactCard: async () => ({ displayName: "Test", signingCertificateSha256: "sha256:test", recipientPublicKeyFingerprint: "sha256:key", trustSource: "official_pinned_root", verificationState: "verified", missingStatusCaveat: false }),
      acceptContactCard: async () => empty,
      syncContacts: async () => empty,
      openUrl: async () => {},
      publish: () => {},
      errorMessage: (error) => error instanceof Error ? error.message : "unknown",
    });
    await controller.open();
    expect(workspace.getSnapshot().notice).toBe("offline");
    expect(workspace.getSnapshot().busy).toBe(false);
  });

  it("refreshes the account snapshot when a lifecycle operation expires the session", async () => {
    const workspace = createAccountWorkspace();
    const expiredSnapshot = { ...empty, authStatus: "expired" as const };
    const fetchSnapshot = vi.fn(async () => expiredSnapshot);
    const controller = createAccountController({
      workspace,
      fetchSnapshot,
      beginHostedAuth: async () => ({ launchUrl: "", state: "", expiresAtUnixSeconds: 0 }),
      applyHostedCallback: async () => {},
      completeHostedAuth: async () => empty,
      fetchCurrentUser: async () => ({ displayName: "Test User", assuranceLevel: "basic" }),
      enrollDeviceCertificate: async () => { throw { code: "unauthorized" }; },
      renewCertificate: async () => empty,
      forget: async () => empty,
      generateRecipientKey: async () => empty,
      generateSigningIdentity: async () => empty,
      importSigningIdentity: async () => empty,
      installSigningCertificate: async () => empty,
      createSelfSignedCertificateStore: async () => empty,
      removeSigningIdentity: async () => empty,
      removeRecipientKey: async () => empty,
      setDefaultSigningIdentity: async () => empty,
      removeContact: async () => empty,
      inspectContactCard: async () => ({ displayName: "Test", signingCertificateSha256: "", recipientPublicKeyFingerprint: "", trustSource: "official_pinned_root", verificationState: "verified", missingStatusCaveat: false }),
      acceptContactCard: async () => empty,
      syncContacts: async () => empty,
      openUrl: async () => {},
      publish: () => {},
      errorMessage: String,
    });

    await controller.handleEnroll();

    expect(fetchSnapshot).toHaveBeenCalledOnce();
    expect(workspace.getSnapshot().authStatus).toBe("expired");
    expect(workspace.getSnapshot().notice).toBe("Session expired. Please sign in again.");
    expect(workspace.getSnapshot().busy).toBe(false);
  });

  it("refreshes the hidden account snapshot without opening the Account page", async () => {
    const workspace = createAccountWorkspace();
    const controller = createAccountController({
      workspace,
      fetchSnapshot: async () => ({ ...empty, defaultSigningIdentityId: "identity-1" }),
      beginHostedAuth: async () => ({ launchUrl: "https://login.tzap.org/auth", state: "state-1234567890", expiresAtUnixSeconds: 2 }),
      applyHostedCallback: async () => {},
      completeHostedAuth: async () => empty,
      fetchCurrentUser: async () => ({ displayName: "Test User", assuranceLevel: "basic" }),
      enrollDeviceCertificate: async () => empty,
      renewCertificate: async () => empty,
      forget: async () => empty,
      generateRecipientKey: async () => empty,
      generateSigningIdentity: async () => empty,
      importSigningIdentity: async () => empty,
      installSigningCertificate: async () => empty,
      createSelfSignedCertificateStore: async () => empty,
      removeSigningIdentity: async () => empty,
      removeRecipientKey: async () => empty,
      setDefaultSigningIdentity: async () => empty,
      removeContact: async () => empty,
      inspectContactCard: async () => ({ displayName: "Test", signingCertificateSha256: "sha256:test", recipientPublicKeyFingerprint: "sha256:key", trustSource: "official_pinned_root", verificationState: "verified", missingStatusCaveat: false }),
      acceptContactCard: async () => empty,
      syncContacts: async () => empty,
      openUrl: async () => {},
      publish: () => {},
      errorMessage: String,
    });

    await controller.refresh();

    expect(workspace.getSnapshot().visible).toBe(false);
    expect(workspace.getSnapshot().defaultSigningIdentityId).toBe("identity-1");
  });

  it("refreshes the persistent local identity without placing key material in workspace state", async () => {
    const workspace = createAccountWorkspace();
    const createStore = vi.fn(async () => empty);
    const controller = createAccountController({
      workspace,
      fetchSnapshot: async () => empty,
      beginHostedAuth: async () => ({ launchUrl: "https://login.tzap.org/auth", state: "state-1234567890", expiresAtUnixSeconds: 2 }),
      applyHostedCallback: async () => {},
      completeHostedAuth: async () => empty,
      fetchCurrentUser: async () => ({ displayName: "Test User", assuranceLevel: "basic" }),
      enrollDeviceCertificate: async () => empty,
      renewCertificate: async () => empty,
      forget: async () => empty,
      generateRecipientKey: async () => empty,
      generateSigningIdentity: async () => empty,
      importSigningIdentity: async () => empty,
      installSigningCertificate: async () => empty,
      createSelfSignedCertificateStore: createStore,
      removeSigningIdentity: async () => empty,
      removeRecipientKey: async () => empty,
      setDefaultSigningIdentity: async () => empty,
      removeContact: async () => empty,
      inspectContactCard: async () => ({ displayName: "Test", signingCertificateSha256: "sha256:test", recipientPublicKeyFingerprint: "sha256:key", trustSource: "official_pinned_root", verificationState: "verified", missingStatusCaveat: false }),
      acceptContactCard: async () => empty,
      syncContacts: async () => empty,
      openUrl: async () => {},
      publish: () => {},
      errorMessage: String,
    });

    await controller.createSelfSignedCertificateStore("Signer");

    expect(createStore).toHaveBeenCalledWith("Signer");
    expect(workspace.getSnapshot().busy).toBe(false);
  });

  it("syncs contacts from phone snapshot and updates workspace state", async () => {
    const workspace = createAccountWorkspace();
    const syncedSnapshot = {
      ...empty,
      contacts: [
        {
          contactId: "contact-phone-1",
          displayName: "Alice",
          recipientPublicKeyFingerprint: "sha256:alice",
          signingCertificateSha256: "sha256:alicecert",
          trustSource: "phone_sync",
          verificationState: "verified",
          missingStatusCaveat: false,
          phoneSourced: true,
        },
      ],
    };
    const syncContacts = vi.fn(async () => ({
      snapshot: syncedSnapshot,
      lastSuccessfulSyncAt: 1_700_000_000,
      counts: { imported: 1, updated: 2, removed: 3, rejected: 4, rejectedReasons: ["invalid_card"], statusRefreshFailed: 5 },
    }));
    const controller = createAccountController({
      workspace,
      fetchSnapshot: async () => empty,
      beginHostedAuth: async () => ({ launchUrl: "", state: "", expiresAtUnixSeconds: 0 }),
      applyHostedCallback: async () => {},
      completeHostedAuth: async () => empty,
      fetchCurrentUser: async () => ({ displayName: "Test", assuranceLevel: "basic" }),
      enrollDeviceCertificate: async () => empty,
      renewCertificate: async () => empty,
      forget: async () => empty,
      generateRecipientKey: async () => empty,
      generateSigningIdentity: async () => empty,
      importSigningIdentity: async () => empty,
      installSigningCertificate: async () => empty,
      createSelfSignedCertificateStore: async () => empty,
      removeSigningIdentity: async () => empty,
      removeRecipientKey: async () => empty,
      setDefaultSigningIdentity: async () => empty,
      removeContact: async () => empty,
      inspectContactCard: async () => ({ displayName: "Test", signingCertificateSha256: "", recipientPublicKeyFingerprint: "", trustSource: "official_pinned_root", verificationState: "verified", missingStatusCaveat: false }),
      acceptContactCard: async () => empty,
      syncContacts,
      openUrl: async () => {},
      publish: () => {},
      errorMessage: String,
    });

    await controller.syncContacts();
    expect(syncContacts).toHaveBeenCalled();
    expect(workspace.getSnapshot().contacts).toHaveLength(1);
    expect(workspace.getSnapshot().contacts[0]?.phoneSourced).toBe(true);
    expect(workspace.getSnapshot().lastContactSyncAt).toBe(1_700_000_000);
    expect(workspace.getSnapshot().contactSyncCounts).toEqual({ imported: 1, updated: 2, removed: 3, rejected: 4, rejectedReasons: ["invalid_card"], statusRefreshFailed: 5 });
  });
});
