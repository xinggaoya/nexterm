/**
 * Backward-compatible thin wrapper around the new layered font stack.
 *
 * 新实现已搬到 src/modules/terminal/lib/fontStack.ts,这里保留旧导出名
 * (`DEFAULT_MONO_FONT_FAMILY`、`buildTerminalFontFamily`、`ensureMonoFontsLoaded`、
 * `detectMonoFontFamily`、`NERD_SYMBOL_FONT_FAMILY`),避免 editorConfig / markdown / 等
 * 旧调用方破坏。新代码请直接 import 自 fontStack。
 */

import {
  buildFontFamilyCss,
  buildFontStack,
  detectInstalledMonoFont,
  ensureFontStackLoaded as _ensureFontStackLoaded,
  type FontPreference,
} from "@/modules/terminal/lib/fontStack";

/** @deprecated use fontStack.buildFontFamilyCss */
export const DEFAULT_MONO_FONT_FAMILY =
  '"JetBrains Mono", "Pure Nerd Font", SFMono-Regular, Menlo, monospace';

/** @deprecated use fontStack symbol layer */
export const NERD_SYMBOL_FONT_FAMILY = "Pure Nerd Font";

/**
 * @deprecated use buildFontFamilyCss({ presetName, ... }) directly.
 * 历史行为:把 presetName 拼到 fallback chain 头部,空串走默认。
 */
export function buildTerminalFontFamily(preferred: string): string {
  return buildFontFamilyCss({
    presetName: preferred,
    nerdFontEnabled: true,
    cjkEnabled: false,
    emojiEnabled: false,
  } satisfies FontPreference);
}

/** @deprecated use fontStack.detectInstalledMonoFont */
export function detectMonoFontFamily(): string {
  const installed = detectInstalledMonoFont();
  // 历史行为:返回带 fallback chain 的 CSS 串
  return buildFontFamilyCss({
    presetName: installed,
    nerdFontEnabled: true,
    cjkEnabled: false,
    emojiEnabled: false,
  });
}

let monoReady: Promise<void> | null = null;

/** @deprecated use ensureFontStackLoaded */
export function ensureMonoFontsLoaded(): Promise<void> {
  if (monoReady) return monoReady;
  monoReady = _ensureFontStackLoaded(
    buildFontStack({
      presetName: "",
      nerdFontEnabled: true,
      cjkEnabled: false,
      emojiEnabled: false,
    }),
    14,
  ).then(() => undefined);
  return monoReady;
}

/**
 * @deprecated use ensureFontStackLoaded
 * 历史签名:只支持 primary + symbol 加载,新签名支持 cjk + emoji。
 */
export async function ensureFontFamilyLoaded(
  fontFamily: string,
  fontSize: number,
): Promise<void> {
  await _ensureFontStackLoaded(
    buildFontStack({
      presetName: fontFamily,
      nerdFontEnabled: true,
      cjkEnabled: false,
      emojiEnabled: false,
    }),
    fontSize,
  );
}
