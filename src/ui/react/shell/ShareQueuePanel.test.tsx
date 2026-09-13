import { act, fireEvent, render, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { shareFixture } from "../../../app/shareQueueTestFixtures";
import { ZManagerAppRuntimeProvider } from "../AppProviders";
import { createZManagerAppStore } from "../appStore";
import { createInitialZManagerReactSnapshot, noopZManagerReactActions } from "../appRuntime";
import { ShareQueuePanel } from "./ShareQueuePanel";

afterEach(cleanup);
function setup(item = shareFixture()) {
  const onIntent = vi.fn();
  const initial = createInitialZManagerReactSnapshot();
  const store = createZManagerAppStore({ ...initial, shareQueue: { queueRevision: "1", items: [item] } }, { ...noopZManagerReactActions, handleDialogIntent: onIntent });
  const view = render(<ZManagerAppRuntimeProvider store={store}><ShareQueuePanel /></ZManagerAppRuntimeProvider>);
  return { view, store, onIntent };
}
const peer = { alias: "Peer", fingerprint: "peer", port: 53317, protocol: "https", ip: "192.168.1.5", deviceModel: null, lastSeenUnixSeconds: null };

describe("share queue panel", () => {
  it("does not invent a byte count when a tiny send finishes before its first progress event", () => {
    const { view } = setup(shareFixture({ receiver: peer, transferState: "sent", totalBytes: null, bytesSent: 0 }));
    expect(view.getByText("100%")).toBeTruthy();
    expect(view.queryByText(/0 GB/)).toBeNull();
  });

  it("discovers on opening and keeps empty recovery inside the picker", () => {
    const { view, onIntent, store } = setup();
    expect(view.queryByRole("button", { name: "Refresh receivers" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "LAN receiver" }));
    expect(onIntent).toHaveBeenCalledWith({ type: "shareQueueOpenReceivers" });
    act(() => store.publish({ ...store.getSnapshot(), localSendDiscovery: { status: "loading", devices: [], error: null } }));
    expect(view.getByText("Looking for devices on your network...")).toBeTruthy();
    act(() => store.publish({ ...store.getSnapshot(), localSendDiscovery: { status: "ready", devices: [], error: null } }));
    expect(view.getByText(/No devices found/)).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Search again" }));
    expect(onIntent).toHaveBeenLastCalledWith({ type: "shareQueueRefreshReceivers" });
  });
  it("shows transfer progress and locks the completed destination", () => {
    const { view } = setup(shareFixture({ receiver: peer, transferState: "sent", bytesSent: 100, totalBytes: 100 }));
    expect(view.queryByRole("button", { name: "LAN receiver" })).toBeNull();
    expect(view.getByRole("progressbar").getAttribute("value")).toBe("100");
    expect(view.getByRole("button", { name: "Dismiss" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "Cancel" })).toBeNull();
  });
  it("requires explicit duplicate-delivery acknowledgement before retry", () => {
    const { view, onIntent } = setup(shareFixture({ receiver: peer, transferState: "failed", deliveryUncertain: true }));
    fireEvent.click(view.getByRole("button", { name: "Retry" }));
    expect(onIntent).not.toHaveBeenCalled();
    expect(view.getByText(/may already have this file/)).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Retry anyway" }));
    expect(onIntent).toHaveBeenCalledWith({ type: "shareQueueStart", shareId: "share-1", acknowledgeDeliveryUncertainty: true });
  });
  it("offers cancellation without dismissal while a transfer is active", () => {
    const { view } = setup(shareFixture({ receiver: peer, transferState: "sending" }));
    expect(view.queryByRole("button", { name: "Dismiss" })).toBeNull();
    expect(view.getByRole("button", { name: "Cancel transfer" })).toBeTruthy();
    expect(view.getByRole("progressbar").hasAttribute("value")).toBe(false);
  });
});
