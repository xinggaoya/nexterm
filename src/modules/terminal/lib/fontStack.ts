/**
 * 分层字体回退栈(primary → symbol → cjk → emoji → 系统兜底)。
 *
 * 设计目标(对齐 Ghostty / Rio / WezTerm / VSCode):
 * - 主等宽字体处理 ASCII + 拉丁扩展 + 西里尔,优先用户预设,否则平台默认
 * - 符号字体处理 Nerd Font / Powerline / Pomicons / Weather Icons,
 *   主字体已是 Nerd Font variant 时跳过,避免重复渲染
 * - CJK 字体处理中日韩字符,默认推荐系统字体,用户可在设置里改
 * - Emoji 字体保证彩色符号可读,默认按平台选择(Apple/Segoe/Noto)
 * - 末端兜底:ui-monospace → SFMono-Regular → Menlo → monospace
 *
 * 这一个文件统一所有字体策略,renderer.ts 只调用 buildCssFontFamily()。
 */

const NERD_FONT_KEYWORDS = [
  "Nerd Font",
  "Nerd",
  "Symbols Nerd",
];

const SYMBOL_PROBE = "\ue0b0\ue0b1\uf120"; // Powerline + Nerd nf-md-keyboard
const CJK_PROBE = "\u4e2d\u6587\u65e5\u672c\u4eba"; // 中文 + 日文 + 韩文(常见 CJK)
const EMOJI_PROBE = "\ud83d\ude00\ud83d\ude80"; // 😀🚀

export interface FontStack {
  /** 主等宽字体(可含 Nerd Font variant,例如 "JetBrainsMono Nerd Font") */
  primary: string;
  /** 符号字体,纯符号(Pure Nerd Font 等),primary 已含 Nerd Font 时为 "" */
  symbol: string;
  /** CJK 字体,系统优先,默认走平台原生 */
  cjk: string;
  /** Emoji 字体,按平台选择 */
  emoji: string;
  /**
   * 平台兜底:CSS font-family 列表。
   * - Mac: "Menlo", "SF Mono", ui-monospace
   * - Win: "Cascadia Mono", "Consolas", ui-monospace
   * - Linux: "DejaVu Sans Mono", "Liberation Mono", "Ubuntu Mono", ui-monospace
   * - Other: ui-monospace, SFMono-Regular, Menlo, monospace
   */
  fallback: string;
}

export interface FontPreference {
  /** 用户下拉选择,空串 = 自动检测 */
  presetName: string;
  /** 启用 Nerd Font 符号兜底(默认 true) */
  nerdFontEnabled: boolean;
  /** 启用 CJK 字符(默认 true) */
  cjkEnabled: boolean;
  /** 启用 Emoji 字体(默认 true) */
  emojiEnabled: boolean;
}

const BUNDLED_NERD = '"Pure Nerd Font"';
const BUNDLED_MONO = '"JetBrains Mono"';

/**
 * 平台原生字体回退(CSS font-family 列表,按优先级)。
 * 不在编译时硬编码 OS 字体的具体名称,而是依赖浏览器/CSS 关键字。
 */
const PLATFORM_FALLBACK: Record<"mac" | "win" | "linux" | "other", string> = {
  mac: '"Menlo", "SF Mono", ui-monospace',
  win: '"Cascadia Mono", "Consolas", ui-monospace',
  linux: '"DejaVu Sans Mono", "Liberation Mono", "Ubuntu Mono", ui-monospace',
  other: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

function detectPlatform(): keyof typeof PLATFORM_FALLBACK {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/Mac|iPhone|iPad/i.test(ua)) return "mac";
  if (/Windows/i.test(ua)) return "win";
  if (/Linux|X11/i.test(ua)) return "linux";
  return "other";
}

