import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AppShell } from "./AppShell";
import {
  ReactRuntimeMetadata,
  ZManagerAppRuntimeProvider,
  useZManagerActions,
  useZManagerSnapshot,
} from "./AppProviders";
import { createZManagerAppStore } from "./appStore";
import {
  createInitialZManagerReactSnapshot,
  createZManagerReactSnapshot,
  noopZManagerReactActions,
  type ZManagerReactActions,
} from "./appRuntime";

declare const process: {
  cwd(): string;
};

declare function require(id: "fs"): {
  readdirSync(path: string, options?: { withFileTypes?: false }): string[];
  readFileSync(path: string, encoding: string): string;
  statSync(path: string): { isDirectory(): boolean; isFile(): boolean };
};

declare function require(id: "path"): {
  join(...parts: string[]): string;
};

const { readdirSync, readFileSync, statSync } = require("fs");
const { join } = require("path");

function reactSourceFiles(
  directory = join(process.cwd(), "src", "ui", "react"),
): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...reactSourceFiles(path));
    } else if (stat.isFile() && /\.(?:ts|tsx)$/.test(entry)) {
      files.push(path);
    }
  }
  return files;
}

function SnapshotProbe() {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();

  return createElement("span", {
    "data-mode": snapshot.shell.activeMode,
    "data-archive-state": snapshot.archive.browseState,
    "data-has-actions": String(typeof actions.executeCommand === "function"),
  });
}

describe("AppShell", () => {
  it("is a React component boundary for the runtime bridge", () => {
    expect(typeof AppShell).toBe("function");
  });

  it("renders a synthetic immutable app snapshot through the React runtime provider", () => {
    const store = createZManagerAppStore(createInitialZManagerReactSnapshot());

    const html = renderToStaticMarkup(
      createElement(
        ZManagerAppRuntimeProvider,
        { store },
        createElement(ReactRuntimeMetadata),
        createElement(SnapshotProbe),
      ),
    );

    expect(html).toContain('data-active-mode="compress"');
    expect(html).toContain('data-browse-state="idle"');
    expect(html).toContain('data-mode="compress"');
    expect(html).toContain('data-archive-state="idle"');
    expect(html).toContain('data-has-actions="true"');
  });

  it("subscribes to snapshot replacement and delegates intents without mutating snapshots", () => {
    const executeCommand = vi.fn<ZManagerReactActions["executeCommand"]>();
    const handleArchiveIntent =
      vi.fn<ZManagerReactActions["handleArchiveIntent"]>();
    const store = createZManagerAppStore(createInitialZManagerReactSnapshot(), {
      ...noopZManagerReactActions,
      executeCommand,
      handleArchiveIntent,
    });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const originalSnapshot = store.getSnapshot();

    store.getActions().executeCommand("open", { openSource: "clipboard" });
    store.getActions().handleArchiveIntent({ type: "navigateBack" });

    expect(executeCommand).toHaveBeenCalledWith("open", {
      openSource: "clipboard",
    });
    expect(handleArchiveIntent).toHaveBeenCalledWith({ type: "navigateBack" });
    expect(store.getSnapshot()).toBe(originalSnapshot);

    store.publish(createInitialZManagerReactSnapshot());

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).not.toBe(originalSnapshot);

    unsubscribe();
    store.publish(createInitialZManagerReactSnapshot());

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps React snapshots frozen and password-free", () => {
    const snapshot = createInitialZManagerReactSnapshot();
    const snapshotJson = JSON.stringify(snapshot);

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.preferences)).toBe(true);
    expect(Object.isFrozen(snapshot.commands.states.open)).toBe(true);
    expect(snapshotJson).not.toContain("passwordValue");
    expect(snapshotJson).not.toContain("passwordConfirm");
  });

  it("keeps extract dialog snapshots password-free even when prompting for one", () => {
    const secret = "correct horse battery staple";
    const snapshot = createZManagerReactSnapshot({
      ...createInitialZManagerReactSnapshot(),
      dialog: {
        kind: "extract",
        mode: "archive",
        title: "Extract",
        message: "Password required",
        startLabel: "Extract",
        destination: "C:/out",
        destinationHistory: ["C:/out"],
        useSubfolder: false,
        subfolder: "",
        pathMode: "full",
        overwrite: "ask",
        stripComponents: "0",
        deduplicateRoot: false,
        tzapRestorePolicy: "portable",
        tzapAllowDegraded: false,
        ignoreSymlinks: false,
        passwordPromptOpen: true,
      },
    });
    const snapshotJson = JSON.stringify(snapshot);
    const dialogJson = JSON.stringify(snapshot.dialog);

    expect(snapshotJson).toContain("passwordPromptOpen");
    expect(snapshotJson).not.toContain(secret);
    expect(dialogJson).not.toMatch(/"password"\s*:/);
    expect(dialogJson).not.toMatch(/"passwordConfirm"\s*:/);
  });

  it("keeps React components away from API and desktop adapters", () => {
    for (const file of reactSourceFiles()) {
      const source = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
      if (!file.endsWith(".tsx")) {
        continue;
      }

      expect(source).not.toMatch(/from\s+["'][^"']*\/api(?:\/|["'])/);
      expect(source).not.toMatch(/from\s+["'][^"']*\/desktop(?:\/|["'])/);
    }
  });
});
