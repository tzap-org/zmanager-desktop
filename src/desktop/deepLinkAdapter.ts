import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import type { NativeInboundHostedAuthEvent } from "../api/generated/nativeInboundEvents.generated";
import { type AccountController } from "../app/controllers/accountController";

const HOSTED_AUTH_RESULTS = new Set(["completed", "cancelled", "failed"]);
const FORBIDDEN_HOSTED_AUTH_QUERY_KEYS = new Set([
  "code",
  "token",
  "access_token",
  "authorization_code",
  "password",
  "relay_body",
  "session_token",
  "refresh_token",
  "id_token",
]);

export function parseHostedAuthCallbackUrl(urlStr: string): NativeInboundHostedAuthEvent["payload"] | null {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return null;
  }

  const isCurrentCallback = url.protocol === "tzap:" && url.hostname === "auth" && url.pathname === "/callback";
  const isLegacyCallback = url.protocol === "zmanager:" && url.hostname === "auth-callback" && url.pathname === "";
  if (!isCurrentCallback && !isLegacyCallback) {
    return null;
  }

  for (const key of url.searchParams.keys()) {
    if (FORBIDDEN_HOSTED_AUTH_QUERY_KEYS.has(key.toLowerCase())) {
      return null;
    }
  }

  const state = url.searchParams.get("state") ?? "";
  const result = url.searchParams.get("result") ?? "";
  if (!isBoundedToken(state, 16, 256) || !HOSTED_AUTH_RESULTS.has(result)) {
    return null;
  }

  const handoffCode = result === "completed" ? url.searchParams.get("handoff_code") ?? undefined : undefined;
  if (result === "completed" && (!handoffCode || !isBoundedToken(handoffCode, 16, 2048, /^[A-Za-z0-9._~-]+$/))) {
    return null;
  }

  const errorCode = url.searchParams.get("error_code") ?? undefined;
  return {
    state,
    result: result as NativeInboundHostedAuthEvent["payload"]["result"],
    ...(handoffCode ? { handoffCode } : {}),
    ...(errorCode && errorCode.length <= 128 ? { errorCode } : {}),
    callbackUrl: `${url.protocol}//${url.host}${url.pathname}`,
  };
}

function isBoundedToken(value: string, min: number, max: number, pattern = /^[A-Za-z0-9_-]+$/): boolean {
  return value.length >= min && value.length <= max && pattern.test(value);
}

export function initializeDeepLinkAdapter(accountController: AccountController): Promise<() => void> {
  return onOpenUrl((urls) => {
    for (const urlStr of urls) {
      const callback = parseHostedAuthCallbackUrl(urlStr);
      if (!callback) {
        continue;
      }
      accountController.handleHostedCallback(callback).catch((error: unknown) => {
        console.error("DeepLinkAdapter: Failed to handle auth callback", error);
      });
    }
  });
}
