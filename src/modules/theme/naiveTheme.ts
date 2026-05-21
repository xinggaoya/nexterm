import type { GlobalTheme, GlobalThemeOverrides } from "naive-ui";
import { darkTheme } from "naive-ui";
import type { AppTokens } from "@/styles/tokens";

export type ResolvedTheme = "dark" | "light";

export function getNaiveTheme(theme: ResolvedTheme): GlobalTheme | null {
  return theme === "dark" ? darkTheme : null;
}

export function buildNaiveThemeOverrides(
  tokens: AppTokens,
): GlobalThemeOverrides {
  return {
    common: {
      bodyColor: tokens.background,
      baseColor: tokens.background,
      cardColor: tokens.card,
      modalColor: tokens.card,
      popoverColor: tokens.card,
      textColorBase: tokens.foreground,
      textColor1: tokens.foreground,
      textColor2: tokens.foreground,
      textColor3: tokens["muted-foreground"],
      primaryColor: tokens.primary,
      primaryColorHover: tokens.foreground,
      primaryColorPressed: tokens.primary,
      primaryColorSuppl: tokens.primary,
      infoColor: tokens.primary,
      borderColor: tokens.border,
      dividerColor: tokens.border,
      inputColor: tokens.background,
      closeIconColor: tokens["muted-foreground"],
      closeIconColorHover: tokens.foreground,
      borderRadius: "8px",
      borderRadiusSmall: "6px",
      fontFamily:
        "'Inter Variable', Inter, ui-sans-serif, system-ui, sans-serif",
      fontFamilyMono:
        "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
    },
    Button: {
      borderRadiusTiny: "6px",
      borderRadiusSmall: "6px",
      borderRadiusMedium: "8px",
      borderRadiusLarge: "8px",
    },
    Card: {
      borderRadius: "8px",
    },
    Dialog: {
      borderRadius: "8px",
    },
  };
}
