// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  buildCssFontFamily,
  buildFontFamilyCss,
  buildFontStack,
  type FontStack,
} from "./fontStack";
import { buildTerminalOptions } from "./terminalOptions";

describe("renderer integration (smoke)", () => {
  const STACK: FontStack = {
    primary: '"JetBrains Mono"',
    symbol: '"Pure Nerd Font"',
    cjk: "",
    emoji: "",
    fallback: "ui-monospace",
  };

  it("produces a layered chain for the bundled font", () => {
    expect(buildCssFontFamily(STACK)).toBe(
      '"JetBrains Mono", "Pure Nerd Font", ui-monospace',
    );
  });

  it("routes through buildFontStack for preset selection", () => {
    const css = buildFontFamilyCss({
      presetName: "",
      nerdFontEnabled: true,
      cjkEnabled: true,
      emojiEnabled: true,
    });
    expect(typeof css).toBe("string");
    expect(css.length).toBeGreaterThan(0);
  });

  it("emits cell-safe options for the default font size", () => {
    const options = buildTerminalOptions({
      typography: {
        fontFamily: '"JetBrains Mono", "Pure Nerd Font"',
        fontSize: 14,
        fontWeight: 400,
        fontWeightBold: 700,
        letterSpacing: 0,
      },
      cursor: {
        style: "block",
        width: 1,
        blink: true,
        inactiveStyle: "outline",
      },
      behavior: {
        scrollback: 5000,
        fastScrollSensitivity: 5,
        fastScrollModifier: "alt",
        scrollOnUserInput: true,
        macOptionIsMeta: true,
        macOptionClickForcesSelection: false,
        minimumContrastRatio: 1,
        drawBoldTextInBrightColors: true,
        customGlyphs: true,
        rescaleOverlappingGlyphs: true,
      },
      render: {
        renderer: "webgl",
        autoFallback: true,
        watchDpi: true,
      },
      theme: { background: "#000", foreground: "#fff" },
    });
    expect(options.customGlyphs).toBe(true);
    expect(options.rescaleOverlappingGlyphs).toBe(true);
    expect(options.convertEol).toBe(false);
    expect(options.cursorBlink).toBe(true);
  });

  it("skips the symbol layer when the preset is a Nerd Font variant", () => {
    const stack = buildFontStack({
      presetName: "JetBrainsMono Nerd Font",
      nerdFontEnabled: true,
      cjkEnabled: false,
      emojiEnabled: false,
    });
    expect(stack.symbol).toBe("");
  });
});