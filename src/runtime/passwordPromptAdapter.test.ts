import { describe, expect, it, vi } from "vitest";

import { createBrowserPasswordPromptAdapter } from "./passwordPromptAdapter";

describe("password prompt adapter", () => {
  it("preserves non-empty prompted passwords", () => {
    const prompt = vi.fn(() => "  secret  ");
    const adapter = createBrowserPasswordPromptAdapter({ prompt });

    expect(adapter.promptForPassword("Password")).toBe("  secret  ");
    expect(prompt).toHaveBeenCalledWith("Password");
  });

  it("treats cancelled and empty prompts as null while preserving spaces", () => {
    const prompt = vi.fn<() => string | null>()
      .mockReturnValueOnce(null)
      .mockReturnValueOnce("")
      .mockReturnValueOnce("   ");
    const adapter = createBrowserPasswordPromptAdapter({ prompt });

    expect(adapter.promptForPassword("First")).toBeNull();
    expect(adapter.promptForPassword("Second")).toBeNull();
    expect(adapter.promptForPassword("Third")).toBe("   ");
  });
});
