import { describe, expect, it } from "vitest";

import { raceFirstObservation } from "./observationRace";

describe("raceFirstObservation", () => {
  it("waits for a later observer when an earlier observer has no result", async () => {
    const result = await raceFirstObservation([
      async () => null,
      async () => "observed",
    ]);

    expect(result).toBe("observed");
  });

  it("cancels slower observers after the first successful result", async () => {
    let wasAborted = false;
    const result = await raceFirstObservation([
      async () => "observed",
      async (signal) => {
        await new Promise<void>((resolve) => {
          if (signal.aborted) {
            wasAborted = true;
            resolve();
            return;
          }
          signal.addEventListener("abort", () => {
            wasAborted = true;
            resolve();
          }, { once: true });
        });
        return null;
      },
    ]);

    expect(result).toBe("observed");
    expect(wasAborted).toBe(true);
  });

  it("rejects when every observer fails or returns no result", async () => {
    await expect(raceFirstObservation([
      async () => null,
      async () => { throw new Error("observer failed"); },
    ])).rejects.toThrow("No browser observer reported a navigation");
  });
});
