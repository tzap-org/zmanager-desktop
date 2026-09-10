import { describe, expect, it, vi } from "vitest";

import { startZManagerRuntime, type RuntimeStartupOptions } from "./runtimeStartup";

describe("runtime startup", () => {
  it("runs browser startup immediately after rendering the normal workspace", () => {
    const calls: string[] = [];
    const options = createOptions(calls, {
      isDesktopRuntime: () => false,
    });

    startZManagerRuntime(options);

    expect(calls).toEqual([
      "bindWindowLifecycleHandlers",
      "refreshDisplayFromPreferences",
      "loadPathHistory",
      "applyCreatePreferenceDefaults",
      "setInitialBrowseState",
      "installRuntimeDevTools",
      "bindFileDrop",
      "renderNormalWorkspaceOnce",
      "loadLocalDevFixtureFromUrl",
      "loadBootstrapState",
    ]);
  });

  it("starts the native quick-action path without waiting for bootstrap", async () => {
    const calls: string[] = [];
    let finishNativePath: () => void = () => {
      throw new Error("initializeNativeQuickActionPath was not called");
    };
    const options = createOptions(calls, {
      isDesktopRuntime: () => true,
      loadBootstrapState: vi.fn(async () => {
        calls.push("loadBootstrapState");
      }),
      initializeNativeQuickActionPath: vi.fn(() => new Promise<void>((resolve) => {
        calls.push("initializeNativeQuickActionPath");
        finishNativePath = () => resolve();
      })),
      initializeDeferredDesktopRuntime: vi.fn(async () => {
        calls.push("initializeDeferredDesktopRuntime");
      }),
    });

    startZManagerRuntime(options);
    expect(calls).toContain("loadBootstrapState");
    expect(calls).toContain("initializeNativeQuickActionPath");
    expect(calls).not.toContain("initializeDeferredDesktopRuntime");

    finishNativePath?.();
    await Promise.resolve();

    expect(calls).toContain("initializeDeferredDesktopRuntime");
    expect(calls).not.toContain("loadLocalDevFixtureFromUrl");
    await vi.waitFor(() => {
      expect(calls).toContain("loadLocalDevFixtureFromUrl");
    });

    expect(calls.slice(-3)).toEqual([
      "initializeNativeQuickActionPath",
      "initializeDeferredDesktopRuntime",
      "loadLocalDevFixtureFromUrl",
    ]);
    expect(options.renderNormalWorkspaceOnce).not.toHaveBeenCalled();
  });
});

function createOptions(
  calls: string[],
  overrides: Partial<RuntimeStartupOptions> = {},
): RuntimeStartupOptions {
  function effect(name: string) {
    return vi.fn(() => {
      calls.push(name);
    });
  }

  return {
    bindWindowLifecycleHandlers: effect("bindWindowLifecycleHandlers"),
    refreshDisplayFromPreferences: effect("refreshDisplayFromPreferences"),
    loadPathHistory: effect("loadPathHistory"),
    applyCreatePreferenceDefaults: effect("applyCreatePreferenceDefaults"),
    setInitialBrowseState: effect("setInitialBrowseState"),
    installRuntimeDevTools: effect("installRuntimeDevTools"),
    bindFileDrop: effect("bindFileDrop"),
    isDesktopRuntime: () => false,
    initializeNativeQuickActionPath: vi.fn(async () => {
      calls.push("initializeNativeQuickActionPath");
    }),
    initializeDeferredDesktopRuntime: vi.fn(async () => {
      calls.push("initializeDeferredDesktopRuntime");
    }),
    renderNormalWorkspaceOnce: effect("renderNormalWorkspaceOnce"),
    loadLocalDevFixtureFromUrl: effect("loadLocalDevFixtureFromUrl"),
    loadBootstrapState: effect("loadBootstrapState"),
    ...overrides,
  };
}
