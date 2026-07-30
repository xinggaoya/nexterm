/**
 * xterm Terminal 实例的工厂与生命周期管理。
 *
 * 重构后职责拆分为:
 * - addons.ts   — fit/search/unicode/web-links/serialize/clipboard 装载
 * - rendererPipeline.ts — WebGL → DOM 回退管线
 * - terminalOptions.ts — ITerminalOptions 聚合
 * - fontStack.ts       — 分层字体回退
 * - dpiWatcher.ts      — DPI 变化监听
 *
 * 本文件只负责把上面这些模块粘合起来,提供 createTerminalRenderer 一个入口。
 */

import { Terminal } from "@xterm/xterm";
import {
  applyTerminalTheme,
  buildTerminalTheme,
  watchTerminalTheme,
} from "./theme";
import {
  buildFontStack,
  buildCssFontFamily,
  ensureFontStackLoaded,
  watchFontLoadingDone,
  type FontPreference,
} from "./fontStack";
import { loadStandardAddons, type StandardAddons } from "./addons";
import {
  attachRendererPipeline,
  type RendererKind,
  type RendererPipeline,
} from "./rendererPipeline";
import {
  buildTerminalOptions,
  clampFontWeight,
  deriveLetterSpacingPx,
  type TerminalOptionsInput,
} from "./terminalOptions";

export interface TerminalRendererPreferences {
  fontFamily: string;
  fontSize: number;
  letterSpacing: number;
  fontWeight: number;
  fontWeightBold: number;
  scrollback: number;
  /** 渲染器类型 webgl / dom */
  renderer: RendererKind;
  /** 是否启用 WebGL→DOM 自动降级 */
  rendererAutoFallback: boolean;
  /** DPI 监听 */
  watchDpi: boolean;
  /** 光标配置 */
  cursorStyle: "block" | "underline" | "bar";
  cursorBlink: boolean;
  cursorInactiveStyle:
    | "outline"
    | "block"
    | "bar"
    | "underline"
    | "none";
  /** xterm 行为配置 */
  fastScrollSensitivity: number;
  fastScrollModifier: "alt" | "ctrl" | "shift";
  macOptionIsMeta: boolean;
  macOptionClickForcesSelection: boolean;
  minimumContrastRatio: number;
  drawBoldTextInBrightColors: boolean;
  customGlyphs: boolean;
  rescaleOverlappingGlyphs: boolean;
  /** 字体偏好扩展(纯前端派生) */
  font: FontPreference;
  /** clipboard 桥 */
  clipboard?: {
    readText: () => Promise<string>;
    writeText: (text: string) => Promise<void>;
  };
}

export interface TerminalTypography {
  fontFamily: string;
  fontSize: number;
  letterSpacing: number;
}

export interface TerminalRenderer {
  term: Terminal;
  /** 立即 fit,如字号/容器变化后调用 */
  fit: () => void;
  /** 应用字号/字体/间距变化,内部重新加载字体并重画 */
  applyTypography: (typography: TerminalTypography) => Promise<void>;
  /** 调整 scrollback */
  setScrollback: (scrollback: number) => void;
  /** 切换渲染器 */
  setRenderer: (kind: RendererKind) => void;
  /** 当前生效的渲染器 */
  activeRenderer: () => RendererKind;
  /**
   * 强制重绘整个 buffer（不重算 cols/rows，也不通知 PTY）。
   * 用途：容器从 `display: none` 切回可见时,canvas 在隐藏期间被浏览器
   * 跳过绘制,切回后 xterm 不会自动补画——此时调用 redraw 让 buffer
   * 一次性刷到 canvas/WebGL 纹理上,避免出现"内容缺失,需输入字符才
   * 触发重绘"的视觉故障。
   */
  redraw: () => void;
  dispose: () => void;
}

interface CreateTerminalRendererOptions {
  container: HTMLElement;
  preferences: TerminalRendererPreferences;
  onResize: (cols: number, rows: number) => void;
}

