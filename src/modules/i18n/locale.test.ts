import { describe, expect, it } from "vitest";
import {
  resolveAppLocale,
  SUPPORTED_LANGUAGE_PREFS,
  SUPPORTED_LOCALES,
} from "./types";
import { getNaiveLocaleConfig } from "./naive";

describe("i18n locale resolution", () => {
  it("keeps explicit language preferences", () => {
    expect(resolveAppLocale("zh-CN", ["en-US"])).toBe("zh-CN");
    expect(resolveAppLocale("en-US", ["zh-CN"])).toBe("en-US");
  });

  it("maps system Chinese languages to zh-CN and falls back to en-US", () => {
    expect(resolveAppLocale("system", ["zh-Hans-CN", "en-US"])).toBe("zh-CN");
    expect(resolveAppLocale("system", ["fr-FR", "en-US"])).toBe("en-US");
  });

  it("defines stable public language options", () => {
    expect(SUPPORTED_LANGUAGE_PREFS).toEqual(["system", "zh-CN", "en-US"]);
    expect(SUPPORTED_LOCALES).toEqual(["zh-CN", "en-US"]);
  });

  it("maps app locales to Naive UI locale objects", () => {
    expect(getNaiveLocaleConfig("zh-CN").locale.name).toBe("zh-CN");
    expect(getNaiveLocaleConfig("en-US").locale.name).toBe("en-US");
  });
});
