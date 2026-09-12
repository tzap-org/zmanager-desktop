import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { ZManagerAppRuntimeProvider } from "../AppProviders";
import { createZManagerAppStore } from "../appStore";
import {
  createInitialZManagerReactSnapshot,
  noopZManagerReactActions,
} from "../appRuntime";
import { AccountWorkspace, type AccountWorkspaceProps } from "./AccountWorkspace";

describe("AccountWorkspace", () => {
  it("renders the React account surface from a secret-free snapshot", () => {
    const initial = createInitialZManagerReactSnapshot();
    const store = createZManagerAppStore(
      {
        ...initial,
        account: { ...initial.account, visible: true, notice: "Ready" },
      },
      noopZManagerReactActions,
    );
    const html = renderToStaticMarkup(
      createElement(
        ZManagerAppRuntimeProvider,
        { store },
        createElement<AccountWorkspaceProps>(AccountWorkspace, { defaultTab: "certificates" }),
      ),
    );
    expect(html).toContain("TZAP Account &amp; Identity");
    expect(html).toContain('data-dialog-surface="true"');
    expect(html).toContain('data-dialog-content="true"');
    expect(html).toContain('id="account-description"');
    expect(html).toContain('data-account-tab-navigation="true"');
    expect(html).toContain("sticky top-0");
    expect(html).toContain(
      "Local offline mode · Encryption &amp; signing identities operational",
    );
    expect(html).toContain('data-account-environment="prod"');
    expect(html).toContain("Environment: Production");
    expect(html).not.toContain("Authentication: launch only");
    expect(html).toContain("Create local self-signed identity");
    expect(html).toContain("Import existing P12/PFX identity");
    expect(html).not.toContain("Export P12");
    expect(html).not.toContain("access_token");
  });

  it("makes hosted enrollment and renewal state explicit in Certificates", () => {
    const initial = createInitialZManagerReactSnapshot();
    const store = createZManagerAppStore(
      {
        ...initial,
        account: {
          ...initial.account,
          visible: true,
          authStatus: "signedIn",
          capabilities: { ...initial.account.capabilities, auth: "handoff_exchange", enrollment: "available", status: "online" },
          certificates: [{
            identityId: "hosted-identity-1",
            certificateId: "hosted-cert-1",
            certificateSha256: "sha256:hosted",
            label: "Hosted identity",
            identityType: "hosted",
            state: "active",
            assuranceLevel: "enrolled",
            notAfterUnixSeconds: 2_000_000_000,
            renewalRecommended: true,
          }],
        },
      },
      noopZManagerReactActions,
    );
    const html = renderToStaticMarkup(
      createElement(
        ZManagerAppRuntimeProvider,
        { store },
        createElement<AccountWorkspaceProps>(AccountWorkspace, { defaultTab: "certificates" }),
      ),
    );

    expect(html).toContain("Hosted certificate");
    expect(html).toContain("Hosted identity");
    expect(html).toContain("Renewal recommended before this certificate expires.");
    expect(html).toContain("Renew certificate");
    expect(html).toContain("Expires");
  });

  it("offers re-enrollment when only historical hosted certificates remain", () => {
    const initial = createInitialZManagerReactSnapshot();
    const store = createZManagerAppStore(
      {
        ...initial,
        account: {
          ...initial.account,
          visible: true,
          authStatus: "signedIn",
          capabilities: { ...initial.account.capabilities, auth: "handoff_exchange", enrollment: "available", status: "online" },
          certificates: [{
            identityId: "hosted-identity-revoked",
            certificateId: "hosted-cert-revoked",
            certificateSha256: "sha256:revoked",
            label: "Historical hosted identity",
            identityType: "hosted",
            state: "revoked",
            assuranceLevel: "enrolled",
            notAfterUnixSeconds: 2_000_000_000,
            renewalRecommended: false,
          }],
        },
      },
      noopZManagerReactActions,
    );
    const html = renderToStaticMarkup(
      createElement(
        ZManagerAppRuntimeProvider,
        { store },
        createElement<AccountWorkspaceProps>(AccountWorkspace, { defaultTab: "certificates" }),
      ),
    );

    expect(html).toContain("Historical hosted identity");
    expect(html).toContain("No active hosted identity is enrolled on this device.");
    expect(html).toContain("Enroll this device");
  });

  it("does not offer server retirement while signed out", () => {
    const initial = createInitialZManagerReactSnapshot();
    const store = createZManagerAppStore(
      {
        ...initial,
        account: {
          ...initial.account,
          visible: true,
          authStatus: "signedIn",
          capabilities: { ...initial.account.capabilities, auth: "launch_only" },
        },
      },
      noopZManagerReactActions,
    );
    const html = renderToStaticMarkup(
      createElement(
        ZManagerAppRuntimeProvider,
        { store },
        createElement<AccountWorkspaceProps>(AccountWorkspace, { defaultTab: "device" }),
      ),
    );

    // Retirement revokes server-side, and the sign server now requires an MFA step-up on the
    // calling session that this app cannot perform, so the destructive control is gone and the
    // tab explains where the operation lives instead of offering a button that would 403.
    expect(html).not.toContain("Confirm Retire");
    expect(html).not.toContain("Sign in to retire device");
    expect(html).toContain("requires a multi-factor verification step");
    expect(html).toContain("Hosted sign-in is still required before the console can retire this device.");
  });

  it("keeps a notice and long Contacts content inside the shared bounded surface", () => {
    const initial = createInitialZManagerReactSnapshot();
    const store = createZManagerAppStore(
      {
        ...initial,
        account: {
          ...initial.account,
          visible: true,
          notice: "Identity data is available from the local cache.",
          contacts: [
            {
              contactId: "contact-long",
              displayName: "A contact with a deliberately long display name for compact windows",
              signingCertificateSha256: "sha256:certificate",
              recipientPublicKeyFingerprint: "sha256:recipient",
              verificationState: "status_mismatch",
              missingStatusCaveat: false,
            },
          ],
        },
      },
      noopZManagerReactActions,
    );
    const html = renderToStaticMarkup(
      createElement(
        ZManagerAppRuntimeProvider,
        { store },
        createElement<AccountWorkspaceProps>(AccountWorkspace, { defaultTab: "contacts" }),
      ),
    );

    expect(html).toContain('role="status"');
    expect(html).toContain("Identity data is available from the local cache.");
    expect(html).toContain("A contact with a deliberately long display name");
    expect(html).toContain("Status unavailable");
    expect(html).toContain("Sign in to sync contacts");
    expect(html).toContain('data-dialog-content="true"');
    expect(html).not.toContain('class="fixed h-[620px]');
  });

  it("separates retired recipient keys from active keys after retirement", () => {
    const initial = createInitialZManagerReactSnapshot();
    const store = createZManagerAppStore(
      {
        ...initial,
        account: {
          ...initial.account,
          visible: true,
          recipientKeys: [
            {
              keyId: "recipient-active",
              algorithm: "X25519",
              publicKeyFingerprint: "sha256:active",
              createdAtUnixSeconds: 1,
              label: "Active key",
              lifecycle: "active",
            },
            {
              keyId: "recipient-retired",
              algorithm: "X25519",
              publicKeyFingerprint: "sha256:retired",
              createdAtUnixSeconds: 2,
              label: "Retired key",
              lifecycle: "retired",
            },
          ],
        },
      },
      noopZManagerReactActions,
    );
    const html = renderToStaticMarkup(
      createElement(
        ZManagerAppRuntimeProvider,
        { store },
        createElement<AccountWorkspaceProps>(AccountWorkspace, { defaultTab: "contacts" }),
      ),
    );

    expect(html).toContain("Active key");
    expect(html).toContain("Retired recipient keys");
    expect(html).toContain("Retired key");
    expect(html).toContain("Retired");
    expect(html).not.toContain('aria-label="Retire Retired key"');
    expect(html).toContain('aria-label="Permanently delete Retired key"');
  });

  it("displays warning prompt when deleting a key configured in Global Options", () => {
    const initial = createInitialZManagerReactSnapshot();
    const store = createZManagerAppStore(
      {
        ...initial,
        account: {
          ...initial.account,
          visible: true,
          certificates: [
            {
              identityId: "identity-global-default",
              certificateId: "cert-global-default",
              label: "Global Default Cert",
              certificateSha256: "sha256:global",
              identityType: "offline",
              state: "active",
              assuranceLevel: "self_signed",
              notAfterUnixSeconds: 0,
              renewalRecommended: false,
            },
          ],
        },
        preferences: {
          ...initial.preferences,
          createFormatDefaults: {
            ...initial.preferences.createFormatDefaults,
            tzap: {
              ...initial.preferences.createFormatDefaults.tzap,
              tzapSigningDefault: "identity",
              tzapDefaultSigningIdentityId: "cert-global-default",
            },
          },
        },
      },
      noopZManagerReactActions,
    );
    const html = renderToStaticMarkup(
      createElement(
        ZManagerAppRuntimeProvider,
        { store },
        createElement<AccountWorkspaceProps>(AccountWorkspace, { defaultTab: "certificates" }),
      ),
    );

    expect(html).toContain("Global Default Cert");
    expect(html).toContain("Delete identity");
  });

  it("hides Session and Device tabs when signed out, exposing header Sign In button", () => {
    const initial = createInitialZManagerReactSnapshot();
    const signedOutStore = createZManagerAppStore(
      {
        ...initial,
        account: {
          ...initial.account,
          visible: true,
          authStatus: "signedOut",
          capabilities: { ...initial.account.capabilities, auth: "handoff_exchange" },
        },
      },
      noopZManagerReactActions,
    );
    const signedOutHtml = renderToStaticMarkup(
      createElement(
        ZManagerAppRuntimeProvider,
        { store: signedOutStore },
        createElement(AccountWorkspace),
      ),
    );

    expect(signedOutHtml).not.toContain("Sign In");
    expect(signedOutHtml).not.toContain(">Session<");
    expect(signedOutHtml).not.toContain(">Device<");
    expect(signedOutHtml).toContain("Certificates");

    const signedInStore = createZManagerAppStore(
      {
        ...initial,
        account: {
          ...initial.account,
          visible: true,
          authStatus: "signedIn",
          displayName: "Alice Dev",
        },
      },
      noopZManagerReactActions,
    );
    const signedInHtml = renderToStaticMarkup(
      createElement(
        ZManagerAppRuntimeProvider,
        { store: signedInStore },
        createElement(AccountWorkspace),
      ),
    );

    expect(signedInHtml).toContain("Sign Out");
    expect(signedInHtml).toContain("Alice Dev");
    expect(signedInHtml).toContain("Session");
    expect(signedInHtml).toContain("Device");
  });
});
