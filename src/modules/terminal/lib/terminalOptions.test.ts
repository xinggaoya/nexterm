import { describe, expect, it } from "vitest";
import {
  buildTerminalOptions,
  clampFastScrollSensitivity,
  clampFontWeight,
  clampMinimumContrastRatio,
  clampScrollback,
  clampCursorWidth,
  deriveLetterSpacingPx,
  type TerminalOptionsInput,
} from "./terminalOptions";

const BASE_INPUT: TerminalOptionsInput = {
  typography: {
    fontFamily: '"JetBrains Mono"',
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
    scrollback: 2000,
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
  theme: {
    background: "#000",
    foreground: "#fff",
  },
};

describe("terminalOptions", () => {
  it("buildTerminalOptions projects all config into xterm ITerminalOptions", () => {
    const options = buildTerminalOptions(BASE_INPUT);
    expect(options.fontSize).toBe(14);
    expect(options.fontFamily).toBe('"JetBrains Mono"');
    expect(options.fontWeight).toBe(400);
    expect(options.fontWeightBold).toBe(700);
    expect(options.letterSpacing).toBe(0);
    expect(options.cursorBlink).toBe(true);
    expect(options.cursorStyle).toBe("block");
    expect(options.scrollback).toBe(2000);
    expect(options.customGlyphs).toBe(true);
    expect(options.rescaleOverlappingGlyphs).toBe(true);
    expect(options.minimumContrastRatio).toBe(1);
    expect(options.macOptionIsMeta).toBe(true);
    expect(options.theme).toEqual({ background: "#000", foreground: "#fff" });
  });

  it("clamps fontWeight to the standard 100..900 ladder", () => {
    // 450 rounds up to 500; 999 clamps to 900; etc.
    expect(clampFontWeight(450)).toBe(500);
    expect(clampFontWeight(999)).toBe(900);
    expect(clampFontWeight(50)).toBe(100);
    expect(clampFontWeight(0)).toBe(100);
    expect(clampFontWeight(NaN)).toBe(400);
  });

  it("clamps minimumContrastRatio into 1..21", () => {
    expect(clampMinimumContrastRatio(0)).toBe(1);
    expect(clampMinimumContrastRatio(99)).toBe(21);
    expect(clampMinimumContrastRatio(4.5)).toBe(4.5);
    expect(clampMinimumContrastRatio(NaN)).toBe(1);
  });

  it("clamps fastScrollSensitivity into 1..20", () => {
    expect(clampFastScrollSensitivity(0)).toBe(1);
    expect(clampFastScrollSensitivity(99)).toBe(20);
    expect(clampFastScrollSensitivity(7)).toBe(7);
    expect(clampFastScrollSensitivity(NaN)).toBe(5);
  });

  it("clamps scrollback to non-negative integer", () => {
    expect(clampScrollback(-100, 2000)).toBe(0);
    expect(clampScrollback(1500.6, 2000)).toBe(1501);
    expect(clampScrollback(NaN, 2000)).toBe(2000);
  });

  it("clamps cursor width into 1..5", () => {
    expect(clampCursorWidth(0)).toBe(1);
    expect(clampCursorWidth(10)).toBe(5);
    expect(clampCursorWidth(2.7)).toBe(3);
    expect(clampCursorWidth(NaN)).toBe(1);
  });

  it("derives letterSpacing in pixels scaled by font size", () => {
    // 14px font with strength 0 → 0 px
    expect(deriveLetterSpacingPx(14, 0)).toBe(0);
    // 14px font with strength 5 → ceil(14 * 0.04) ≈ 1
    expect(deriveLetterSpacingPx(14, 5)).toBe(1);
    // 24px font with strength 10 → round(24 * 0.04 * 2) ≈ 2
    expect(deriveLetterSpacingPx(24, 10)).toBe(2);
    // strength clamped to -10..10
    expect(deriveLetterSpacingPx(14, -100)).toBeLessThanOrEqual(0);
    expect(deriveLetterSpacingPx(14, 100)).toBeGreaterThan(0);
  });
});