import { describe, expect, it } from "vitest";
import {
  buildNaiveThemeOverrides,
  getNaiveTheme,
  type ResolvedTheme,
} from "./naiveTheme";

describe("naive theme bridge", () => {
  it("returns a Naive UI dark theme only for dark mode", () => {
    expect(getNaiveTheme("dark")).toBeTruthy();
    expect(getNaiveTheme("light")).toBeNull();
  });

  it("maps app tokens into Naive UI common theme overrides", () => {
    const overrides = buildNaiveThemeOverrides({
      background: "rgb(10, 10, 10)",
      foreground: "rgb(250, 250, 250)",
      card: "rgb(20, 20, 20)",
      muted: "rgb(32, 32, 32)",
      "muted-foreground": "rgb(160, 160, 160)",
      accent: "rgb(48, 48, 48)",
      "accent-foreground": "rgb(250, 250, 250)",
      border: "rgb(64, 64, 64)",
      primary: "rgb(228, 228, 231)",
      destructive: "rgb(248, 113, 113)",
      ring: "rgb(113, 113, 122)",
    });

    expect(overrides.common?.bodyColor).toBe("rgb(10, 10, 10)");
    expect(overrides.common?.textColorBase).toBe("rgb(250, 250, 250)");
    expect(overrides.common?.cardColor).toBe("rgb(20, 20, 20)");
    expect(overrides.common?.primaryColor).toBe("rgb(228, 228, 231)");
    expect(overrides.common?.borderColor).toBe("rgb(64, 64, 64)");
    expect(overrides.common?.borderRadius).toBe("8px");
  });

  it("keeps the resolved theme type explicit for providers", () => {
    const theme: ResolvedTheme = "light";
    expect(getNaiveTheme(theme)).toBeNull();
  });
});
