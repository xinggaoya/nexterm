/**
 * Runtime resolution of shadcn CSS custom properties into concrete rgb strings.
 *
 * globals.css declares tokens in oklch(), which xterm.js (WebGL) and
 * CodeMirror's static theme builder can't consume directly. We resolve each
 * token through the browser, then normalize modern color syntax into rgb/rgba.
 * Recent Chromium builds can preserve oklch() in getComputedStyle(), while
 * Naive UI's color helpers still expect legacy color strings.
 *
 * 色彩空间换算交给 culori：OKLab 矩阵、sRGB gamma、oklch 语法解析都是
 * 社区验证过二十年的实现，自己维护一份只会慢慢偏（尤其是超色域色彩的
 * 处理）。culori 默认会按 sRGB 色域收敛彩度，与浏览器渲染 oklch() 的
 * 行为一致 —— 逐通道硬截断会让色相偏移。
 *
 * Tokens are read once per call. Callers that need to react to theme changes
 * (light/dark toggle) should re-invoke and rebuild their theme object.
 */
import { clampChroma, converter, formatRgb, inGamut, parse } from "culori";

type TokenName =
  | "background"
  | "foreground"
  | "card"
  | "muted"
  | "muted-foreground"
  | "accent"
  | "accent-foreground"
  | "border"
  | "primary"
  | "primary-foreground"
  | "destructive"
  | "success"
  | "warning"
  | "info"
  | "ring"
  | "shell-bg"
  | "surface-subtle"
  | "surface-hover"
  | "activity-bar"
  | "title-bar"
  | "terminal-focus"
  | "pane-handle"
  | "pane-handle-active"
  | "panel-bg";

export type AppTokens = Record<TokenName, string>;

const TOKENS: TokenName[] = [
  "background",
  "foreground",
  "card",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "border",
  "primary",
  "primary-foreground",
  "destructive",
  "success",
  "warning",
  "info",
  "ring",
  "shell-bg",
  "surface-subtle",
  "surface-hover",
  "activity-bar",
  "title-bar",
  "terminal-focus",
  "pane-handle",
  "pane-handle-active",
  "panel-bg",
];

export const FALLBACK_APP_TOKENS: AppTokens = {
  // 暗色主题的兜底值：由 globals.css 的 `.dark` 令牌经同一套换算生成
  // （culori + sRGB 色域收敛），与浏览器实际渲染一致。主题改了要重新生成。
  background: "rgb(8, 10, 13)",
  foreground: "rgb(230, 232, 234)",
  card: "rgb(16, 19, 22)",
  muted: "rgb(22, 25, 28)",
  "muted-foreground": "rgb(137, 141, 145)",
  accent: "rgb(30, 34, 38)",
  "accent-foreground": "rgb(230, 232, 234)",
  border: "rgba(255, 255, 255, 0.07)",
  primary: "rgb(72, 215, 254)",
  "primary-foreground": "rgb(6, 9, 13)",
  destructive: "rgb(255, 99, 103)",
  success: "rgb(89, 212, 131)",
  warning: "rgb(247, 184, 61)",
  info: "rgb(154, 160, 255)",
  ring: "rgb(72, 215, 254)",
  "shell-bg": "rgb(8, 10, 13)",
  "surface-subtle": "rgb(13, 16, 19)",
  "surface-hover": "rgb(30, 34, 38)",
  "activity-bar": "rgb(6, 7, 10)",
  "title-bar": "rgb(5, 7, 9)",
  "terminal-focus": "rgb(72, 215, 254)",
  "pane-handle": "rgb(33, 36, 40)",
  "pane-handle-active": "rgb(72, 215, 254)",
  "panel-bg": "rgb(13, 16, 19)",
};

let probe: HTMLDivElement | null = null;

function resolve(varName: TokenName): string {
  if (!probe) {
    probe = document.createElement("div");
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.pointerEvents = "none";
  }
  if (!probe.isConnected) {
    document.body.appendChild(probe);
  }
  probe.style.color = `var(--${varName})`;
  return getComputedStyle(probe).color;
}

export function readAppTokens(): AppTokens {
  const out = {} as AppTokens;
  for (const name of TOKENS) out[name] = resolve(name);
  return normalizeAppTokens(out);
}

export function normalizeAppTokens(tokens: AppTokens): AppTokens {
  const out = {} as AppTokens;
  for (const name of TOKENS) {
    out[name] = normalizeCssColor(tokens[name], FALLBACK_APP_TOKENS[name]);
  }
  return out;
}

const toRgb = converter("rgb");
const isInRgbGamut = inGamut("rgb");

function normalizeCssColor(color: string, fallback: string): string {
  const trimmed = color.trim();
  // rgb/rgba/hex 原样透传：消费方（Naive UI / xterm / CodeMirror）要的
  // 就是这种字符串，重新格式化没有收益，还会改掉已有字面量的精度。
  if (isSeemlyCompatibleColor(trimmed)) return trimmed;

  const parsed = parse(trimmed);
  if (!parsed) return fallback;

  // 超出色域的色彩先按 sRGB 收敛彩度（与浏览器渲染 oklch() 一致），
  // 再转 rgb；直接截断分量会让色相偏移。
  const mapped = isInRgbGamut(parsed) ? parsed : clampChroma(parsed, "oklch");
  return formatRgb(toRgb(mapped));
}

function isSeemlyCompatibleColor(color: string): boolean {
  return /^rgba?\(\s*\d/.test(color) || /^#[0-9a-f]{3,8}$/i.test(color);
}
