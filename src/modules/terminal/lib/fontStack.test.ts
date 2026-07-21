// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  __TESTING__,
  buildCssFontFamily,
  buildFontFamilyCss,
  buildFontStack,
  type FontStack,
} from "./fontStack";

const STACK: FontStack = {
  primary: '"JetBrains Mono"',
  symbol: '"Pure Nerd Font"',
  cjk: '"Noto Sans Mono CJK SC"',
  emoji: '"Apple Color Emoji"',
  fallback: "ui-monospace, SFMono-Regular, Menlo, monospace",
};

describe("fontStack", () => {
  describe("buildCssFontFamily", () => {
    it("emits a stable layered chain in canonical order", () => {
      expect(buildCssFontFamily(STACK)).toBe(
        '"JetBrains Mono", "Pure Nerd Font", "Noto Sans Mono CJK SC", "Apple Color Emoji", ui-monospace, SFMono-Regular, Menlo, monospace',
      );
    });

    it("skips empty layers", () => {
      const stack: FontStack = {
        primary: '"Cascadia Mono"',
        symbol: "",
        cjk: "",
        emoji: "",
        fallback: "ui-monospace",
      };
      expect(buildCssFontFamily(stack)).toBe('"Cascadia Mono", ui-monospace');
    });

    it("handles all-empty layers defensively", () => {
      expect(
        buildCssFontFamily({
          primary: "",
          symbol: "",
          cjk: "",
          emoji: "",
          fallback: "",
        }),
      ).toBe("");
    });
  });

  describe("buildFontStack (preset logic)", () => {
    it("uses the preset name verbatim when provided", () => {
      const stack = buildFontStack({
        presetName: "Cascadia Mono",
        nerdFontEnabled: true,
        cjkEnabled: true,
        emojiEnabled: true,
      });
      expect(stack.primary).toBe('"Cascadia Mono"');
    });

    it("skips the symbol layer when the preset itself is a Nerd Font variant", () => {
      const stack = buildFontStack({
        presetName: "JetBrainsMono Nerd Font",
        nerdFontEnabled: true,
        cjkEnabled: true,
        emojiEnabled: true,
      });
      expect(stack.primary).toBe('"JetBrainsMono Nerd Font"');
      expect(stack.symbol).toBe("");
    });

    it("keeps the symbol layer when the preset is a plain mono and Nerd is enabled", () => {
      const stack = buildFontStack({
        presetName: "Cascadia Mono",
        nerdFontEnabled: true,
        cjkEnabled: false,
        emojiEnabled: false,
      });
      // jsdom doesn't expose real fonts so detectInstalledNerdFont returns "" and we fall back to Pure Nerd Font.
      expect(stack.symbol).toBe('"Pure Nerd Font"');
    });

    it("omits the symbol layer when Nerd is disabled by user", () => {
      const stack = buildFontStack({
        presetName: "Cascadia Mono",
        nerdFontEnabled: false,
        cjkEnabled: false,
        emojiEnabled: false,
      });
      expect(stack.symbol).toBe("");
    });

    it("drops CJK and emoji when user toggles them off", () => {
      const stack = buildFontStack({
        presetName: "Cascadia Mono",
        nerdFontEnabled: false,
        cjkEnabled: false,
        emojiEnabled: false,
      });
      expect(stack.cjk).toBe("");
      expect(stack.emoji).toBe("");
    });
  });

  describe("buildFontFamilyCss", () => {
    it("matches the chained buildFontStack+buildCssFontFamily pipeline", () => {
      const pref = {
        presetName: "Cascadia Mono",
        nerdFontEnabled: true,
        cjkEnabled: true,
        emojiEnabled: true,
      };
      expect(buildFontFamilyCss(pref)).toBe(
        buildCssFontFamily(buildFontStack(pref)),
      );
    });
  });

  describe("__TESTING__ helpers", () => {
    it("quoteFontFamily escapes embedded double quotes and backslashes", () => {
      expect(__TESTING__.quoteFontFamily('a"b\\c')).toBe('"a\\"b\\\\c"');
    });

    it("isNerdFontVariant matches the canonical naming convention", () => {
      expect(__TESTING__.isNerdFontVariant("JetBrainsMono Nerd Font")).toBe(true);
      expect(__TESTING__.isNerdFontVariant("FiraCode Nerd Font Mono")).toBe(true);
      expect(__TESTING__.isNerdFontVariant("Symbols Nerd Font")).toBe(true);
      expect(__TESTING__.isNerdFontVariant("Cascadia Mono")).toBe(false);
      expect(__TESTING__.isNerdFontVariant("Menlo")).toBe(false);
    });
  });
});