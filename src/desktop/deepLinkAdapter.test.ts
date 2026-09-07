import { beforeEach, describe, expect, it, vi } from "vitest";

import { initializeDeepLinkAdapter, parseHostedAuthCallbackUrl } from "./deepLinkAdapter";

const onOpenUrl = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-deep-link", () => ({ onOpenUrl }));

describe("parseHostedAuthCallbackUrl", () => {
  const state = "state-1234567890";
  const handoffCode = "handoff-code-1234567890";

  it("accepts completed callbacks and strips query material from the callback URL", () => {
    expect(parseHostedAuthCallbackUrl(`tzap://auth/callback?state=${state}&result=completed&handoff_code=${handoffCode}&error_code=ignored`)).toEqual({
      state,
      result: "completed",
      handoffCode,
      errorCode: "ignored",
      callbackUrl: "tzap://auth/callback",
    });
  });

  it.each(["cancelled", "failed"])("accepts %s callbacks without a handoff code", (result) => {
    expect(parseHostedAuthCallbackUrl(`tzap://auth/callback?state=${state}&result=${result}&error_code=provider_cancelled`)).toEqual({
      state,
      result,
      errorCode: "provider_cancelled",
      callbackUrl: "tzap://auth/callback",
    });
  });

  it("does not forward a handoff code from a non-completed callback", () => {
    expect(parseHostedAuthCallbackUrl(`tzap://auth/callback?state=${state}&result=cancelled&handoff_code=${handoffCode}`)).toEqual({
      state,
      result: "cancelled",
      callbackUrl: "tzap://auth/callback",
    });
  });

  it("rejects secret-bearing or malformed callbacks", () => {
    expect(parseHostedAuthCallbackUrl(`tzap://auth/callback?state=${state}&result=completed&handoff_code=${handoffCode}&code=secret`)).toBeNull();
    expect(parseHostedAuthCallbackUrl(`tzap://auth/callback?state=${state}&result=completed`)).toBeNull();
    expect(parseHostedAuthCallbackUrl("zmanager://auth-callback?state=short&result=cancelled")).toBeNull();
  });
});

describe("initializeDeepLinkAdapter", () => {
  beforeEach(() => onOpenUrl.mockReset());

  it("forwards every validated callback result", async () => {
    let listener: ((urls: string[]) => void) | undefined;
    onOpenUrl.mockImplementation(async (nextListener: (urls: string[]) => void) => {
      listener = nextListener;
      return () => {};
    });
    const handleHostedCallback = vi.fn(async () => {});

    await initializeDeepLinkAdapter({ handleHostedCallback } as never);
    listener?.([
      "tzap://auth/callback?state=state-1234567890&result=cancelled",
      "tzap://auth/callback?state=state-1234567890&result=completed&handoff_code=handoff-code-1234567890",
    ]);
    await vi.waitFor(() => expect(handleHostedCallback).toHaveBeenCalledTimes(2));
    expect(handleHostedCallback).toHaveBeenNthCalledWith(1, expect.objectContaining({ result: "cancelled" }));
    expect(handleHostedCallback).toHaveBeenNthCalledWith(2, expect.objectContaining({ result: "completed", handoffCode: "handoff-code-1234567890" }));
  });
});
