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
import type { SearchAddon } from "@xterm/addon-search";
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
  /** SearchAddon 句柄：终端内 Ctrl+F 用的就是它（此前已装载但零引用）。 */
  search: SearchAddon;
  /**
   * 安装粘贴拦截器。
   *
   * 拦在 `term.paste` 这一层而不是具体快捷键上：xterm 自己的 paste 事件监听
   * （普通 Ctrl+V / 中键主选区）也走这个方法，只拦右键菜单等于没做——用户从
   * 正常路径粘一样会“一贴就提交”。拦截器返回新文本则粘贴，返回 null 则丢弃
   * （用户取消）。
   */
  setPasteInterceptor: (
    fn: ((text: string) => Promise<string | null>) | null,
  ) => void;
  /** 立即 fit,如字号/容器变化后调用 */
  fit: () => void;
  /** 应用字号/字体/间距变化,内部重新加载字体并重画 */
  applyTypography: (typography: TerminalTypography) => Promise<void>;
  /** 调整 scrollback */
  setScrollback: (scrollback: number) => void;
  /**
   * 跳到底部。用于上翻后“↓ N 行”的悬浮回底按钮。
   */
  scrollToBottom: () => void;
  /**
   * 视口距底部的行数。0 = 已在底部。
   *
   * 替代 `buffer.baseY - buffer.viewportY` 的手写计算：备用屏（alt screen，
   * TUI AI 工具全都在用）下 baseY 语义不同，直接相减会算出乱七八糟的负数。
   */
  linesFromBottom: () => number;
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

  // 3.5) 包一层 paste：所有粘贴入口（快捷键 / 右键菜单 / xterm 自己的
  // paste 事件 / 中键主选区）最终都走 term.paste，在这里做多行守卫。
  let pasteInterceptor: ((text: string) => Promise<string | null>) | null = null;
  const rawPaste = term.paste.bind(term);
  const patchedTerm = term as Terminal & {
    paste: (data: string) => void | Promise<void>;
  };
  patchedTerm.paste = (data: string) => {
    if (!pasteInterceptor) {
      rawPaste(data);
      return;
    }
    // 拦截器可能是异步的（弹确认框）。xterm 内部的 paste 事件处理器不关心
    // 返回值，所以异步延迟落盘对它透明。
    void Promise.resolve(pasteInterceptor(data)).then((next) => {
      if (next) rawPaste(next);
    });
  };

  function setPasteInterceptor(
    fn: ((text: string) => Promise<string | null>) | null,
  ): void {
    pasteInterceptor = fn;
  }

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
    // 容器不可见时绝不能调 FitAddon.fit()：工作区切换用 v-show(display:none)
    // 实现，隐藏期间 FitAddon 读到 getComputedStyle().height='auto'(parseInt→NaN→0)，
    // 会算出 cols=2(其 MINIMUM_COLS) 并 term.resize(2,1)。xterm 的 resize 会触发
    // buffer reflow——把每行文字按 2 列重排折行，提示符「➜  repo git:(master)」被
    // 不可逆地切碎。切回后即便 resize 回原尺寸，reflow 损坏的 buffer 也无法恢复
    // (redraw 画不出已丢失的数据)。必须在 FitAddon 执行前就拦住。
    const el = term.element;
    if (el) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
    }
    try {
      addons.fit.fit();
    } catch {
      return;
    }
    // 拒绝把极端/无意义尺寸推给 PTY：容器尚未完成布局（如刚从隐藏切回）时
    // FitAddon 可能算出 cols=2（其 MINIMUM_COLS），把这种 2x1 resize 透传到
    // shell 会触发 SIGWINCH 风暴，WSL 下 zsh 插件（syntax-highlighting /
    // autosuggestions）在极小列宽下重算会崩溃（double free / free(): invalid size）。
    if (term.cols < 4 || term.rows < 1) return;
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

  function scrollToBottom(): void {
    if (disposed) return;
    term.scrollToBottom();
  }

  /**
   * 视口距底部多少行。
   *
   * 备用屏（DECSET 1049，claude code / opencode 这类 TUI 工具一进交互就切过去）
   * 下 `baseY` 恒为 0，直接 `baseY - viewportY` 会返回负数 —— 必须先确认
   * viewportY 确实落在 [0, baseY] 区间内，否则一律按 0（已在底部）算。
   */
  function linesFromBottom(): number {
    if (disposed) return 0;
    const buffer = term.buffer.active;
    const viewportY = buffer.viewportY;
    const baseY = buffer.baseY;
    if (baseY <= 0 || viewportY >= baseY || viewportY < 0) return 0;
    return baseY - viewportY;
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
    search: addons?.search ?? null,
    setPasteInterceptor,
    fit,
    applyTypography,
    setScrollback,
    setRenderer,
    activeRenderer,
    redraw,
    scrollToBottom,
    linesFromBottom,
    dispose,
  };
}