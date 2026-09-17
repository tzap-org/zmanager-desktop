import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AcceptedJobEnvelopeDto, DesktopJobSnapshotDto, JobSnapshotEnvelopeDto } from "../api/types";

const mocks = vi.hoisted(() => ({
  channels: [] as Array<{ onmessage?: (message: unknown) => void }>,
  subscribeJob: vi.fn(),
  subscribeJobCatalog: vi.fn(),
  subscribeAcceptedJobs: vi.fn(),
  acknowledgeAcceptedJob: vi.fn(),
  ackSubscription: vi.fn(),
  unsubscribeJob: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage?: (message: unknown) => void;
    constructor() { mocks.channels.push(this); }
  },
}));
vi.mock("../api/commands", () => ({
  subscribeJob: mocks.subscribeJob,
  subscribeJobCatalog: mocks.subscribeJobCatalog,
  subscribeAcceptedJobs: mocks.subscribeAcceptedJobs,
  acknowledgeAcceptedJob: mocks.acknowledgeAcceptedJob,
  ackSubscription: mocks.ackSubscription,
  unsubscribeJob: mocks.unsubscribeJob,
}));

import { createInMemoryJobFeed, createTauriJobFeed, isNewerRevision } from "./jobFeed";

function snapshot(revision: string, status: DesktopJobSnapshotDto["status"] = "running"): DesktopJobSnapshotDto {
  return { revision, jobId: "job-1", kind: "zipCreate", status, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", canPause: true, canResume: false, canCancel: true, canDismiss: false,
    progressFacts: { processedBytes: 0, processedEntries: 0, recentPaths: [], phaseProcessedBytes: 0, warningCount: 0, activeElapsedMillis: 0, phaseElapsedMillis: 0 }, boundedNotices: [], availableActions: [], outputArtifacts: [] };
}

describe("job feed", () => {
  beforeEach(() => {
    mocks.channels.length = 0;
    vi.clearAllMocks();
    mocks.subscribeJob.mockResolvedValue("subscription-1");
    mocks.subscribeJobCatalog.mockResolvedValue("catalog-1");
    mocks.subscribeAcceptedJobs.mockResolvedValue("accepted-1");
    mocks.ackSubscription.mockResolvedValue(undefined);
    mocks.acknowledgeAcceptedJob.mockResolvedValue(undefined);
    mocks.unsubscribeJob.mockResolvedValue(undefined);
  });

  it("orders revisions beyond JavaScript's safe integer range", () => {
    expect(isNewerRevision("9007199254740993", "9007199254740992")).toBe(true);
    expect(isNewerRevision("9007199254740992", "9007199254740993")).toBe(false);
  });

  it("delivers retained state and ignores stale publications", async () => {
    const feed = createInMemoryJobFeed([snapshot("9007199254740993")]);
    const accept = vi.fn();
    await feed.subscribeJob("job-1", accept);
    feed.publish(snapshot("9007199254740992", "failed"));
    feed.publish(snapshot("9007199254740994", "completed"));
    expect(accept.mock.calls.map(([value]) => value.status)).toEqual(["running", "completed"]);
  });

  it("reconnects without polling when an acknowledgement fails", async () => {
    mocks.subscribeJob
      .mockResolvedValueOnce("subscription-1")
      .mockResolvedValueOnce("subscription-2");
    mocks.ackSubscription.mockRejectedValueOnce(new Error("ipc failed"));
    const accept = vi.fn();
    const subscription = await createTauriJobFeed().subscribeJob("job-1", accept);
    mocks.channels[0].onmessage?.({
      subscriptionId: "subscription-1",
      revision: "1",
      payload: snapshot("1"),
    } satisfies JobSnapshotEnvelopeDto);
    await vi.waitFor(() => expect(mocks.subscribeJob).toHaveBeenCalledTimes(2));
    expect(mocks.unsubscribeJob).toHaveBeenCalledWith({ subscriptionId: "subscription-1" });
    mocks.channels[1].onmessage?.({
      subscriptionId: "subscription-2",
      revision: "2",
      payload: snapshot("2", "completed"),
    } satisfies JobSnapshotEnvelopeDto);
    await vi.waitFor(() => expect(mocks.ackSubscription).toHaveBeenCalledTimes(2));
    expect(accept.mock.calls.map(([value]) => value.revision)).toEqual(["1", "2"]);
    await subscription.unsubscribe();
    expect(mocks.unsubscribeJob).toHaveBeenCalledWith({ subscriptionId: "subscription-2" });
  });

  it("acknowledges the envelope id when the first callback precedes subscribe resolution", async () => {
    mocks.subscribeJob.mockImplementationOnce(async (_request, channel: { onmessage?: (message: JobSnapshotEnvelopeDto) => void }) => {
      channel.onmessage?.({
        subscriptionId: "subscription-early",
        revision: "1",
        payload: snapshot("1"),
      });
      return "subscription-early";
    });
    const subscription = await createTauriJobFeed().subscribeJob("job-1", vi.fn());
    expect(mocks.ackSubscription).toHaveBeenCalledWith({
      subscriptionId: "subscription-early",
      revision: "1",
    });
    await subscription.unsubscribe();
  });

  it("recovers after the initial catalog subscription fails", async () => {
    vi.useFakeTimers();
    const onConnectionError = vi.fn();
    mocks.subscribeJobCatalog
      .mockRejectedValueOnce(new Error("catalog unavailable"))
      .mockResolvedValueOnce("catalog-2");

    const subscription = await createTauriJobFeed({
      reconnectDelayMs: 10,
      onConnectionError,
    }).subscribeCatalog(vi.fn());
    expect(mocks.subscribeJobCatalog).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10);

    expect(mocks.subscribeJobCatalog).toHaveBeenCalledTimes(2);
    expect(onConnectionError).toHaveBeenCalledOnce();
    await subscription.unsubscribe();
    vi.useRealTimers();
  });

  it("replays accepted Jobs from the last acknowledged revision and acknowledges after presentation", async () => {
    mocks.subscribeAcceptedJobs
      .mockResolvedValueOnce("subscription-accepted-1")
      .mockResolvedValueOnce("subscription-accepted-2");
    const accept = vi.fn(async () => true);
    const subscription = await createTauriJobFeed().subscribeAcceptedJobs(accept);
    const accepted: AcceptedJobEnvelopeDto = {
      acceptanceRevision: "9",
      job: { jobId: "job-9", kind: "zipExtract", status: "queued", createdAt: "2026-01-01T00:00:00Z" },
      origin: "nativeDrag",
    };
    mocks.channels[0].onmessage?.(accepted);
    await vi.waitFor(() => expect(mocks.acknowledgeAcceptedJob).toHaveBeenCalledWith({ jobId: "job-9", acceptanceRevision: "9" }));
    expect(accept).toHaveBeenCalledWith(accepted);
    await subscription.unsubscribe();
  });
});
