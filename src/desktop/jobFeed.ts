import { Channel } from "@tauri-apps/api/core";
import {
  acknowledgeAcceptedJob,
  ackSubscription,
  subscribeAcceptedJobs,
  subscribeJob,
  subscribeJobCatalog,
  unsubscribeJob,
} from "../api/commands";

import type {
  DesktopJobSnapshotDto,
  AcceptedJobEnvelopeDto,
  JobCatalogEnvelopeDto,
  JobCatalogSnapshotDto,
  JobSnapshotEnvelopeDto,
} from "../api/types";

export type JobFeedSubscription = Readonly<{ unsubscribe(): Promise<void> }>;

export type JobFeed = Readonly<{
  subscribeJob(jobId: string, accept: (snapshot: DesktopJobSnapshotDto) => void): Promise<JobFeedSubscription>;
  subscribeCatalog(accept: (snapshot: JobCatalogSnapshotDto) => void): Promise<JobFeedSubscription>;
  subscribeAcceptedJobs(accept: (accepted: AcceptedJobEnvelopeDto) => Promise<boolean | void> | boolean | void): Promise<JobFeedSubscription>;
}>;

export type TauriJobFeedOptions = Readonly<{
  reconnectDelayMs?: number;
  onConnectionError?(error: unknown): void;
}>;

function newer(incoming: string, current: string | null): boolean {
  try { return current === null || BigInt(incoming) > BigInt(current); } catch { return false; }
}

export function createTauriJobFeed(
  options: TauriJobFeedOptions = {},
): JobFeed {
  const reconnectDelayMs = options.reconnectDelayMs ?? 250;

  async function subscribeWithReconnect<TEnvelope extends { subscriptionId: string; revision: string }>(
    subscribe: (channel: Channel<TEnvelope>) => Promise<string>,
    acceptEnvelope: (envelope: TEnvelope) => void,
  ): Promise<JobFeedSubscription> {
    let disposed = false;
    let reconnecting: Promise<void> | null = null;
    let activeSubscriptionId: string | null = null;
    let connectionGeneration = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = async (): Promise<void> => {
      const generation = ++connectionGeneration;
      const channel = new Channel<TEnvelope>();
      channel.onmessage = (envelope) => {
        if (disposed || generation !== connectionGeneration) return;
        activeSubscriptionId = envelope.subscriptionId;
        acceptEnvelope(envelope);
        void ackSubscription({ subscriptionId: envelope.subscriptionId, revision: envelope.revision })
          .catch((error) => reconnect(error));
      };
      const subscriptionId = await subscribe(channel);
      if (disposed || generation !== connectionGeneration) {
        await unsubscribeJob({ subscriptionId }).catch(() => undefined);
        return;
      }
      activeSubscriptionId = subscriptionId;
    };

    const scheduleReconnect = (error: unknown): void => {
      if (disposed || retryTimer) return;
      options.onConnectionError?.(error);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void reconnect();
      }, reconnectDelayMs);
    };

    const reconnect = (cause?: unknown): Promise<void> => {
      if (disposed) return Promise.resolve();
      if (reconnecting) return reconnecting;
      if (cause !== undefined) {
        options.onConnectionError?.(cause);
      }
      reconnecting = (async () => {
        const previous = activeSubscriptionId;
        activeSubscriptionId = null;
        connectionGeneration += 1;
        if (previous) await unsubscribeJob({ subscriptionId: previous }).catch(() => undefined);
        try {
          await connect();
        } catch (error) {
          scheduleReconnect(error);
        }
      })().finally(() => {
        reconnecting = null;
      });
      return reconnecting;
    };

    try {
      await connect();
    } catch (error) {
      scheduleReconnect(error);
    }
    return {
      async unsubscribe() {
        disposed = true;
        if (retryTimer) {
          clearTimeout(retryTimer);
          retryTimer = null;
        }
        await reconnecting?.catch(() => undefined);
        const subscriptionId = activeSubscriptionId;
        activeSubscriptionId = null;
        if (subscriptionId) await unsubscribeJob({ subscriptionId }).catch(() => undefined);
      },
    };
  }

  return {
    async subscribeJob(jobId, accept) {
      let highest: string | null = null;
      return subscribeWithReconnect(
        (channel) => subscribeJob({ jobId }, channel),
        (envelope: JobSnapshotEnvelopeDto) => {
        if (newer(envelope.revision, highest)) {
          highest = envelope.revision;
          accept(envelope.payload);
        }
        },
      );
    },
    async subscribeCatalog(accept) {
      let highest: string | null = null;
      return subscribeWithReconnect(
        (channel) => subscribeJobCatalog(channel),
        (envelope: JobCatalogEnvelopeDto) => {
        if (newer(envelope.revision, highest)) {
          highest = envelope.revision;
          accept(envelope.payload);
        }
        },
      );
    },
    async subscribeAcceptedJobs(accept) {
      let lastAcceptanceRevision = "0";
      let disposed = false;
      let reconnecting: Promise<void> | null = null;
      let activeSubscriptionId: string | null = null;
      let connectionGeneration = 0;
      let retryTimer: ReturnType<typeof setTimeout> | null = null;
      let lastDeliveredRevision = lastAcceptanceRevision;
      let deliveryChain = Promise.resolve();

      const connect = async (): Promise<void> => {
        const generation = ++connectionGeneration;
        const channel = new Channel<AcceptedJobEnvelopeDto>();
        channel.onmessage = (envelope) => {
          if (disposed || generation !== connectionGeneration) return;
          if (!newer(envelope.acceptanceRevision, lastDeliveredRevision)) return;
          lastDeliveredRevision = envelope.acceptanceRevision;
          deliveryChain = deliveryChain.then(async () => {
            const presented = await accept(envelope);
            if (presented === false) {
              throw new Error("accepted Job presentation was not claimed");
            }
            await acknowledgeAcceptedJob({
              jobId: envelope.job.jobId,
              acceptanceRevision: envelope.acceptanceRevision,
            });
            lastAcceptanceRevision = envelope.acceptanceRevision;
          }).catch((error) => {
            lastDeliveredRevision = lastAcceptanceRevision;
            void reconnect(error);
          });
        };
        const subscriptionId = await subscribeAcceptedJobs(lastAcceptanceRevision, channel);
        if (disposed || generation !== connectionGeneration) {
          await unsubscribeJob({ subscriptionId }).catch(() => undefined);
          return;
        }
        activeSubscriptionId = subscriptionId;
      };

      const scheduleReconnect = (error: unknown): void => {
        if (disposed || retryTimer) return;
        options.onConnectionError?.(error);
        retryTimer = setTimeout(() => {
          retryTimer = null;
          void reconnect();
        }, reconnectDelayMs);
      };

      const reconnect = (cause?: unknown): Promise<void> => {
        if (disposed) return Promise.resolve();
        if (reconnecting) return reconnecting;
        if (cause !== undefined) options.onConnectionError?.(cause);
        reconnecting = (async () => {
          const previous = activeSubscriptionId;
          activeSubscriptionId = null;
          connectionGeneration += 1;
          if (previous && previous.startsWith("subscription-")) {
            await unsubscribeJob({ subscriptionId: previous }).catch(() => undefined);
          }
          try {
            await connect();
          } catch (error) {
            scheduleReconnect(error);
          }
        })().finally(() => {
          reconnecting = null;
        });
        return reconnecting;
      };

      try {
        await connect();
      } catch (error) {
        scheduleReconnect(error);
      }
      return {
        async unsubscribe() {
          disposed = true;
          if (retryTimer) {
            clearTimeout(retryTimer);
            retryTimer = null;
          }
          await reconnecting?.catch(() => undefined);
          const subscriptionId = activeSubscriptionId;
          activeSubscriptionId = null;
          if (subscriptionId && subscriptionId.startsWith("subscription-")) {
            await unsubscribeJob({ subscriptionId }).catch(() => undefined);
          }
        },
      };
    },
  };
}