function quoteFontFamily(name: string): string {
  const escaped = name
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function isNerdFontVariant(name: string): boolean {
  return NERD_FONT_KEYWORDS.some((kw) => name.includes(kw));
}

/**
 * 用 document.fonts.load 主动预加载一个候选字体族,然后 check 验证。
 * `check` 单独使用在 chromium/firefox/webkit 上只会对"已加载过"的字体返回 true,
 * 即便系统已安装。所以必须先 load 一次(silent)才能可靠地探测。
 */
async function loadAndCheck(candidate: string): Promise<boolean> {
  if (typeof document === "undefined" || !document.fonts?.load || !document.fonts.check) {
    return false;
  }
  try {
    await document.fonts.load(`12px "${candidate}"`);
  } catch {
    return false;
  }
  try {
    return document.fonts.check(`12px "${candidate}"`);
  } catch {
    return false;
  }
}

/**
 * 探测系统中实际可用的等宽字体。
 * 用于自动检测模式(presetName 为空)。
 *
 * 多次调用在一次会话内只探测一次,后续返回缓存。
 */
let cachedMonoFont: string | null = null;
let monoFontProbe: Promise<string> | null = null;
export function detectInstalledMonoFont(): string {
  return cachedMonoFont ?? BUNDLED_MONO;
}
export function detectInstalledMonoFontAsync(): Promise<string> {
  if (cachedMonoFont) return Promise.resolve(cachedMonoFont);
  if (monoFontProbe) return monoFontProbe;
  monoFontProbe = (async () => {
    if (typeof document === "undefined" || !document.fonts?.load) {
      cachedMonoFont = BUNDLED_MONO;
      return cachedMonoFont;
    }
    const candidates = [
      "JetBrains Mono",
      "Cascadia Mono",
      "Cascadia Code",
      "Fira Code",
      "Menlo",
      "SF Mono",
      "Consolas",
      "DejaVu Sans Mono",
      "Source Code Pro",
      "Liberation Mono",
    ];
    for (const c of candidates) {
      if (await loadAndCheck(c)) {
        cachedMonoFont = c;
        return cachedMonoFont;
      }
    }
    cachedMonoFont = BUNDLED_MONO;
    return cachedMonoFont;
  })();
  return monoFontProbe;
}

/**
 * 探测系统中已安装的 Nerd Font 字体。
 * 返回引号包裹的 font-family CSS 字符串,空串表示未安装。
 */
let cachedNerdFont: string | null = null;
let nerdFontProbe: Promise<string> | null = null;
export function detectInstalledNerdFont(): string {
  return cachedNerdFont ?? "";
}
export function detectInstalledNerdFontAsync(): Promise<string> {
  if (cachedNerdFont !== null) return Promise.resolve(cachedNerdFont);
  if (nerdFontProbe) return nerdFontProbe;
  nerdFontProbe = (async () => {
    if (typeof document === "undefined" || !document.fonts?.load) return "";
    const candidates = [
      "JetBrainsMono Nerd Font",
      "JetBrainsMono Nerd Font Mono",
      "FiraCode Nerd Font",
      "FiraCode Nerd Font Mono",
      "CaskaydiaCove Nerd Font",
      "CaskaydiaMono Nerd Font",
      "Hack Nerd Font",
      "Hack Nerd Font Mono",
      "Iosevka Nerd Font",
      "Iosevka Term Nerd Font",
      "MesloLGS NF",
      "MesloLGM Nerd Font",
      "SauceCodePro Nerd Font",
      "Hasklug Nerd Font",
    ];
    for (const c of candidates) {
      if (await loadAndCheck(c)) {
        cachedNerdFont = quoteFontFamily(c);
        return cachedNerdFont;
      }
    }
    cachedNerdFont = "";
    return cachedNerdFont;
  })();
  return nerdFontProbe;
}

/**
 * 探测系统 CJK 字体(返回 CSS 串,失败返回空)。
 * 用户在设置面板里可手动覆盖。
 */
let cachedCjkFont: string | null = null;
let cjkFontProbe: Promise<string> | null = null;
export function detectInstalledCjkFont(): string {
  return cachedCjkFont ?? "";
}
export function detectInstalledCjkFontAsync(): Promise<string> {
  if (cachedCjkFont !== null) return Promise.resolve(cachedCjkFont);
  if (cjkFontProbe) return cjkFontProbe;
  cjkFontProbe = (async () => {
    if (typeof document === "undefined" || !document.fonts?.load) return "";
    const platform = detectPlatform();
    const candidates =
      platform === "mac"
        ? ["PingFang SC", "Hiragino Sans GB", "STHeiti", "Microsoft YaHei"]
        : platform === "win"
          ? ["Microsoft YaHei", "SimHei", "Microsoft JhengHei"]
          : platform === "linux"
            ? ["Noto Sans Mono CJK SC", "Noto Sans CJK SC", "WenQuanYi Micro Hei"]
            : ["Noto Sans Mono CJK SC", "Microsoft YaHei"];
    for (const c of candidates) {
      if (await loadAndCheck(c)) {
        cachedCjkFont = quoteFontFamily(c);
        return cachedCjkFont;
      }
    }
    cachedCjkFont = "";
    return cachedCjkFont;
  })();
  return cjkFontProbe;
}

/**
 * 探测系统 Emoji 字体(返回 CSS 串)。
 */
let cachedEmojiFont: string | null = null;
let emojiFontProbe: Promise<string> | null = null;
export function detectInstalledEmojiFont(): string {
  return cachedEmojiFont ?? "";
}
export function detectInstalledEmojiFontAsync(): Promise<string> {
  if (cachedEmojiFont !== null) return Promise.resolve(cachedEmojiFont);
  if (emojiFontProbe) return emojiFontProbe;
  emojiFontProbe = (async () => {
    if (typeof document === "undefined" || !document.fonts?.load) return "";
    const platform = detectPlatform();
    const candidates =
      platform === "mac"
        ? ["Apple Color Emoji"]
        : platform === "win"
          ? ["Segoe UI Emoji", "Segoe UI Symbol"]
          : platform === "linux"
            ? ["Noto Color Emoji", "Twemoji Mozilla"]
            : ["Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji"];
    for (const c of candidates) {
      if (await loadAndCheck(c)) {
        cachedEmojiFont = quoteFontFamily(c);
        return cachedEmojiFont;
      }
    }
    cachedEmojiFont = "";
    return cachedEmojiFont;
  })();
  return emojiFontProbe;
}

/**
 * 从用户预设名称得到 primary 字体 CSS 串。
 * 已处理引号、空字符串、空白等边界。
 */
function resolvePrimary(presetName: string): string {
  const trimmed = presetName.trim();
  if (!trimmed) return quoteFontFamily(detectInstalledMonoFont());
  return quoteFontFamily(trimmed);
}

/**
 * 同步版的 buildFontStack:对尚未完成探测的字体返回 "" / BUNDLED_* 兜底。
 * 用于 UI 初次渲染时不阻塞;真正创建 terminal 时请用 resolveFontStackAsync。
 */
export function buildFontStack(pref: FontPreference): FontStack {
  const primary = resolvePrimary(pref.presetName);
  const platform = detectPlatform();
  const fallback = PLATFORM_FALLBACK[platform];

  const presetName = pref.presetName.trim();
  const primaryIsNerd = isNerdFontVariant(presetName);
  let symbol = "";
  if (pref.nerdFontEnabled && !primaryIsNerd) {
    const installed = detectInstalledNerdFont();
    symbol = installed || BUNDLED_NERD;
  }

  let cjk = "";
  if (pref.cjkEnabled) {
    cjk = detectInstalledCjkFont();
  }

  let emoji = "";
  if (pref.emojiEnabled) {
    emoji = detectInstalledEmojiFont();
  }

  return {
    primary,
    symbol,
    cjk,
    emoji,
    fallback,
  };
}

/**
 * 异步版的 buildFontStack:主动 load+check 每个候选字体,等探测完成再返回。
 * 第一次调用耗时几十~几百毫秒(取决于已装字体),后续命中缓存立即返回。
 */
export async function resolveFontStackAsync(
  pref: FontPreference,
): Promise<FontStack> {
  // 触发探测(各自内部有缓存);Promise.all 让 4 个探测并行。
  const [mono, nerd, cjk, emoji] = await Promise.all([
    pref.presetName.trim() === ""
      ? detectInstalledMonoFontAsync()
      : Promise.resolve(pref.presetName.trim()),
    pref.nerdFontEnabled
      ? detectInstalledNerdFontAsync()
      : Promise.resolve(""),
    pref.cjkEnabled ? detectInstalledCjkFontAsync() : Promise.resolve(""),
    pref.emojiEnabled ? detectInstalledEmojiFontAsync() : Promise.resolve(""),
  ]);

  const platform = detectPlatform();
  const fallback = PLATFORM_FALLBACK[platform];

  const presetName = pref.presetName.trim();
  const primaryIsNerd = isNerdFontVariant(presetName);

  const primary = presetName
    ? quoteFontFamily(presetName)
    : quoteFontFamily(mono);

  let symbol = "";
  if (pref.nerdFontEnabled && !primaryIsNerd) {
    symbol = nerd || BUNDLED_NERD;
  }

  return {
    primary,
    symbol,
    cjk: pref.cjkEnabled ? cjk : "",
    emoji: pref.emojiEnabled ? emoji : "",
    fallback,
  };
}

/**
 * 把 FontStack 拼接成 xterm.js fontFamily 接受的 CSS 字符串。
 * 顺序很关键:primary(字母+符号)→ symbol(Nerd)→ cjk → emoji → fallback。
 */
export function buildCssFontFamily(stack: FontStack): string {
  const parts: string[] = [];
  if (stack.primary) parts.push(stack.primary);
  if (stack.symbol) parts.push(stack.symbol);
  if (stack.cjk) parts.push(stack.cjk);
  if (stack.emoji) parts.push(stack.emoji);
  if (stack.fallback) parts.push(stack.fallback);
  return parts.join(", ");
}

/**
 * 等价于 buildCssFontFamily(buildFontStack(pref)),仅做拼接性能优化。
 */
export function buildFontFamilyCss(pref: FontPreference): string {
  return buildCssFontFamily(buildFontStack(pref));
}

/**
 * 预加载字体栈中的每个层级。
 * 主字体加载 ASCII + 拉丁 + 西里尔常用字符,符号字体加载 Nerd/Powerline 字符,
 * CJK 加载汉字,Emoji 加载基本 emoji。
 *
 * 失败用 Promise.allSettled 兜底,任一字体加载失败不影响其他。
 */
export async function ensureFontStackLoaded(
  stack: FontStack,
  fontSize: number,
): Promise<void> {
  if (typeof document === "undefined" || !document.fonts?.load) return;
  const size = fontSize;
  const promises: Promise<unknown>[] = [];
  if (stack.primary) {
    promises.push(
      document.fonts.load(`400 ${size}px ${stack.primary}`, "MW\u2500\u2502"),
    );
    promises.push(
      document.fonts.load(`700 ${size}px ${stack.primary}`, "MW\u2500\u2502"),
    );
  }
  if (stack.symbol) {
    promises.push(
      document.fonts.load(`400 ${size}px ${stack.symbol}`, SYMBOL_PROBE),
    );
  }
  if (stack.cjk) {
    promises.push(
      document.fonts.load(`400 ${size}px ${stack.cjk}`, CJK_PROBE),
    );
  }
  if (stack.emoji) {
    promises.push(
      document.fonts.load(`400 ${size}px ${stack.emoji}`, EMOJI_PROBE),
    );
  }
  await Promise.allSettled(promises);
}

/**
 * 当字体栈中的某个字体加载完成后,主动通知 xterm 重画。
 * 监听 document.fonts.loadingdone 事件,过滤到关心的字体族,避免
 * UI / 编辑器 / monaco 的字体加载触发不必要的终端重画。
 *
 * 返回 disconnect 函数。
 */
export function watchFontLoadingDone(
  cb: () => void,
  watchedFonts: readonly string[] = [],
): () => void {
  if (typeof document === "undefined" || !document.fonts?.addEventListener) {
    return () => {};
  }
  // 规范化(去引号 + 去空白 + 小写),便于跨浏览器匹配
  const wanted = new Set(
    watchedFonts.map((f) =>
      f.replace(/^["']|["']$/g, "").trim().toLowerCase(),
    ),
  );
  const handler = (ev: Event) => {
    // ev 是 FontFaceSetLoadEvent,有 fontface 属性描述本次完成加载的字体。
    // 兼容老 API: 没有 fontface 时只粗粒度地触发。
    const ff = (ev as { fontface?: FontFace }).fontface;
    if (!ff) {
      cb();
      return;
    }
    const family = ff.family.replace(/^["']|["']$/g, "").trim().toLowerCase();
    if (wanted.size === 0 || wanted.has(family)) {
      cb();
    }
  };
  document.fonts.addEventListener("loadingdone", handler);
  return () => document.fonts.removeEventListener("loadingdone", handler);
}

export const __TESTING__ = {
  isNerdFontVariant,
  resolvePrimary,
  quoteFontFamily,
};
