import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import {
  Terminal,
  type IDisposable,
  type ITerminalOptions,
  type ITheme,
} from "@xterm/xterm";
import {
  buildTerminalFontFamily,
  ensureFontFamilyLoaded,
} from "@/lib/fonts";

export interface TerminalRendererPreferences {
  fontFamily: string;
  fontSize: number;
  letterSpacing: number;
  scrollback: number;
  webglEnabled: boolean;
}

export interface TerminalTypography {
  fontFamily: string;
  fontSize: number;
  letterSpacing: number;
}

export interface TerminalRenderer {
  term: Terminal;
  fit: () => void;
  applyTypography: (typography: TerminalTypography) => Promise<void>;
  setScrollback: (scrollback: number) => void;
  setWebglEnabled: (enabled: boolean) => void;
  dispose: () => void;
}

interface CreateTerminalRendererOptions {
  container: HTMLElement;
  preferences: TerminalRendererPreferences;
  theme: ITheme;
  onResize: (cols: number, rows: number) => void;
}

export function createTerminalOptions(
  preferences: Omit<TerminalRendererPreferences, "webglEnabled">,
  theme?: ITheme,
): ITerminalOptions {
  return {
    cursorBlink: true,
    fontSize: preferences.fontSize,
    fontFamily: buildTerminalFontFamily(preferences.fontFamily),
    letterSpacing: preferences.letterSpacing,
    scrollback: preferences.scrollback,
    allowProposedApi: true,
    convertEol: false,
    customGlyphs: true,
    rescaleOverlappingGlyphs: true,
    theme,
  };
}

export async function createTerminalRenderer(
  options: CreateTerminalRendererOptions,
): Promise<TerminalRenderer> {
  const initialFontFamily = buildTerminalFontFamily(
    options.preferences.fontFamily,
  );
  await ensureFontFamilyLoaded(
    initialFontFamily,
    options.preferences.fontSize,
  );

  const term = new Terminal(
    createTerminalOptions(options.preferences, options.theme),
  );
  const fitAddon = new FitAddon();
  const unicodeAddon = new Unicode11Addon();
  term.loadAddon(fitAddon);
  term.loadAddon(unicodeAddon);
  term.unicode.activeVersion = "11";
  term.loadAddon(new WebLinksAddon());
  term.loadAddon(new SearchAddon());
  term.open(options.container);

  let disposed = false;
  let typographyRevision = 0;
  let renderFrame: number | null = null;
  let webglEnabled = options.preferences.webglEnabled;
  let webglAddon: WebglAddon | null = null;
  let contextLossDisposable: IDisposable | null = null;
  let webglRetryFrame: number | null = null;
  let lastCols = 0;
  let lastRows = 0;

  function fit(): void {
    if (disposed) return;
    try {
      fitAddon.fit();
    } catch {
      return;
    }
    if (term.cols === lastCols && term.rows === lastRows) return;
    lastCols = term.cols;
    lastRows = term.rows;
    options.onResize(term.cols, term.rows);
  }

  function repaint(): void {
    if (disposed) return;
    try {
      webglAddon?.clearTextureAtlas();
      term.clearTextureAtlas();
      if (term.rows > 0) term.refresh(0, term.rows - 1);
    } catch {
      // A renderer can be between context loss and fallback initialization.
    }
  }

  function scheduleRendererRefresh(): void {
    if (renderFrame !== null) cancelAnimationFrame(renderFrame);
    renderFrame = requestAnimationFrame(() => {
      renderFrame = null;
      repaint();
      fit();
    });
  }

  function disposeWebgl(): void {
    contextLossDisposable?.dispose();
    contextLossDisposable = null;
    const addon = webglAddon;
    webglAddon = null;
    if (!addon) return;
    try {
      addon.dispose();
    } catch {
      // The browser may already have released a lost WebGL context.
    }
  }

  function attachWebgl(): void {
    if (disposed || !webglEnabled || webglAddon) return;
    try {
      const addon = new WebglAddon();
      contextLossDisposable = addon.onContextLoss(() => {
        if (webglAddon !== addon) return;
        disposeWebgl();
        if (!disposed && webglEnabled) {
          webglRetryFrame = requestAnimationFrame(() => {
            webglRetryFrame = null;
            attachWebgl();
          });
        }
      });
      term.loadAddon(addon);
      webglAddon = addon;
      scheduleRendererRefresh();
    } catch {
      disposeWebgl();
      // xterm's canvas renderer remains active when WebGL is unavailable.
    }
  }

  function setWebglEnabled(enabled: boolean): void {
    webglEnabled = enabled;
    if (webglRetryFrame !== null) {
      cancelAnimationFrame(webglRetryFrame);
      webglRetryFrame = null;
    }
    if (enabled) attachWebgl();
    else disposeWebgl();
    scheduleRendererRefresh();
  }

  async function applyTypography(
    typography: TerminalTypography,
  ): Promise<void> {
    const revision = ++typographyRevision;
    const fontFamily = buildTerminalFontFamily(typography.fontFamily);
    await ensureFontFamilyLoaded(fontFamily, typography.fontSize);
    if (disposed || revision !== typographyRevision) return;
    term.options.fontFamily = fontFamily;
    term.options.fontSize = typography.fontSize;
    term.options.letterSpacing = typography.letterSpacing;
    scheduleRendererRefresh();
  }

  function setScrollback(scrollback: number): void {
    if (!disposed) term.options.scrollback = scrollback;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    typographyRevision += 1;
    if (renderFrame !== null) cancelAnimationFrame(renderFrame);
    if (webglRetryFrame !== null) cancelAnimationFrame(webglRetryFrame);
    disposeWebgl();
    term.dispose();
  }

  fit();
  attachWebgl();

  return {
    term,
    fit,
    applyTypography,
    setScrollback,
    setWebglEnabled,
    dispose,
  };
}
