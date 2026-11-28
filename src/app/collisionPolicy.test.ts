import { describe, expect, it } from "vitest";
import { resolveDestinationCollisionStrategy } from "./collisionPolicy";

describe("collisionPolicy", () => {
  it("honors explicitly provided destinationCollisionStrategy first", () => {
    expect(
      resolveDestinationCollisionStrategy({
        replaceExisting: true,
        destinationCollisionStrategy: "rename",
      }),
    ).toBe("rename");
  });

  it("returns rename for disposable tasks when replaceExisting is false", () => {
    expect(
      resolveDestinationCollisionStrategy({ isDisposableTask: true, replaceExisting: false }),
    ).toBe("rename");
  });

  it("returns rename for quick actions when replaceExisting is false", () => {
    expect(
      resolveDestinationCollisionStrategy({ isQuickAction: true, replaceExisting: false }),
    ).toBe("rename");
  });

  it("returns undefined when replacement is explicitly requested without a strategy override", () => {
    expect(
      resolveDestinationCollisionStrategy({ isDisposableTask: true, replaceExisting: true }),
    ).toBeUndefined();
    expect(
      resolveDestinationCollisionStrategy({ replaceExisting: true }),
    ).toBeUndefined();
  });

  it("returns undefined when no collision strategy is requested for standard tasks", () => {
    expect(
      resolveDestinationCollisionStrategy({ replaceExisting: false }),
    ).toBeUndefined();
  });
});
