import { describe, expect, it, vi } from "vitest";

import type { LocalSendDeviceInfoDto } from "../../api/types";
import { createLocalSendDiscoveryController } from "./localSendDiscoveryController";

describe("local send discovery controller", () => {
  it("deduplicates picker scans and refreshes expired results", async () => {
    let now = 0;
    const device = { alias: "Peer", fingerprint: "peer", port: 53317, protocol: "https", ip: null, deviceModel: null, lastSeenUnixSeconds: null };
    const discover = vi.fn(async () => [device]);
    const controller = createLocalSendDiscoveryController({ discover, publish: () => {}, errorMessage: String, now: () => now });
    await Promise.all([controller.openPicker("self"), controller.openPicker("self")]);
    expect(discover).toHaveBeenCalledTimes(1);
    await controller.openPicker("self");
    expect(discover).toHaveBeenCalledTimes(1);
    now = 30_001;
    await controller.openPicker("self");
    expect(discover).toHaveBeenCalledTimes(2);
  });

  it("retries empty and failed results on the next opening without an automatic loop", async () => {
    const discover = vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("offline")).mockResolvedValue([]);
    const controller = createLocalSendDiscoveryController({ discover, publish: () => {}, errorMessage: String });
    await controller.openPicker("self");
    expect(discover).toHaveBeenCalledTimes(1);
    await controller.openPicker("self");
    expect(controller.getSnapshot().status).toBe("error");
    await controller.openPicker("self");
    expect(discover).toHaveBeenCalledTimes(3);
  });

  it("publishes discovered receivers without exposing the desktop adapter to React", async () => {
    const publish = vi.fn();
    const controller = createLocalSendDiscoveryController({
      discover: async (alias) => [{ alias, fingerprint: "peer-1", port: 53317, protocol: "https", ip: null, deviceModel: null, lastSeenUnixSeconds: null }],
      publish,
      errorMessage: () => "discovery failed",
    });

    const snapshot = await controller.refresh("ZManager Desktop");

    expect(snapshot).toMatchObject({ status: "ready", devices: [{ fingerprint: "peer-1" }], error: null });
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ status: "loading" }));
    expect(publish).toHaveBeenLastCalledWith(snapshot);
  });

  it("retains the last receiver list and reports refresh errors", async () => {
    const controller = createLocalSendDiscoveryController({
      discover: async () => { throw new Error("offline"); },
      publish: () => {},
      errorMessage: () => "discovery failed",
    });

    const snapshot = await controller.refresh("ZManager Desktop");

    expect(snapshot).toMatchObject({ status: "error", devices: [], error: "discovery failed" });
  });

  it("does not let an older refresh overwrite a newer receiver result", async () => {
    let resolveFirst: (devices: LocalSendDeviceInfoDto[]) => void = () => {};
    let resolveSecond: (devices: LocalSendDeviceInfoDto[]) => void = () => {};
    const firstDiscovery = new Promise<LocalSendDeviceInfoDto[]>((resolve) => { resolveFirst = resolve; });
    const secondDiscovery = new Promise<LocalSendDeviceInfoDto[]>((resolve) => { resolveSecond = resolve; });
    const controller = createLocalSendDiscoveryController({
      discover: vi.fn((alias) => alias === "first" ? firstDiscovery : secondDiscovery),
      publish: () => {},
      errorMessage: () => "discovery failed",
    });

    const firstRefresh = controller.refresh("first");
    const secondRefresh = controller.refresh("second");
    resolveSecond([{ alias: "Second", fingerprint: "peer-2", port: 53317, protocol: "https", ip: null, deviceModel: null, lastSeenUnixSeconds: null }]);
    await secondRefresh;
    resolveFirst([{ alias: "First", fingerprint: "peer-1", port: 53317, protocol: "https", ip: null, deviceModel: null, lastSeenUnixSeconds: null }]);
    await firstRefresh;

    expect(controller.getSnapshot()).toMatchObject({ status: "ready", devices: [{ fingerprint: "peer-2" }] });
  });
});
