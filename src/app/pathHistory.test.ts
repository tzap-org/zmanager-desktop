import { describe, expect, it } from "vitest";

import {
  createPathHistoryStore,
  normalizeCreateDestinationHistory,
  normalizeExtractDestinationHistory,
  normalizePathHistory,
  normalizeRecentArchiveHistory,
  PATH_HISTORY_STORAGE_KEYS,
  recordCreateDestinationHistoryEntry,
  recordExtractDestinationHistoryEntry,
  recordPathHistoryEntry,
  recordRecentArchiveHistoryEntry,
  setCreateDestinationHistoryEntries,
  setExtractDestinationHistoryEntries,
  setPathHistoryEntries,
  setRecentArchiveHistoryEntries,
  type PathHistoryStorage,
} from "./pathHistory";

function memoryStorage(initial: Record<string, string> = {}): PathHistoryStorage & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

describe("path history helpers", () => {
  it("deduplicates literal paths and drops empty entries", () => {
    expect(normalizePathHistory(["/tmp/out ", "", "/tmp/out", "/tmp/out "])).toEqual([
      "/tmp/out ",
      "/tmp/out",
    ]);
  });

  it("caps normalized histories when setting entries", () => {
    expect(setPathHistoryEntries(["A", "B", "C", "D"], 3)).toEqual(["A", "B", "C"]);
  });

  it("moves a duplicate record to the front", () => {
    expect(recordPathHistoryEntry(["C:/one", "C:/two", "C:/three"], "C:/two", 10)).toEqual([
      "C:/two",
      "C:/one",
      "C:/three",
    ]);
  });

  it("ignores empty records", () => {
    expect(recordPathHistoryEntry(["C:/one"], "", 10)).toBeNull();
  });

  it("caps extract destination history at ten entries", () => {
    expect(normalizeExtractDestinationHistory(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"])).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
    ]);
    expect(setExtractDestinationHistoryEntries(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"])).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
    ]);
    expect(recordExtractDestinationHistoryEntry(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"], "11")).toEqual([
      "11",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
    ]);
  });

  it("caps create destination history at ten entries", () => {
    expect(normalizeCreateDestinationHistory(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"])).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
    ]);
    expect(setCreateDestinationHistoryEntries(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"])).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
    ]);
    expect(recordCreateDestinationHistoryEntry(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"], "11")).toEqual([
      "11",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
    ]);
  });

  it("caps recent archive history at eight entries", () => {
    expect(normalizeRecentArchiveHistory(["1", "2", "3", "4", "5", "6", "7", "8", "9"])).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
    ]);
    expect(setRecentArchiveHistoryEntries(["1", "2", "3", "4", "5", "6", "7", "8", "9"])).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
    ]);
    expect(recordRecentArchiveHistoryEntry(["1", "2", "3", "4", "5", "6", "7", "8"], "9")).toEqual([
      "9",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
    ]);
  });

  it("loads normalized path histories from injected storage", () => {
    const storage = memoryStorage({
      [PATH_HISTORY_STORAGE_KEYS.extractDestination]: JSON.stringify(["C:/out", "", "C:/out", "C:/tmp"]),
      [PATH_HISTORY_STORAGE_KEYS.createDestination]: JSON.stringify(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]),
      [PATH_HISTORY_STORAGE_KEYS.recentArchive]: JSON.stringify(["A", 42, "B", "A"]),
    });
    const store = createPathHistoryStore(storage);

    expect(store.load()).toEqual({
      extractDestinationHistory: ["C:/out", "C:/tmp"],
      createDestinationHistory: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
      recentArchiveHistory: ["A", "B"],
    });
  });

  it("records histories through injected storage and returns immutable plain snapshots", () => {
    const storage = memoryStorage();
    const store = createPathHistoryStore(storage);

    const snapshot = store.recordRecentArchiveHistory("C:/archives/app.zip ");

    expect(snapshot).toEqual({
      extractDestinationHistory: [],
      createDestinationHistory: [],
      recentArchiveHistory: ["C:/archives/app.zip "],
    });
    expect(storage.values.get(PATH_HISTORY_STORAGE_KEYS.recentArchive)).toBe(JSON.stringify(["C:/archives/app.zip "]));
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot?.recentArchiveHistory)).toBe(true);
    expect(Object.getPrototypeOf(snapshot)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(snapshot?.recentArchiveHistory)).toBe(Array.prototype);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it("ignores empty records without writing storage", () => {
    const storage = memoryStorage();
    const store = createPathHistoryStore(storage);

    expect(store.recordExtractDestinationHistory("")).toBeNull();
    expect(storage.values.size).toBe(0);
  });

  it("can run without storage", () => {
    const store = createPathHistoryStore(null);

    expect(store.load()).toEqual({
      extractDestinationHistory: [],
      createDestinationHistory: [],
      recentArchiveHistory: [],
    });
    expect(store.recordCreateDestinationHistory("C:/out/app.zip")?.createDestinationHistory).toEqual(["C:/out/app.zip"]);
  });
});
