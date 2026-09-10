import type { GlobalTheme, GlobalThemeOverrides } from "naive-ui";
import { darkTheme } from "naive-ui";
import { normalizeAppTokens, readAppTokens, type AppTokens } from "@/styles/tokens";

export type ResolvedTheme = "dark" | "light";

export function getNaiveTheme(theme: ResolvedTheme): GlobalTheme | null {
  return theme === "dark" ? darkTheme : null;
}

/**
 * 读取当前文档实际生效的 Naive 主题,供 createApp 独立挂载的对话框
 * (如 SshConnectDialog)自带 NConfigProvider 使用——MainApp.vue 的
 * 主题注入不会跨越独立 app 边界。明暗以 <html> 上由 syncDocumentTheme
 * 同步的 dark/light class 为准,返回打开瞬间的快照。
 */
export function readCurrentNaiveThemeConfig(): {
  theme: GlobalTheme | null;
  themeOverrides: GlobalThemeOverrides;
} {
  const dark = document.documentElement.classList.contains("dark");
  return {
    theme: getNaiveTheme(dark ? "dark" : "light"),
    themeOverrides: buildNaiveThemeOverrides(readAppTokens()),
  };
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
