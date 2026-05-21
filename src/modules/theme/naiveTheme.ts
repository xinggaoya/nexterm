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
      primaryColorHover: t.foreground,
      primaryColorPressed: t.primary,
      primaryColorSuppl: t.primary,
      infoColor: t.primary,
      borderColor: t.border,
      dividerColor: t.border,
      inputColor: t.background,
      closeIconColor: t["muted-foreground"],
      closeIconColorHover: t.foreground,
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
