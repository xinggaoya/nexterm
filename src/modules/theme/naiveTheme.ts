import type { GlobalTheme, GlobalThemeOverrides } from "naive-ui";
import { darkTheme } from "naive-ui";
import { normalizeAppTokens, type AppTokens } from "@/styles/tokens";

export type ResolvedTheme = "dark" | "light";

export function getNaiveTheme(theme: ResolvedTheme): GlobalTheme | null {
  return theme === "dark" ? darkTheme : null;
}

export function buildNaiveThemeOverrides(
  tokens: AppTokens,
): GlobalThemeOverrides {
  const t = normalizeAppTokens(tokens);

  return {
    common: {
      bodyColor: t.background,
      baseColor: t.background,
      cardColor: t.card,
      modalColor: t.card,
      popoverColor: t.card,
      textColorBase: t.foreground,
      textColor1: t.foreground,
      textColor2: t.foreground,
      textColor3: t["muted-foreground"],
      primaryColor: t.primary,
      primaryColorHover: t.primary,
      primaryColorPressed: t.primary,
      primaryColorSuppl: t.primary,
      infoColor: t.info,
      successColor: t.success,
      warningColor: t.warning,
      errorColor: t.destructive,
      borderColor: t.border,
      dividerColor: t.border,
      inputColor: t.background,
      closeIconColor: t["muted-foreground"],
      closeIconColorHover: t.foreground,
      borderRadius: "4px",
      borderRadiusSmall: "3px",
      fontFamily:
        "'Inter Variable', Inter, ui-sans-serif, system-ui, sans-serif",
      fontFamilyMono:
        "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
    },
    Button: {
      borderRadiusTiny: "3px",
      borderRadiusSmall: "4px",
      borderRadiusMedium: "6px",
      borderRadiusLarge: "6px",
      textColorPrimary: t["primary-foreground"],
    },
    Card: {
      borderRadius: "6px",
    },
    Dialog: {
      borderRadius: "8px",
    },
    Input: {
      borderRadius: "4px",
    },
    Tag: {
      borderRadius: "3px",
    },
    Tabs: {
      tabHeightMedium: "36px",
      tabGapMedium: "0px",
      tabFontSizeMedium: "13px",
      barColor: t.primary,
    },
    Notification: {
      width: "300px",
      padding: "10px 12px",
      titleFontSize: "13px",
      descriptionFontSize: "12px",
      closeSize: "18px",
      closeIconSize: "14px",
    },
  };
}
