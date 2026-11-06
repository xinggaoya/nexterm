// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  buildNaiveThemeOverrides,
  getNaiveTheme,
  readCurrentNaiveThemeConfig,
  type ResolvedTheme,
} from "./naiveTheme";
import type { AppTokens } from "@/styles/tokens";
import { ACCENT_PRESETS, ACCENT_PRESET_SWATCHES } from "@/modules/settings/store";

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

  it("derives Naive radii from the shared radius scale", () => {
    const overrides = buildNaiveThemeOverrides(mockTokens);

    // common 保持控件档：密集控件（Switch / Checkbox / Slider / Tabs）
    // 继承 common.borderRadius，不能跟着容器一起变大。
    expect(overrides.common?.borderRadius).toBe("var(--radius-sm)");
    expect(overrides.common?.borderRadiusSmall).toBe("var(--radius-xs)");

    // 容器档组件显式上调。
    expect(overrides.Card?.borderRadius).toBe("var(--radius-lg)");
    expect(overrides.Dialog?.borderRadius).toBe("var(--radius-2xl)");
    expect(overrides.Dropdown?.borderRadius).toBe("var(--radius-xl)");
    expect(overrides.Popover?.borderRadius).toBe("var(--radius-xl)");
    expect(overrides.Menu?.borderRadius).toBe("var(--radius-lg)");
    expect(overrides.Notification?.borderRadius).toBe("var(--radius-lg)");
    expect(overrides.Message?.borderRadius).toBe("var(--radius-lg)");

    // 控件档组件维持紧凑。
    expect(overrides.Input?.borderRadius).toBe("var(--radius-sm)");
    expect(overrides.Tag?.borderRadius).toBe("var(--radius-xs)");
    expect(overrides.Button?.borderRadiusTiny).toBe("var(--radius-xs)");
    expect(overrides.Button?.borderRadiusSmall).toBe("var(--radius-sm)");
    expect(overrides.Button?.borderRadiusMedium).toBe("var(--radius-md)");
    expect(overrides.Button?.borderRadiusLarge).toBe("var(--radius-md)");

    // 圆角槽位里不允许再出现字面量 px —— 三条路径必须共用同一份 token。
    const radiusSlots =
      JSON.stringify(overrides).match(/"borderRadius[A-Za-z]*":"[^"]*"/g) ?? [];
    expect(radiusSlots.length).toBeGreaterThan(0);
    for (const slot of radiusSlots) {
      expect(slot).not.toMatch(/:\s*"\d+px"/);
    }
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

  it("drops oklch through for every accent preset swatch", () => {
    for (const preset of ACCENT_PRESETS) {
      const swatch = ACCENT_PRESET_SWATCHES[preset];
      const overrides = buildNaiveThemeOverrides({
        ...mockTokens,
        primary: swatch.dark,
        ring: swatch.dark,
        "terminal-focus": swatch.dark,
      });
      expect(overrides.common?.primaryColor).toMatch(/^rgb\(/);
      expect(overrides.common?.primaryColor).not.toContain("oklch");
      expect(overrides.common?.primaryColorHover).toMatch(/^rgb\(/);
      expect(overrides.common?.primaryColorPressed).toMatch(/^rgb\(/);
      expect(overrides.common?.primaryColorSuppl).toMatch(/^rgb\(/);
    }
  });

  it("reads the current theme from the dark/light class on <html>", () => {
    const root = document.documentElement;
    root.classList.add("dark");
    expect(readCurrentNaiveThemeConfig().theme).toBeTruthy();

    root.classList.remove("dark");
    expect(readCurrentNaiveThemeConfig().theme).toBeNull();
  });

  it("resolves detached-dialog overrides to rgb without leaking oklch", () => {
    const { themeOverrides } = readCurrentNaiveThemeConfig();
    expect(themeOverrides.common?.primaryColor).toMatch(/^rgb\(/);
    expect(themeOverrides.common?.bodyColor).not.toContain("oklch");
  });
});