export function createInMemoryJobFeed(initial: readonly DesktopJobSnapshotDto[] = []): JobFeed & Readonly<{
  publish(snapshot: DesktopJobSnapshotDto): void;
  publishCatalog(snapshot: JobCatalogSnapshotDto): void;
}> {
  const jobs = new Map(initial.map((snapshot) => [snapshot.jobId, snapshot]));
  const jobListeners = new Map<string, Set<(snapshot: DesktopJobSnapshotDto) => void>>();
  const catalogListeners = new Set<(snapshot: JobCatalogSnapshotDto) => void>();
  let catalog: JobCatalogSnapshotDto = { catalogRevision: "0", jobs: [] };
  return {
    async subscribeJob(jobId, accept) {
      const listeners = jobListeners.get(jobId) ?? new Set(); listeners.add(accept); jobListeners.set(jobId, listeners);
      const current = jobs.get(jobId); if (current) accept(current);
      return { async unsubscribe() { listeners.delete(accept); } };
    },
    async subscribeCatalog(accept) { catalogListeners.add(accept); accept(catalog); return { async unsubscribe() { catalogListeners.delete(accept); } }; },
    async subscribeAcceptedJobs() { return { async unsubscribe() {} }; },
    publish(snapshot) { const current = jobs.get(snapshot.jobId); if (current && !newer(snapshot.revision, current.revision)) return; jobs.set(snapshot.jobId, snapshot); jobListeners.get(snapshot.jobId)?.forEach((accept) => accept(snapshot)); },
    publishCatalog(snapshot) { if (!newer(snapshot.catalogRevision, catalog.catalogRevision)) return; catalog = snapshot; catalogListeners.forEach((accept) => accept(snapshot)); },
  };
}

export { newer as isNewerRevision };
