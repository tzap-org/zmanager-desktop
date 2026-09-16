import { describe, expect, it } from "vitest";

import {
  createTranslator,
  interpolateMessage,
} from "./translator";

describe("translator", () => {
  it("looks up English messages", () => {
    const i18n = createTranslator("en");

    expect(i18n.t("preferences.title")).toBe("Options");
    expect(i18n.t("preferences.language.english")).toBe("English");
  });

  it("falls back to English when a locale override omits a key", () => {
    const i18n = createTranslator("en", {
      en: {
        "common.save": "Store",
      },
    });

    expect(i18n.t("common.save")).toBe("Store");
    expect(i18n.t("common.cancel")).toBe("Cancel");
  });

  it("shares one translator per locale so renders do not copy the catalogue", () => {
    // Components build a translator per render, so a fresh object each time
    // would both copy ~800 keys and break `memo` on every component taking a
    // translator as a prop.
    expect(createTranslator("en")).toBe(createTranslator("en"));
    expect(createTranslator("zh-CN")).toBe(createTranslator("zh-CN"));
    expect(createTranslator("en")).not.toBe(createTranslator("zh-CN"));
  });

  it("does not let an override leak into the shared translator", () => {
    const overridden = createTranslator("en", { en: { "common.save": "Store" } });

    expect(overridden).not.toBe(createTranslator("en"));
    expect(overridden.t("common.save")).toBe("Store");
    expect(createTranslator("en").t("common.save")).toBe("Save");
  });

  it("interpolates simple values without treating output as HTML", () => {
    expect(interpolateMessage("Processed {count} from {name}", {
      count: 3,
      name: "<archive>",
    })).toBe("Processed 3 from <archive>");
  });
});
