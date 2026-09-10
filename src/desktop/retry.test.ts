import { describe, expect, it, vi } from "vitest";

import { retryAsync } from "./retry";

describe("retryAsync", () => {
  it("retries a failed operation until it succeeds", async () => {
    const operation = vi.fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValue("complete");

    await expect(retryAsync(operation, 2, 0)).resolves.toBe("complete");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(operation).toHaveBeenNthCalledWith(1, 0);
    expect(operation).toHaveBeenNthCalledWith(2, 1);
  });

  it("rethrows the final error after the attempt limit", async () => {
    const error = new Error("permanent");
    const operation = vi.fn<(attempt: number) => Promise<never>>().mockRejectedValue(error);

    await expect(retryAsync(operation, 3, 0)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(3);
  });
});
