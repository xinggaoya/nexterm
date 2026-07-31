/**
 * Theme integration between the app's CSS variables and xterm.js.
 *
 * xterm accepts a string per color slot, and `getComputedStyle` returns the
 * oklch variables declared in globals.css already resolved to `rgb(...)` /
 * `#rrggbb` by the browser, so no manual color-space conversion is needed.
 *
 * Listening to the document element lets us pick up both light/dark toggles
 * (.dark class) and any future token mutations triggered by the Settings
 * drawer without re-rendering the terminal UI.
 *
 * 增强:
 * - 监听 fonts loadingdone 事件,字体异步加载完成后强制重新 apply
 * - 监听 prefs-changed Tauri 事件,设置实时改 token 时强制刷新
 */

import type { ITheme } from "@xterm/xterm";

const THEME_VARIABLES = [
  "--term-bg",
  "--term-fg",
  "--term-cursor",
  "--term-cursor-accent",
  "--term-selection",
  "--term-black",
  "--term-red",
  "--term-green",
  "--term-yellow",
  "--term-blue",
  "--term-magenta",
  "--term-cyan",
  "--term-white",
  "--term-bright-black",
  "--term-bright-red",
  "--term-bright-green",
  "--term-bright-yellow",
  "--term-bright-blue",
  "--term-bright-magenta",
  "--term-bright-cyan",
  "--term-bright-white",
  "--term-link",
] as const;

type ThemeVariable = (typeof THEME_VARIABLES)[number];

function readCssVars(): Record<ThemeVariable, string> {
  const styles = getComputedStyle(document.documentElement);
  const result = {} as Record<ThemeVariable, string>;
  for (const name of THEME_VARIABLES) {
    result[name] = styles.getPropertyValue(name).trim();
  }
  return result;
}

/**
 * 把前景色与透明度合成成 scrollbar 滑块颜色。
 *
 * `--term-fg` 已被浏览器从 oklch 解析成 `rgb(...)` / `#rrggbb`（见文件头
 * 注释），`color-mix(in srgb, <fg> X%, transparent)` 在所有现代浏览器都
 * 可用且等价于 alpha=X%。fallback：变量缺失时返回 undefined，xterm 会退
 * 回它自己的默认（foreground 20/40/50%）。
 */
function fgMix(fg: string, opacity: number): string | undefined {
  if (!fg) return undefined;
  const pct = Math.round(opacity * 100);
  return `color-mix(in srgb, ${fg} ${pct}%, transparent)`;
}

export function buildTerminalTheme(): ITheme {
  const v = readCssVars();
  const theme: ITheme = {
    background: v["--term-bg"],
    foreground: v["--term-fg"],
    cursor: v["--term-cursor"],
    cursorAccent: v["--term-cursor-accent"],
    selectionBackground: v["--term-selection"],
    black: v["--term-black"],
    red: v["--term-red"],
    green: v["--term-green"],
    yellow: v["--term-yellow"],
    blue: v["--term-blue"],
    magenta: v["--term-magenta"],
    cyan: v["--term-cyan"],
    white: v["--term-white"],
    brightBlack: v["--term-bright-black"],
    brightRed: v["--term-bright-red"],
    brightGreen: v["--term-bright-green"],
    brightYellow: v["--term-bright-yellow"],
    brightBlue: v["--term-bright-blue"],
    brightMagenta: v["--term-bright-magenta"],
    brightCyan: v["--term-bright-cyan"],
    brightWhite: v["--term-bright-white"],
    // 滚动条滑块颜色：基于终端前景色用 color-mix 淡化，随主题切换自动跟随
    // （本函数由 watchTerminalTheme 的 MutationObserver 在 .dark / token 变化时
    // 重新调用）。透明度取 xterm 默认同档（20/40/50%），视觉上若隐若现、
    // hover/active 递进加深。用原生 ITheme 字段而非 CSS 覆盖：xterm 6 会把这些
    // 颜色注入内联 <style>（.xterm-scrollbar > .xterm-slider），不会被应用 CSS
    // 的 !important 对抗，也不会因 xterm 改 DOM 类名而失效。
    scrollbarSliderBackground: fgMix(v["--term-fg"], 0.2),
    scrollbarSliderHoverBackground: fgMix(v["--term-fg"], 0.4),
    scrollbarSliderActiveBackground: fgMix(v["--term-fg"], 0.5),
  };
  // OSC 8 链接色(可选,变量未声明时为空串,xterm 会忽略)
  if (v["--term-link"]) {
    // xterm v6 typings 不支持 link,但保留字段以备扩展
    (theme as unknown as { [k: string]: string })["selectionForeground"] =
      v["--term-link"];
  }
  return theme;
}

export function applyTerminalTheme(target: {
  options: { theme?: ITheme };
}): void {
  target.options.theme = buildTerminalTheme();
}

/**
 * 监听文档主题变化 + 字体加载完成事件 + 偏好变更事件,
 * 任一触发即调用 callback。callback 通常是 applyTerminalTheme。
 *
 * 返回 dispose。
 */
export function watchTerminalTheme(callback: () => void): () => void {
  const disposers: Array<() => void> = [];
  let disposed = false;

  // 包装 callback:dispose 后忽略;执行异常被吞掉防止 unhandled rejection。
  const safeCallback = (): void => {
    if (disposed) return;
    try {
      callback();
    } catch {
      // theme 应用在 disposed term 上可能抛;静默忽略。
    }
  };

  if (typeof document === "undefined") return () => {};

  const observer = new MutationObserver(() => safeCallback());
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style"],
  });
  disposers.push(() => observer.disconnect());

  if (document.fonts?.addEventListener) {
    const handler = () => safeCallback();
    document.fonts.addEventListener("loadingdone", handler);
    disposers.push(() =>
      document.fonts.removeEventListener("loadingdone", handler),
    );
  }

  // Tauri prefs-changed 事件:设置面板改 token 时触发
  // 用 import 异步导入避免顶层依赖循环。
  // 注意:动态 import 完成前发生的 prefs-changed 会丢失,需要在设置面板
  // 改 CSS token 时直接写 inline style 以保及时性(由调用方决定)。
  let unlistenPrefs: (() => void) | undefined;
  void import("@/modules/settings/store").then(({ onPreferencesChange }) => {
    if (disposed) return;
    if (typeof onPreferencesChange !== "function") return;
    void onPreferencesChange(() => safeCallback()).then((fn: () => void) => {
      // import 期间 pane 已 dispose,丢弃订阅
      if (disposed) {
        try {
          fn();
        } catch {
          // ignore
        }
        return;
      }
      unlistenPrefs = fn;
    });
  });
  disposers.push(() => unlistenPrefs?.());

  return () => {
    disposed = true;
    for (const d of disposers) {
      try {
        d();
      } catch {
        // ignore
      }
    }
  };
}
