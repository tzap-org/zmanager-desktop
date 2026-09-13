import { describe, expect, it, vi } from "vitest";
import { shareFixture } from "../shareQueueTestFixtures";
import { createShareQueueController } from "./shareQueueController";

function setup() {
  const item = shareFixture();
  const api = {
    enqueueShare: vi.fn(async () => ({ item, deduplicated: false })),
    getShareQueue: vi.fn(async () => ({ queueRevision: "1", items: [item] })),
    setShareReceiver: vi.fn(async () => item), startShare: vi.fn(async () => item),
    skipShare: vi.fn(async () => item), cancelShare: vi.fn(async () => item), removeShare: vi.fn(async () => {}),
  };
  const reveal = vi.fn(async () => {});
  const publish = vi.fn();
  const controller = createShareQueueController({ api, reveal, publish, listen: async () => () => {}, reportError: vi.fn() });
  return { api, reveal, publish, controller };
}
const request = { mode: "directShare" as const, clientRequestId: "req", artifactPath: "/tmp/fixture.txt", senderAlias: "Sender", receiver: null };

describe("share queue controller", () => {
  it("reveals every explicit admission but never focuses on queue hints", async () => {
    const { controller, reveal, publish } = setup();
    await controller.initialize();
    expect(reveal).not.toHaveBeenCalled();
    await controller.enqueue(request);
    await controller.enqueue(request);
    expect(reveal).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledTimes(1);
    controller.handleQueueHint();
    await vi.waitFor(() => expect(reveal).toHaveBeenCalledTimes(2));
  });
  it("coalesces rapid receiver selections into the first commitment", async () => {
    const { controller, api } = setup();
    const receiver = { alias: "Peer", fingerprint: "peer", port: 53317, protocol: "https", ip: null, deviceModel: null, lastSeenUnixSeconds: null };
    await Promise.all([controller.setReceiver("share-1", receiver), controller.setReceiver("share-1", { ...receiver, fingerprint: "other" })]);
    expect(api.setShareReceiver).toHaveBeenCalledTimes(1);
    expect(api.setShareReceiver).toHaveBeenCalledWith({ shareId: "share-1", receiver });
  });
  it("retains the newest authoritative revision and forwards retry acknowledgement", async () => {
    const { controller, api } = setup();
    api.getShareQueue.mockResolvedValueOnce({ queueRevision: "3", items: [shareFixture({ transferState: "sent" })] });
    await controller.initialize();
    await controller.start("share-1", true);
    expect(api.startShare).toHaveBeenCalledWith({ shareId: "share-1", acknowledgeDeliveryUncertainty: true });
    expect(controller.getSnapshot().items[0].transferState).toBe("sent");
  });
  it("reloads after rejected stale mutations and releases the pending action", async () => {
    const { controller, api } = setup();
    api.cancelShare.mockRejectedValueOnce(new Error("already completed"));
    await expect(controller.cancel("share-1")).rejects.toThrow("already completed");
    await controller.cancel("share-1");
    expect(api.cancelShare).toHaveBeenCalledTimes(2);
    expect(api.getShareQueue).toHaveBeenCalledTimes(2);
  });
});
