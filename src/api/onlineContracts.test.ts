import { describe, expect, it } from "vitest";

import fixture from "../../fixtures/contracts/tzap-online-desktop.conformance.json";

const CONTRACT_ROWS = [
  "authCallback",
  "accountMutation",
  "certificateCatalog",
  "contactSync",
  "archiveVerification",
  "archiveCreation",
] as const;

describe("TZAP online desktop conformance fixture", () => {
  it("records the registered OAuth client and redirect contract", () => {
    expect(fixture.oauthRegistration.staging.redirectUri).toEqual("tzap://auth/callback");
    expect(fixture.oauthRegistration.production.redirectUri).toEqual("tzap://auth/callback");
    expect(fixture.oauthRegistration.staging.clientId).toEqual("zmanager_desktop");
    expect(fixture.oauthRegistration.production.clientId).toEqual("zmanager_desktop");
  });

  it("contains request, response, and failure examples for every plan boundary", () => {
    for (const row of CONTRACT_ROWS) {
      const contract = fixture[row];
      expect(contract.request, row).toBeDefined();
      expect(contract.response, row).toBeDefined();
      expect(contract.failure, row).toBeDefined();
      expect(contract.failure.code, row).toEqual(expect.any(String));
      expect(contract.failure.reason, row).toEqual(expect.any(String));
    }
  });

  it("keeps the fixture secret-free and preserves stable discriminators", () => {
    const serialized = JSON.stringify(fixture);
    expect(serialized).not.toMatch(/access[_-]?token|private[_-]?key|relay_body/i);
    expect(fixture.authCallback.request.handoffCode).toEqual("handoff-code-1234567890");
    expect(fixture.accountMutation.response.outcome).toEqual("complete");
    expect(fixture.contactSync.response.counts.statusRefreshFailed).toEqual(0);
    expect(fixture.archiveVerification.request.environment).toEqual("prod");
    expect(fixture.archiveVerification.response.verificationState).toEqual("cryptographically_intact_offline");
    expect(fixture.archiveCreation.request.volumeCount).toEqual(3);
  });
});
