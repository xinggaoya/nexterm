/**
 * xterm 选项聚合器。
 *
 * 把 Preferences 里散落的字号/字体/光标/行为配置集中起来,
 * 派生 xterm 接受的 ITerminalOptions。所有 xterm 初始化入口都走这里,
 * 避免散落在 renderer / pane / settings 各处的 option 拼接。
 */

import type { ITerminalOptions } from "@xterm/xterm";
import type { ITheme } from "@xterm/xterm";
import type { RendererKind } from "./rendererPipeline";

export type TerminalCursorStyle = "block" | "underline" | "bar";
export type TerminalCursorInactiveStyle =
  | "outline"
  | "block"
  | "bar"
  | "underline"
  | "none";
export type TerminalFastScrollModifier = "alt" | "ctrl" | "shift";
export type FontWeight =
  | 100
  | 200
  | 300
  | 400
  | 500
  | 600
  | 700
  | 800
  | 900;

export interface TerminalTypographyConfig {
  /** CSS font-family 串 */
  fontFamily: string;
  fontSize: number;
  fontWeight: FontWeight;
  fontWeightBold: FontWeight;
  /** 用户偏好里的 letterSpacing (-10..10) */
  letterSpacing: number;
}

export interface TerminalCursorConfig {
  style: TerminalCursorStyle;
  width: number;
  blink: boolean;
  inactiveStyle: TerminalCursorInactiveStyle;
}

export interface TerminalBehaviorConfig {
  scrollback: number;
  fastScrollSensitivity: number;
  fastScrollModifier: TerminalFastScrollModifier;
  scrollOnUserInput: boolean;
  macOptionIsMeta: boolean;
  macOptionClickForcesSelection: boolean;
  /** 1..21,默认 1(不调整) */
  minimumContrastRatio: number;
  drawBoldTextInBrightColors: boolean;
  customGlyphs: boolean;
  rescaleOverlappingGlyphs: boolean;
}

export interface TerminalRenderConfig {
  renderer: RendererKind;
  autoFallback: boolean;
  watchDpi: boolean;
}

export interface TerminalOptionsInput {
  typography: TerminalTypographyConfig;
  cursor: TerminalCursorConfig;
  behavior: TerminalBehaviorConfig;
  render: TerminalRenderConfig;
  theme: ITheme;
}

const FONT_WEIGHTS: readonly FontWeight[] = [
  100, 200, 300, 400, 500, 600, 700, 800, 900,
];

export function clampFontWeight(value: number): FontWeight {
  const intVal = Math.round(value / 100) * 100;
  const clamped = Math.max(100, Math.min(900, intVal));
  return (FONT_WEIGHTS.includes(clamped as FontWeight)
    ? (clamped as FontWeight)
    : 400);
}

/**
 * 字号 → letterSpacing 推导。
 * 用户偏好 letterSpacing 是个相对强度(原代码:0~10),实际像素按字号缩放,
 * 防止大字间距过宽、小字间距太窄。
 */
export function deriveLetterSpacingPx(
  fontSize: number,
  letterSpacing: number,
): number {
  const safeSpacing = Math.max(-10, Math.min(10, letterSpacing));
  // 经验公式:每 1 个强度单位 ≈ fontSize * 0.04 px
  return Math.round(fontSize * 0.04 * (safeSpacing / 5));
}

export function clampMinimumContrastRatio(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(21, value));
}

export function clampFastScrollSensitivity(value: number): number {
  if (!Number.isFinite(value)) return 5;
  return Math.max(1, Math.min(20, Math.round(value)));
}

export function clampScrollback(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.round(value));
}

export function clampCursorWidth(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(5, Math.round(value)));
}

export function buildTerminalOptions(
  input: TerminalOptionsInput,
): ITerminalOptions {
  const { typography, cursor, behavior, theme } = input;
  const letterSpacingPx = deriveLetterSpacingPx(
    typography.fontSize,
    typography.letterSpacing,
  );
  return {
    cursorBlink: cursor.blink,
    cursorStyle: cursor.style,
    cursorWidth: clampCursorWidth(cursor.width),
    fontSize: typography.fontSize,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeight,
    fontWeightBold: typography.fontWeightBold,
    letterSpacing: letterSpacingPx,
    scrollback: clampScrollback(behavior.scrollback, 2000),
    fastScrollSensitivity: clampFastScrollSensitivity(
      behavior.fastScrollSensitivity,
    ),
    scrollOnUserInput: behavior.scrollOnUserInput,
    macOptionIsMeta: behavior.macOptionIsMeta,
    macOptionClickForcesSelection: behavior.macOptionClickForcesSelection,
    minimumContrastRatio: clampMinimumContrastRatio(
      behavior.minimumContrastRatio,
    ),
    drawBoldTextInBrightColors: behavior.drawBoldTextInBrightColors,
    // NOTE: customGlyphs 在 xterm 6.1 起从 ITerminalOptions 移除,改为
    // WebglAddon 构造参数,由 rendererPipeline 在 attach WebGL 时传入。
    rescaleOverlappingGlyphs: behavior.rescaleOverlappingGlyphs,
    theme,
    allowProposedApi: true,
    convertEol: false,
    // 细滚动条：verticalScrollbarSize/verticalSliderSize 是 xterm 内部 options
    // (继承自 VS Code AbstractScrollbar，公开 IScrollbarOptions 类型未声明但实现
    // 会读取 typeof n.verticalScrollbarSize<"u"?n.verticalScrollbarSize:10)。
    // 用 option 而非 CSS：xterm 用 (scrollbarSize-sliderSize)/2 算滑块 left 居中，
    // 只靠 CSS 强改 width 会让 left 计算错位(滑块贴左)，用 option 内部状态才一致。
    // 切勿用 scrollbar.width —— 它是 overview ruler 宽度，设置会启用
    // OverviewRulerRenderer 在右侧画 overviewRulerBorder 竖线(=白线)。
    scrollbar: {
      verticalScrollbarSize: 6,
      verticalSliderSize: 4,
    } as ITerminalOptions["scrollbar"],
    // renderer 在外部 pipeline 里挂载,此处不参与 ITerminalOptions
  };
}

export const TERMINAL_CURSOR_STYLES: readonly TerminalCursorStyle[] = [
  "block",
  "underline",
  "bar",
];

export const TERMINAL_CURSOR_INACTIVE_STYLES: readonly TerminalCursorInactiveStyle[] =
  ["outline", "block", "bar", "underline", "none"];

export const TERMINAL_FAST_SCROLL_MODIFIERS: readonly TerminalFastScrollModifier[] =
  ["alt", "ctrl", "shift"];