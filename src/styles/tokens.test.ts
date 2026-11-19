// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readAppTokens } from "./tokens";

function mockComputedTokenColors(tokens: Record<string, string>) {
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    const varName = /var\(--([^)]+)\)/.exec(
      (element as HTMLElement).style.color,
    )?.[1];

    return {
      color: varName ? tokens[varName] ?? "rgb(1, 2, 3)" : "rgb(1, 2, 3)",
    } as CSSStyleDeclaration;
  });
}

describe("app token colors", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes browser-preserved oklch values before exposing tokens", () => {
    mockComputedTokenColors({
      primary: "oklch(0.218 0.008 223.9)",
    });

    const tokens = readAppTokens();

    expect(tokens.primary).toMatch(/^rgb\(/);
    expect(tokens.primary).not.toContain("oklch");
  });

  it("keeps existing rgb and rgba values consumable", () => {
    mockComputedTokenColors({
      primary: "rgb(12, 34, 56)",
      "primary-foreground": "rgb(4, 12, 16)",
      destructive: "rgba(239, 68, 68, 0.8)",
      success: "rgb(139, 212, 80)",
      warning: "rgb(242, 184, 75)",
    });

    const tokens = readAppTokens();

    expect(tokens.primary).toBe("rgb(12, 34, 56)");
    expect(tokens["primary-foreground"]).toBe("rgb(4, 12, 16)");
    expect(tokens.destructive).toBe("rgba(239, 68, 68, 0.8)");
    expect(tokens.success).toBe("rgb(139, 212, 80)");
    expect(tokens.warning).toBe("rgb(242, 184, 75)");
  });

  it("falls back when a runtime color cannot be normalized", () => {
    mockComputedTokenColors({
      primary: "not-a-color",
    });

    const tokens = readAppTokens();

    expect(tokens.primary).toBe("rgb(72, 215, 254)");
  });

  it("maps out-of-gamut colors by reducing chroma instead of clipping channels", () => {
    // oklch(0.7 0.3 30) 的 sRGB 分量超出 [0,255]：逐通道硬截断会让色相
    // 偏移（偏橙），按色域收敛彩度则与浏览器渲染一致（偏红）。
    mockComputedTokenColors({
      primary: "oklch(0.7 0.3 30)",
    });

    const tokens = readAppTokens();

    expect(tokens.primary).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    const [r, g, b] = tokens.primary
      .replace(/^rgb\(|\)$/g, "")
      .split(",")
      .map((v) => Number(v.trim()));
    // 收敛后仍在色域内，且绿色分量明显高于硬截断的结果（截断会把它压到 0）。
    expect(r).toBeGreaterThan(0);
    expect(g).toBeGreaterThan(50);
    expect(b).toBeLessThan(150);
  });
});