export async function createTerminalRenderer(
  options: CreateTerminalRendererOptions,
): Promise<TerminalRenderer> {
  const prefs = options.preferences;
  const stack = buildFontStack(prefs.font);
  const fontFamilyCss = buildCssFontFamily(stack);
  const theme = buildTerminalTheme();

  // 1) 预加载字体栈
  await ensureFontStackLoaded(stack, prefs.fontSize);

  // 2) 构造 ITerminalOptions
  const optsInput: TerminalOptionsInput = {
    typography: {
      fontFamily: fontFamilyCss,
      fontSize: prefs.fontSize,
      fontWeight: clampFontWeight(prefs.fontWeight || 400),
      fontWeightBold: clampFontWeight(prefs.fontWeightBold || 700),
      letterSpacing: prefs.letterSpacing,
    },
    cursor: {
      style: prefs.cursorStyle,
      width: 1,
      blink: prefs.cursorBlink,
      inactiveStyle: prefs.cursorInactiveStyle,
    },
    behavior: {
      scrollback: prefs.scrollback,
      fastScrollSensitivity: prefs.fastScrollSensitivity,
      fastScrollModifier: prefs.fastScrollModifier,
      scrollOnUserInput: true,
      macOptionIsMeta: prefs.macOptionIsMeta,
      macOptionClickForcesSelection: prefs.macOptionClickForcesSelection,
      minimumContrastRatio: prefs.minimumContrastRatio,
      drawBoldTextInBrightColors: prefs.drawBoldTextInBrightColors,
      customGlyphs: prefs.customGlyphs,
      rescaleOverlappingGlyphs: prefs.rescaleOverlappingGlyphs,
    },
    render: {
      renderer: prefs.renderer,
      autoFallback: prefs.rendererAutoFallback,
      watchDpi: prefs.watchDpi,
    },
    theme,
  };
  const termOptions = buildTerminalOptions(optsInput);

  // 3) 创建 Terminal 实例
  const term = new Terminal(termOptions);

  // 4) 装载标准 addons(包含 clipboard)
  let addons: StandardAddons | null = loadStandardAddons(term, prefs.clipboard);

  // 5) 打开 DOM
  term.open(options.container);

  // 6) 主题响应
  const detachThemeWatch = watchTerminalTheme(() => {
    if (!disposed) applyTerminalTheme(term);
  });

  // 7) 字体异步加载完成后重画
  const detachFontWatch = watchFontLoadingDone(() => {
    if (!disposed) {
      try {
        term.clearTextureAtlas();
        if (term.rows > 0) term.refresh(0, term.rows - 1);
      } catch {
        // ignore
      }
    }
  });

  // 8) 渲染器管线
  let pipeline: RendererPipeline | null = attachRendererPipeline({
    term,
    preferred: prefs.renderer,
    autoFallback: prefs.rendererAutoFallback,
    watchDpi: prefs.watchDpi,
    customGlyphs: prefs.customGlyphs,
  });

  let lastCols = 0;
  let lastRows = 0;
  let disposed = false;
  let typographyRevision = 0;

  function fit(): void {
    if (disposed || !addons) return;
    try {
      addons.fit.fit();
    } catch {
      return;
    }
    if (term.cols === lastCols && term.rows === lastRows) return;
    lastCols = term.cols;
    lastRows = term.rows;
    options.onResize(term.cols, term.rows);
  }

  async function applyTypography(
    typography: TerminalTypography,
  ): Promise<void> {
    if (disposed) return;
    const revision = ++typographyRevision;
    const newStack = buildFontStack({
      presetName: typography.fontFamily,
      // 复用用户原来的开关(从 prefs 取)
      nerdFontEnabled: prefs.font.nerdFontEnabled,
      cjkEnabled: prefs.font.cjkEnabled,
      emojiEnabled: prefs.font.emojiEnabled,
    });
    await ensureFontStackLoaded(newStack, typography.fontSize);
    if (disposed || revision !== typographyRevision) return;
    term.options.fontFamily = buildCssFontFamily(newStack);
    term.options.fontSize = typography.fontSize;
    term.options.letterSpacing = deriveLetterSpacingPx(
      typography.fontSize,
      typography.letterSpacing,
    );
    try {
      term.clearTextureAtlas();
      if (term.rows > 0) term.refresh(0, term.rows - 1);
    } catch {
      // ignore
    }
    fit();
  }

  function setScrollback(scrollback: number): void {
    if (disposed) return;
    term.options.scrollback = scrollback;
  }

  function setRenderer(kind: RendererKind): void {
    if (disposed || !pipeline) return;
    pipeline.setPreferred(kind);
  }

  function activeRenderer(): RendererKind {
    return pipeline?.active() ?? "dom";
  }

  function redraw(): void {
    if (disposed) return;
    // clearTextureAtlas 先丢弃 WebGL 字符纹理,确保切回可见后字符
    // 用最新 devicePixelRatio 重建(防止 DPI 变化时纹理尺寸不一致)。
    try {
      term.clearTextureAtlas();
    } catch {
      // ignore — DOM 渲染器无 atlas,clear 是 no-op
    }
    if (term.rows > 0) term.refresh(0, term.rows - 1);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    typographyRevision += 1;
    detachThemeWatch();
    detachFontWatch();
    pipeline?.dispose();
    pipeline = null;
    try {
      addons?.dispose();
    } catch {
      // ignore
    }
    addons = null;
    try {
      term.dispose();
    } catch {
      // ignore
    }
  }

  fit();

  return {
    term,
    fit,
    applyTypography,
    setScrollback,
    setRenderer,
    activeRenderer,
    redraw,
    dispose,
  };
}