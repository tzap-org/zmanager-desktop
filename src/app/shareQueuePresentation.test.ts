import { describe, expect, it } from "vitest";
import { shareFixture } from "./shareQueueTestFixtures";
import { presentShare } from "./shareQueuePresentation";

const peer = { alias: "Peer", fingerprint: "peer", port: 53317, protocol: "https", ip: "192.168.1.5", deviceModel: null, lastSeenUnixSeconds: null };

describe("share presentation", () => {
  it("uses transfer bytes after compression and awaits confirmed success", () => {
    const item = shareFixture({ compressionState: "complete", compressionProgress: { processedBytes: 1000, totalBytes: 1000, processedEntries: 1, totalEntries: 1 }, receiver: peer, transferState: "sending", bytesSent: 20, totalBytes: 100 });
    expect(presentShare(item).progress).toEqual({ processed: 20, total: 100, percent: 20 });
    expect(presentShare({ ...item, bytesSent: 100 }).status).toBe("finishing");
    expect(presentShare({ ...item, transferState: "sent" })).toMatchObject({ status: "shared", progress: { processed: 100, total: 100, percent: 100 } });
  });
  it("shows unknown compression totals as indeterminate", () => {
    expect(presentShare(shareFixture({ compressionState: "compressing", artifactPath: null })).progress?.percent).toBeNull();
  });
  it("locks selection for queued, completed, skipped, and cancelled work", () => {
    for (const patch of [{ receiver: peer }, { transferState: "sent" as const }, { sharingIntent: "skipped" as const }, { lifecycle: "cancelled" as const }]) {
      expect(presentShare(shareFixture(patch)).canSelectReceiver).toBe(false);
    }
  });
  it("only dismisses inactive work and preserves the cancellation transition", () => {
    for (const patch of [{ receiver: peer, transferState: "waiting" as const }, { compressionState: "compressing" as const }, { transferState: "cancelling" as const, lifecycle: "cancelled" as const }]) {
      expect(presentShare(shareFixture(patch)).canDismiss).toBe(false);
    }
    expect(presentShare(shareFixture({ transferState: "sent", receiver: peer }))).toMatchObject({ canDismiss: true, canCancel: false, canRetry: false });
    expect(presentShare(shareFixture({ transferState: "cancelled", lifecycle: "cancelled" })).status).toBe("cancelled");
  });
});
