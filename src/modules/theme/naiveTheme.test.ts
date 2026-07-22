import { describe, expect, it } from "vitest";
import {
  buildNaiveThemeOverrides,
  getNaiveTheme,
  type ResolvedTheme,
} from "./naiveTheme";
import type { AppTokens } from "@/styles/tokens";

const mockTokens: AppTokens = {
  background: "rgb(10, 10, 10)",
  foreground: "rgb(250, 250, 250)",
  card: "rgb(20, 20, 20)",
  muted: "rgb(32, 32, 32)",
  "muted-foreground": "rgb(160, 160, 160)",
  accent: "rgb(48, 48, 48)",
  "accent-foreground": "rgb(250, 250, 250)",
  border: "rgb(64, 64, 64)",
  primary: "rgb(34, 211, 238)",
  "primary-foreground": "rgb(4, 12, 16)",
  destructive: "rgb(248, 113, 113)",
  success: "rgb(139, 212, 80)",
  warning: "rgb(242, 184, 75)",
  info: "rgb(167, 139, 250)",
  ring: "rgb(113, 113, 122)",
  "shell-bg": "rgb(11, 14, 17)",
  "surface-subtle": "rgb(18, 24, 32)",
  "surface-hover": "rgb(32, 42, 52)",
  "activity-bar": "rgb(20, 20, 22)",
  "title-bar": "rgb(24, 24, 26)",
  "terminal-focus": "rgb(59, 130, 246)",
  "pane-handle": "rgb(48, 48, 52)",
  "pane-handle-active": "rgb(100, 140, 230)",
  "panel-bg": "rgb(22, 22, 24)",
};

describe("naive theme bridge", () => {
  it("returns a Naive UI dark theme only for dark mode", () => {
    expect(getNaiveTheme("dark")).toBeTruthy();
    expect(getNaiveTheme("light")).toBeNull();
  });

  it("maps app tokens into Naive UI common theme overrides", () => {
    const overrides = buildNaiveThemeOverrides(mockTokens);

    expect(overrides.common?.borderRadius).toBe("4px");
    expect(overrides.common?.bodyColor).toBe("rgb(10, 10, 10)");
    expect(overrides.common?.textColorBase).toBe("rgb(250, 250, 250)");
    expect(overrides.common?.cardColor).toBe("rgb(20, 20, 20)");
    expect(overrides.common?.primaryColor).toBe("rgb(34, 211, 238)");
    expect(overrides.common?.primaryColorHover).toBe("rgb(34, 211, 238)");
    expect(overrides.common?.successColor).toBe("rgb(139, 212, 80)");
    expect(overrides.common?.warningColor).toBe("rgb(242, 184, 75)");
    expect(overrides.common?.infoColor).toBe("rgb(167, 139, 250)");
    expect(overrides.common?.errorColor).toBe("rgb(248, 113, 113)");
    expect(overrides.common?.borderColor).toBe("rgb(64, 64, 64)");
  });

  it("uses compact notification sizing", () => {
    const overrides = buildNaiveThemeOverrides(mockTokens);

    expect(overrides.Notification).toMatchObject({
      width: "300px",
      padding: "10px 12px",
      titleFontSize: "13px",
      descriptionFontSize: "12px",
      closeSize: "18px",
      closeIconSize: "14px",
    });
  });

  it("does not pass oklch tokens through to Naive UI color helpers", () => {
    const overrides = buildNaiveThemeOverrides({
      ...mockTokens,
      primary: "oklch(0.218 0.008 223.9)",
    });

    expect(overrides.common?.primaryColor).toMatch(/^rgb\(/);
    expect(overrides.common?.primaryColor).not.toContain("oklch");
  });

  it("keeps the resolved theme type explicit for providers", () => {
    const theme: ResolvedTheme = "light";
    expect(getNaiveTheme(theme)).toBeNull();
  });
});
