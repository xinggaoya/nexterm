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

    expect(tokens.primary).toBe("rgb(124, 215, 232)");
  });
});
