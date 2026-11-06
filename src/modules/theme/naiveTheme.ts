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

/**
 * 圆角槽位直接写 var(--radius-*) 而不是 px 字面量。
 *
 * naive-ui 对 borderRadius 只做字符串透传（`'--n-border-radius': value`），
 * 全库没有任何数值运算，因此 var() 可以安全穿过。这样 Tailwind 工具类 /
 * 手写 CSS / Naive 三条路径共用 globals.css 里的同一份 token。
 *
 * 档位与 globals.css 一致：控件档（xs/sm/md）给密集小控件，
 * 容器档（lg 起）给卡片、浮层、弹窗。
 */
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
      // common = 全局圆角配置 —— **全应用只有这一个圆角槽位**。
      // 不给任何组件单独配圆角：naive 的 Button / Tag / Card / Dialog /
      // Dropdown / Popover / Menu / Notification / Message 都从 common 继承
      // borderRadius（Button 的 tiny/small/medium/large 四档刻度在 naive
      // 主题里本身就等于 common.borderRadius），因此配一次即全局生效。
      //
      // NSelect 触发器的圆角也硬链在 common（naive 的 InternalSelectMenu
      // peer 直接从 common 解构，themeOverrides.Select 无此槽位）。
      borderRadius: "var(--radius-md)",
      borderRadiusSmall: "var(--radius-xs)",
      fontFamily:
        "'Inter Variable', Inter, ui-sans-serif, system-ui, sans-serif",
      fontFamilyMono:
        "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
    },
    Button: {
      textColorPrimary: t["primary-foreground"],
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
