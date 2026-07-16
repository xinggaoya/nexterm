import { describe, expect, it } from "vitest";
import {
  buildTerminalFontFamily,
  DEFAULT_MONO_FONT_FAMILY,
} from "@/lib/fonts";
import { createTerminalOptions } from "./renderer";

describe("terminal renderer options", () => {
  it("uses bundled JetBrains Mono and Nerd symbols in automatic mode", () => {
    expect(buildTerminalFontFamily("")).toBe(DEFAULT_MONO_FONT_FAMILY);
    expect(DEFAULT_MONO_FONT_FAMILY).toContain('"JetBrains Mono"');
    expect(DEFAULT_MONO_FONT_FAMILY).toContain('"Pure Nerd Font"');
  });

  it("keeps a selected font first and appends stable fallbacks", () => {
    expect(buildTerminalFontFamily("Cascadia Mono")).toBe(
      '"Cascadia Mono", "JetBrains Mono", "Pure Nerd Font", SFMono-Regular, Menlo, monospace',
    );
  });

  it("enables cell-safe glyph rendering and restores letter spacing", () => {
    const options = createTerminalOptions({
      fontFamily: "",
      fontSize: 15,
      letterSpacing: 1,
      scrollback: 10_000,
    });

    expect(options.customGlyphs).toBe(true);
    expect(options.rescaleOverlappingGlyphs).toBe(true);
    expect(options.letterSpacing).toBe(1);
    expect(options.convertEol).toBe(false);
  });
});
