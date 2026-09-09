import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { LazyStore } from "@tauri-apps/plugin-store";
import type { CommandId, KeybindingOverrides } from "@/modules/commands/types";
import type { LanguagePref } from "@/modules/i18n/types";
import type { WorkspaceEnv } from "@/modules/workspace/workspaceEnvSnapshot";

export type { LanguagePref } from "@/modules/i18n/types";

export type ThemePref = "system" | "light" | "dark";
export type FileOpenMode = "preview" | "pinned";
export type TouchMode = "auto" | "on" | "off";
export type TabWidthMode = "auto" | "fixed";

// ── accent palette presets ──────────────────────────────────────────────
// 与 theme 三档正交;每个预设都自带 light + dark 两套色,在 globals.css
// 中以 `[data-accent="<id>"]` / `.dark[data-accent="<id>"]` 形式覆盖。
export const ACCENT_PRESETS = [
  "cyan", // 默认 - 现行青蓝
  "violet", // Tokyo Night 紫
  "rose", // Rose Pine 粉
  "emerald", // Catppuccin 绿
  "amber", // Monokai 橙
  "blue", // 经典蓝
] as const;

export type AccentPref = (typeof ACCENT_PRESETS)[number];

export const ACCENT_PRESET_LABELS: Record<AccentPref, string> = {
  cyan: "Cyan",
  violet: "Violet",
  rose: "Rose",
  emerald: "Emerald",
  amber: "Amber",
  blue: "Blue",
};

// 设置页色卡所需的 RGB 预览值。给的是 primary 在 light / dark 两个
// 模式下的代表色,便于用户在切换前同时看到两套搭配效果。
export const ACCENT_PRESET_SWATCHES: Record<
  AccentPref,
  { light: string; dark: string }
> = {
  cyan: { light: "rgb(64, 154, 184)", dark: "rgb(124, 215, 232)" },
  violet: { light: "rgb(108, 99, 198)", dark: "rgb(170, 140, 224)" },
  rose: { light: "rgb(196, 92, 130)", dark: "rgb(232, 142, 178)" },
  emerald: { light: "rgb(54, 152, 104)", dark: "rgb(122, 207, 160)" },
  amber: { light: "rgb(196, 132, 36)", dark: "rgb(232, 178, 92)" },
  blue: { light: "rgb(64, 120, 214)", dark: "rgb(118, 168, 234)" },
};

const ACCENT_PRESET_SET = new Set<string>(ACCENT_PRESETS);

export function normalizeAccentPref(value: unknown): AccentPref {
  return ACCENT_PRESET_SET.has(value as string)
    ? (value as AccentPref)
    : "cyan";
}

const TOUCH_MODES: readonly TouchMode[] = ["auto", "on", "off"];

export function normalizeTouchMode(value: unknown): TouchMode {
  return TOUCH_MODES.includes(value as TouchMode)
    ? (value as TouchMode)
    : "auto";
}

export const EDITOR_THEMES = [
  "atomone",
  "aura",
  "copilot",
  "github-dark",
  "github-light",
  "nord",
  "tokyo-night",
  "xcode-dark",
  "xcode-light",
] as const;

export type EditorThemeId = (typeof EDITOR_THEMES)[number];

export type StoredWorkspace = {
  path: string;
  env: WorkspaceEnv;
  openedAt: number;
};

export const EDITOR_THEME_LABELS: Record<EditorThemeId, string> = {
  atomone: "Atom One",
  aura: "Aura",
  copilot: "Copilot",
  "github-dark": "GitHub Dark",
  "github-light": "GitHub Light",
  nord: "Nord",
  "tokyo-night": "Tokyo Night",
  "xcode-dark": "Xcode Dark",
  "xcode-light": "Xcode Light",
};

export type EditorLspTypescriptMode = "builtin" | "lsp";

export type TerminalCursorStyle = "block" | "underline" | "bar";
export type TerminalCursorInactiveStyle =
  | "outline"
  | "block"
  | "bar"
  | "underline"
  | "none";
export type TerminalFastScrollModifier = "alt" | "ctrl" | "shift";
export type TerminalRenderer = "webgl" | "dom";
export type TerminalFontWeight =
  | 100
  | 200
  | 300
  | 400
  | 500
  | 600
  | 700
  | 800
  | 900;

/** Persisted open-workspace entry (multi-workspace session restore). */
export type PersistedWorkspace = {
  id: string;
  rootPath: string;
  env: WorkspaceEnv;
  name: string;
  openedAt: number;
};

export type Preferences = {
  theme: ThemePref;
  language: LanguagePref;
  accent: AccentPref;
  editorTheme: EditorThemeId;
  autostart: boolean;
  autoCheckUpdates: boolean;
  restoreWindowState: boolean;
  vimMode: boolean;
  fileOpenMode: FileOpenMode;
  showHidden: boolean;
  // 终端 - 字体与回退
  terminalFontFamily: string;
  terminalFontWeight: TerminalFontWeight;
  terminalFontWeightBold: TerminalFontWeight;
  terminalLetterSpacing: number;
  terminalFontSize: number;
  terminalNerdFontEnabled: boolean;
  terminalCjkFontEnabled: boolean;
  terminalEmojiFontEnabled: boolean;
  // 终端 - 光标
  terminalCursorStyle: TerminalCursorStyle;
  terminalCursorBlink: boolean;
  terminalCursorInactiveStyle: TerminalCursorInactiveStyle;
  // 终端 - 渲染
  terminalRenderer: TerminalRenderer;
  terminalRendererAutoFallback: boolean;
  terminalWebglEnabled: boolean;
  // 终端 - 行为
  /** 本地终端 shell profile id（"auto" = 历史默认顺序），仅对新开终端生效。 */
  terminalShellId: string;
  terminalScrollback: number;
  terminalFastScrollSensitivity: number;
  terminalFastScrollModifier: TerminalFastScrollModifier;
  terminalMacOptionIsMeta: boolean;
  terminalMacOptionClickForcesSelection: boolean;
  terminalMinimumContrastRatio: number;
  terminalDrawBoldTextInBrightColors: boolean;
  terminalCustomGlyphs: boolean;
  terminalRescaleOverlappingGlyphs: boolean;
  // 终端 - UX
  terminalContextMenuEnabled: boolean;
  terminalNotificationEnabled: boolean;
  terminalNotificationSoundEnabled: boolean;
  // 其它
  keybindings: KeybindingOverrides;
  lastWorkspace: StoredWorkspace | null;
  recentWorkspaces: StoredWorkspace[];
  /** Multi-workspace: workspaces left open at end of last session. */
  openWorkspaces: PersistedWorkspace[];
  /** Multi-workspace: which workspace id was active last session. */
  activeWorkspaceId: string | null;
  recentFiles: string[];
  sourceControlPanelWidth: number;
  explorerPanelWidth: number;
  touchOptimizations: TouchMode;
  editorFontSize: number;
  editorTabSize: number;
  editorLspTypescriptMode: EditorLspTypescriptMode;
  editorWordWrap: boolean;
  leftSidebar: LeftSidebarPref;
  panelVisibility: PanelVisibilityPref;
  /** v3.1 壳层:全局侧栏折叠为 52px 轨道。 */
  sidebarCollapsed: boolean;
  /** v3.1 壳层:停靠工作区面板的当前标签。 */
  workspacePanelTab: WorkspacePanelTab;
  tabWidthMode: TabWidthMode;
  tabFixedWidth: number;
};

export type WorkspacePanelTab = "explorer" | "changes" | "tasks";

export type LeftSidebarPref = {
  activity: "workspace" | "sourceControl";
  open: boolean;
  width: number;
};

export type PanelVisibilityPref = {
  workspace: boolean;
  sourceControl: boolean;
  explorer: boolean;
  taskConsole: boolean;
};

export const LEFT_SIDEBAR_WIDTH_DEFAULT = 320;
export const LEFT_SIDEBAR_WIDTH_MIN = 240;
export const LEFT_SIDEBAR_WIDTH_MAX = 520;

export const TAB_FIXED_WIDTH_DEFAULT = 160;
export const TAB_FIXED_WIDTH_MIN = 80;
export const TAB_FIXED_WIDTH_MAX = 240;
const TAB_FIXED_WIDTH_STEP = 4;

const TAB_WIDTH_MODE_VALUES: readonly TabWidthMode[] = ["auto", "fixed"];

export function normalizeTabWidthMode(value: unknown): TabWidthMode {
  return TAB_WIDTH_MODE_VALUES.includes(value as TabWidthMode)
    ? (value as TabWidthMode)
    : "auto";
}

/** 暴露给 Pinia store 做乐观更新时的同步 clamp */
export function clampTabFixedWidth(value: number): number {
  if (!Number.isFinite(value)) return TAB_FIXED_WIDTH_DEFAULT;
  const rounded = Math.round(value / TAB_FIXED_WIDTH_STEP) * TAB_FIXED_WIDTH_STEP;
  return Math.min(
    TAB_FIXED_WIDTH_MAX,
    Math.max(TAB_FIXED_WIDTH_MIN, rounded),
  );
}

const ACTIVITY_VALUES: readonly LeftSidebarPref["activity"][] = [
  "workspace",
  "sourceControl",
];

const WORKSPACE_PANEL_TAB_VALUES: readonly WorkspacePanelTab[] = [
  "explorer",
  "changes",
  "tasks",
];

export function normalizeWorkspacePanelTab(value: unknown): WorkspacePanelTab {
  return WORKSPACE_PANEL_TAB_VALUES.includes(value as WorkspacePanelTab)
    ? (value as WorkspacePanelTab)
    : "explorer";
}

export function clampLeftSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return LEFT_SIDEBAR_WIDTH_DEFAULT;
  return Math.min(
    LEFT_SIDEBAR_WIDTH_MAX,
    Math.max(LEFT_SIDEBAR_WIDTH_MIN, Math.round(value)),
  );
}

export function normalizeLeftSidebarPref(value: unknown): LeftSidebarPref {
  if (!value || typeof value !== "object") {
    return {
      activity: "sourceControl",
      open: true,
      width: LEFT_SIDEBAR_WIDTH_DEFAULT,
    };
  }
  const record = value as Record<string, unknown>;
  const activity = ACTIVITY_VALUES.includes(
    record.activity as LeftSidebarPref["activity"],
  )
    ? (record.activity as LeftSidebarPref["activity"])
    : "sourceControl";
  return {
    activity,
    open: typeof record.open === "boolean" ? record.open : true,
    width: clampLeftSidebarWidth(Number(record.width)),
  };
}

export function normalizePanelVisibilityPref(value: unknown): PanelVisibilityPref {
  if (!value || typeof value !== "object") {
    return {
      workspace: true,
      sourceControl: true,
      explorer: true,
      taskConsole: false,
    };
  }
  const record = value as Record<string, unknown>;
  const bool = (key: string, fallback: boolean): boolean =>
    typeof record[key] === "boolean" ? (record[key] as boolean) : fallback;
  return {
    workspace: bool("workspace", true),
    sourceControl: bool("sourceControl", true),
    explorer: bool("explorer", true),
    taskConsole: bool("taskConsole", false),
  };
}

export const SIDE_PANEL_WIDTH_DEFAULT = 320;

export const EDITOR_FONT_SIZE_DEFAULT = 13;
export const EDITOR_FONT_SIZE_MIN = 10;
export const EDITOR_FONT_SIZE_MAX = 24;
export const EDITOR_TAB_SIZE_DEFAULT = 2;
export const SIDE_PANEL_WIDTH_MIN = 240;
export const SIDE_PANEL_WIDTH_MAX = 520;

export const TERMINAL_FONT_SIZE_DEFAULT = 14;
export const TERMINAL_FONT_SIZE_MIN = 8;
export const TERMINAL_FONT_SIZE_MAX = 32;

export const TERMINAL_FONT_SIZES = [
  10, 12, 13, 14, 15, 16, 18, 20, 22, 24,
] as const;

export const TERMINAL_FONT_WEIGHTS = [
  100, 200, 300, 400, 500, 600, 700, 800, 900,
] as const;

export const TERMINAL_CURSOR_VALUES = [
  "block",
  "underline",
  "bar",
] as const;

export const TERMINAL_CURSOR_INACTIVE_VALUES = [
  "outline",
  "block",
  "bar",
  "underline",
  "none",
] as const;

export const TERMINAL_FAST_SCROLL_MODIFIER_VALUES = [
  "alt",
  "ctrl",
  "shift",
] as const;

export const TERMINAL_FONT_FAMILY_PRESETS = [
  "JetBrains Mono",
  "JetBrainsMono Nerd Font",
  "JetBrainsMono Nerd Font Mono",
  "Fira Code",
  "FiraCode Nerd Font",
  "FiraCode Nerd Font Mono",
  "Cascadia Code",
  "Cascadia Mono",
  "CaskaydiaCove Nerd Font",
  "CaskaydiaMono Nerd Font",
  "Consolas",
  "Courier New",
  "Lucida Console",
  "Menlo",
  "Monaco",
  "SF Mono",
  "Source Code Pro",
  "SauceCodePro Nerd Font",
  "Hack",
  "Hack Nerd Font",
  "Hack Nerd Font Mono",
  "Iosevka",
  "Iosevka Term",
  "Iosevka Nerd Font",
  "Iosevka Term Nerd Font",
  "MesloLGS NF",
  "MesloLGM Nerd Font",
  "Ubuntu Mono",
  "DejaVu Sans Mono",
  "Roboto Mono",
  "Noto Sans Mono",
  "Noto Sans Mono CJK SC",
  "IBM Plex Mono",
  "Inconsolata",
  "Cousine",
  "Victor Mono",
  "Monaspace Argon",
  "Monaspace Neon",
  "Monaspace Xenon",
  "CommitMono",
  "Recursive Mono",
  "Maple Mono",
  "Maple Mono NF",
  "Maple Mono NF CN",
  "Sarasa Mono SC",
  "Sarasa Term SC",
] as const;

export const TERMINAL_SCROLLBACK_DEFAULT = 2000;
export const TERMINAL_SCROLLBACK_MIN = 200;
export const TERMINAL_SCROLLBACK_MAX = 50_000;
export const TERMINAL_SCROLLBACK_PRESETS = [
  500, 1000, 2000, 5000, 10_000, 25_000,
] as const;

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "dark",
  language: "system",
  accent: "cyan",
  editorTheme: "atomone",
  autostart: false,
  autoCheckUpdates: true,
  restoreWindowState: true,
  vimMode: false,
  fileOpenMode: "preview",
  showHidden: false,
  // 终端 - 字体与回退
  terminalFontFamily: "",
  terminalFontWeight: 400,
  terminalFontWeightBold: 700,
  terminalLetterSpacing: 0,
  terminalFontSize: TERMINAL_FONT_SIZE_DEFAULT,
  terminalNerdFontEnabled: true,
  terminalCjkFontEnabled: true,
  terminalEmojiFontEnabled: true,
  // 终端 - 光标
  terminalCursorStyle: "block",
  terminalCursorBlink: true,
  terminalCursorInactiveStyle: "outline",
  // 终端 - 渲染
  terminalRenderer: "webgl",
  terminalRendererAutoFallback: true,
  terminalWebglEnabled: true,
  // 终端 - 行为
  terminalShellId: "auto",
  terminalScrollback: TERMINAL_SCROLLBACK_DEFAULT,
  terminalFastScrollSensitivity: 5,
  terminalFastScrollModifier: "alt",
  terminalMacOptionIsMeta: true,
  terminalMacOptionClickForcesSelection: false,
  terminalMinimumContrastRatio: 1,
  terminalDrawBoldTextInBrightColors: true,
  terminalCustomGlyphs: true,
  terminalRescaleOverlappingGlyphs: true,
  // 终端 - UX
  terminalContextMenuEnabled: true,
  terminalNotificationEnabled: true,
  terminalNotificationSoundEnabled: true,
  // 其它
  keybindings: {},
  lastWorkspace: null,
  recentWorkspaces: [],
  openWorkspaces: [],
  activeWorkspaceId: null,
  recentFiles: [],
  sourceControlPanelWidth: SIDE_PANEL_WIDTH_DEFAULT,
  explorerPanelWidth: SIDE_PANEL_WIDTH_DEFAULT,
  touchOptimizations: "off",
  editorFontSize: EDITOR_FONT_SIZE_DEFAULT,
  editorTabSize: EDITOR_TAB_SIZE_DEFAULT,
  editorLspTypescriptMode: "builtin",
  editorWordWrap: false,
  leftSidebar: {
    activity: "sourceControl",
    open: true,
    width: LEFT_SIDEBAR_WIDTH_DEFAULT,
  },
  panelVisibility: {
    workspace: true,
    sourceControl: true,
    explorer: true,
    taskConsole: false,
  },
  sidebarCollapsed: false,
  workspacePanelTab: "explorer",
  tabWidthMode: "auto",
  tabFixedWidth: TAB_FIXED_WIDTH_DEFAULT,
};

const store = new LazyStore("nexterm-settings.json", { defaults: {}, autoSave: 200 });

const PREFS_CHANGED_EVENT = "nexterm://prefs-changed";

async function writePref<T>(key: string, value: T): Promise<void> {
  await store.set(key, value);
  await store.save();
  await emit(PREFS_CHANGED_EVENT, { key, value });
}

// ── 偏好 spec 表：每个偏好只有这一份元数据 ──────────────────────────────
// storageKey 默认与偏好字段同名；read 负责把磁盘上的任意 JSON 规范化成
// 合法值（含默认回落），sanitize 负责写盘/乐观更新前的同步 clamp。
// 新增一个偏好 = Preferences 加字段 + DEFAULT_PREFERENCES 加默认值 +
// 这张表加一行，不再需要同时改 load/set/listen 四处。
type PrefReader<K> = (raw: unknown) => K;

/** 按 PrefKey 逐键约束 read/sanitize 的值类型（上下文类型来自这张表）。 */
type PrefSpecMap = {
  [K in PrefKey]: {
    storageKey: string;
    read: PrefReader<Preferences[K]>;
    sanitize?: (value: Preferences[K]) => Preferences[K];
    /** 旧版存储键（迁移期兼容，主键缺失时回落）。 */
    legacyKey?: string;
  };
};

type AnyPrefSpec = {
  [K in keyof PrefSpecMap]: PrefSpecMap[K];
}[PrefKey];

function spec<V>(
  storageKey: string,
  read: PrefReader<V>,
  sanitize?: (value: V) => V,
  legacyKey?: string,
): { storageKey: string; read: PrefReader<V>; sanitize?: (value: V) => V; legacyKey?: string } {
  return { storageKey, read, sanitize, legacyKey };
}

function withDefault<K>(fallback: K): PrefReader<K> {
  return (raw) => (raw === undefined || raw === null ? fallback : (raw as K));
}

function boolPref(fallback: boolean): PrefReader<boolean> {
  return (raw) => (typeof raw === "boolean" ? raw : fallback);
}

function numberPref(
  fallback: number,
  clamp?: (value: number) => number,
): PrefReader<number> {
  return (raw) => {
    if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
    return clamp ? clamp(raw) : raw;
  };
}

function enumPref<V extends string>(
  values: readonly V[],
  fallback: V,
): PrefReader<V> {
  return (raw) =>
    values.includes(raw as V) ? (raw as V) : fallback;
}

const THEME_VALUES: readonly ThemePref[] = ["system", "light", "dark"];
const FILE_OPEN_MODE_VALUES: readonly FileOpenMode[] = ["preview", "pinned"];
const LANGUAGE_VALUES: readonly LanguagePref[] = ["system", "zh-CN", "en-US"];
const EDITOR_TAB_SIZE_VALUES = [2, 4, 8];

function clampScrollback(value: number): number {
  if (!Number.isFinite(value)) return TERMINAL_SCROLLBACK_DEFAULT;
  return Math.min(
    TERMINAL_SCROLLBACK_MAX,
    Math.max(TERMINAL_SCROLLBACK_MIN, Math.round(value)),
  );
}
export const clampTerminalScrollback = clampScrollback;

export function clampSidePanelWidth(value: number): number {
  if (!Number.isFinite(value)) return SIDE_PANEL_WIDTH_DEFAULT;
  return Math.min(
    SIDE_PANEL_WIDTH_MAX,
    Math.max(SIDE_PANEL_WIDTH_MIN, Math.round(value)),
  );
}

export function clampEditorFontSize(value: number): number {
  if (!Number.isFinite(value)) return EDITOR_FONT_SIZE_DEFAULT;
  return Math.min(EDITOR_FONT_SIZE_MAX, Math.max(EDITOR_FONT_SIZE_MIN, Math.round(value)));
}

function clampEditorTabSize(value: number): number {
  return EDITOR_TAB_SIZE_VALUES.includes(value) ? value : EDITOR_TAB_SIZE_DEFAULT;
}

export function clampTerminalLetterSpacing(value: number): number {
  return Number.isFinite(value)
    ? Math.max(-10, Math.min(10, Math.round(value)))
    : 0;
}

export function clampTerminalFontSize(value: number): number {
  return Number.isFinite(value)
    ? Math.min(
        TERMINAL_FONT_SIZE_MAX,
        Math.max(TERMINAL_FONT_SIZE_MIN, Math.round(value)),
      )
    : TERMINAL_FONT_SIZE_DEFAULT;
}

const TERMINAL_FONT_WEIGHT_VALUES: readonly TerminalFontWeight[] = TERMINAL_FONT_WEIGHTS;

export function clampFontWeightStored(value: number): TerminalFontWeight {
  if (!Number.isFinite(value)) return 400;
  const rounded = Math.round(value / 100) * 100;
  const clamped = Math.max(100, Math.min(900, rounded));
  return (TERMINAL_FONT_WEIGHT_VALUES.includes(clamped as TerminalFontWeight)
    ? (clamped as TerminalFontWeight)
    : 400);
}

export const clampTerminalFontWeight = clampFontWeightStored;

const TERMINAL_CURSOR_STYLE_SET: readonly TerminalCursorStyle[] = TERMINAL_CURSOR_VALUES;
export const clampTerminalCursorStyle = (value: unknown): TerminalCursorStyle =>
  TERMINAL_CURSOR_STYLE_SET.includes(value as TerminalCursorStyle)
    ? (value as TerminalCursorStyle)
    : "block";

const TERMINAL_CURSOR_INACTIVE_SET: readonly TerminalCursorInactiveStyle[] =
  TERMINAL_CURSOR_INACTIVE_VALUES;
export const clampTerminalCursorInactiveStyle = (value: unknown): TerminalCursorInactiveStyle =>
  TERMINAL_CURSOR_INACTIVE_SET.includes(value as TerminalCursorInactiveStyle)
    ? (value as TerminalCursorInactiveStyle)
    : "outline";

const TERMINAL_RENDERER_SET: readonly TerminalRenderer[] = ["webgl", "dom"];
export const clampTerminalRenderer = (value: unknown): TerminalRenderer =>
  TERMINAL_RENDERER_SET.includes(value as TerminalRenderer)
    ? (value as TerminalRenderer)
    : "webgl";

export function clampTerminalFastScrollSensitivity(value: number): number {
  if (!Number.isFinite(value)) return 5;
  return Math.max(1, Math.min(20, Math.round(value)));
}

const TERMINAL_FAST_SCROLL_MODIFIER_SET: readonly TerminalFastScrollModifier[] =
  TERMINAL_FAST_SCROLL_MODIFIER_VALUES;
export const clampTerminalFastScrollModifier = (value: unknown): TerminalFastScrollModifier =>
  TERMINAL_FAST_SCROLL_MODIFIER_SET.includes(value as TerminalFastScrollModifier)
    ? (value as TerminalFastScrollModifier)
    : "alt";

export function clampTerminalMinimumContrastRatio(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(21, value));
}

function normalizeKeybindingOverrides(value: unknown): KeybindingOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: KeybindingOverrides = {};
  for (const [id, keybinding] of Object.entries(value)) {
    if (typeof keybinding === "string" || keybinding === null) {
      result[id as CommandId] = keybinding;
    }
  }
  return result;
}

export const PREF_SPECS: PrefSpecMap = {
  theme: spec("theme", enumPref(THEME_VALUES, DEFAULT_PREFERENCES.theme)),
  language: spec("language", enumPref(LANGUAGE_VALUES, DEFAULT_PREFERENCES.language)),
  accent: spec("accent", normalizeAccentPref, normalizeAccentPref),
  editorTheme: spec("editorTheme", withDefault(DEFAULT_PREFERENCES.editorTheme)),
  autostart: spec("autostart", boolPref(DEFAULT_PREFERENCES.autostart)),
  autoCheckUpdates: spec("autoCheckUpdates", boolPref(DEFAULT_PREFERENCES.autoCheckUpdates)),
  restoreWindowState: spec("restoreWindowState", boolPref(DEFAULT_PREFERENCES.restoreWindowState)),
  vimMode: spec("vimMode", boolPref(DEFAULT_PREFERENCES.vimMode)),
  fileOpenMode: spec("fileOpenMode", enumPref(FILE_OPEN_MODE_VALUES, DEFAULT_PREFERENCES.fileOpenMode)),
  showHidden: spec("showHidden", boolPref(DEFAULT_PREFERENCES.showHidden), undefined, "showHiddenDirectories"),
  // 终端 - 字体与回退
  terminalFontFamily: spec("terminalFontFamily", withDefault(DEFAULT_PREFERENCES.terminalFontFamily), (value) => value.trim()),
  terminalFontWeight: spec("terminalFontWeight", withDefault(DEFAULT_PREFERENCES.terminalFontWeight), clampFontWeightStored),
  terminalFontWeightBold: spec("terminalFontWeightBold", withDefault(DEFAULT_PREFERENCES.terminalFontWeightBold), clampFontWeightStored),
  terminalLetterSpacing: spec("terminalLetterSpacing", numberPref(DEFAULT_PREFERENCES.terminalLetterSpacing), clampTerminalLetterSpacing),
  terminalFontSize: spec("terminalFontSize", numberPref(DEFAULT_PREFERENCES.terminalFontSize), clampTerminalFontSize),
  terminalNerdFontEnabled: spec("terminalNerdFontEnabled", boolPref(DEFAULT_PREFERENCES.terminalNerdFontEnabled)),
  terminalCjkFontEnabled: spec("terminalCjkFontEnabled", boolPref(DEFAULT_PREFERENCES.terminalCjkFontEnabled)),
  terminalEmojiFontEnabled: spec("terminalEmojiFontEnabled", boolPref(DEFAULT_PREFERENCES.terminalEmojiFontEnabled)),
  // 终端 - 光标
  terminalCursorStyle: spec("terminalCursorStyle", clampTerminalCursorStyle, clampTerminalCursorStyle),
  terminalCursorBlink: spec("terminalCursorBlink", boolPref(DEFAULT_PREFERENCES.terminalCursorBlink)),
  terminalCursorInactiveStyle: spec("terminalCursorInactiveStyle", clampTerminalCursorInactiveStyle, clampTerminalCursorInactiveStyle),
  // 终端 - 渲染
  terminalRenderer: spec("terminalRenderer", clampTerminalRenderer, clampTerminalRenderer),
  terminalRendererAutoFallback: spec("terminalRendererAutoFallback", boolPref(DEFAULT_PREFERENCES.terminalRendererAutoFallback)),
  terminalWebglEnabled: spec("terminalWebglEnabled", boolPref(DEFAULT_PREFERENCES.terminalWebglEnabled)),
  // 终端 - 行为
  terminalShellId: spec("terminalShellId", withDefault(DEFAULT_PREFERENCES.terminalShellId), (value) => value.trim() || "auto"),
  terminalScrollback: spec("terminalScrollback", numberPref(DEFAULT_PREFERENCES.terminalScrollback, clampScrollback), clampScrollback),
  terminalFastScrollSensitivity: spec("terminalFastScrollSensitivity", numberPref(DEFAULT_PREFERENCES.terminalFastScrollSensitivity), clampTerminalFastScrollSensitivity),
  terminalFastScrollModifier: spec("terminalFastScrollModifier", clampTerminalFastScrollModifier, clampTerminalFastScrollModifier),
  terminalMacOptionIsMeta: spec("terminalMacOptionIsMeta", boolPref(DEFAULT_PREFERENCES.terminalMacOptionIsMeta)),
  terminalMacOptionClickForcesSelection: spec("terminalMacOptionClickForcesSelection", boolPref(DEFAULT_PREFERENCES.terminalMacOptionClickForcesSelection)),
  terminalMinimumContrastRatio: spec("terminalMinimumContrastRatio", numberPref(DEFAULT_PREFERENCES.terminalMinimumContrastRatio), clampTerminalMinimumContrastRatio),
  terminalDrawBoldTextInBrightColors: spec("terminalDrawBoldTextInBrightColors", boolPref(DEFAULT_PREFERENCES.terminalDrawBoldTextInBrightColors)),
  terminalCustomGlyphs: spec("terminalCustomGlyphs", boolPref(DEFAULT_PREFERENCES.terminalCustomGlyphs)),
  terminalRescaleOverlappingGlyphs: spec("terminalRescaleOverlappingGlyphs", boolPref(DEFAULT_PREFERENCES.terminalRescaleOverlappingGlyphs)),
  // 终端 - UX
  terminalContextMenuEnabled: spec("terminalContextMenuEnabled", boolPref(DEFAULT_PREFERENCES.terminalContextMenuEnabled)),
  terminalNotificationEnabled: spec("terminalNotificationEnabled", boolPref(DEFAULT_PREFERENCES.terminalNotificationEnabled)),
  terminalNotificationSoundEnabled: spec("terminalNotificationSoundEnabled", boolPref(DEFAULT_PREFERENCES.terminalNotificationSoundEnabled)),
  // 其它
  keybindings: spec("keybindings", normalizeKeybindingOverrides),
  lastWorkspace: spec("lastWorkspace", withDefault(DEFAULT_PREFERENCES.lastWorkspace)),
  recentWorkspaces: spec("recentWorkspaces", withDefault(DEFAULT_PREFERENCES.recentWorkspaces)),
  openWorkspaces: spec("openWorkspaces", withDefault(DEFAULT_PREFERENCES.openWorkspaces)),
  activeWorkspaceId: spec("activeWorkspaceId", withDefault(DEFAULT_PREFERENCES.activeWorkspaceId)),
  recentFiles: spec("recentFiles", withDefault(DEFAULT_PREFERENCES.recentFiles)),
  sourceControlPanelWidth: spec("sourceControlPanelWidth", numberPref(DEFAULT_PREFERENCES.sourceControlPanelWidth), clampSidePanelWidth),
  explorerPanelWidth: spec("explorerPanelWidth", numberPref(DEFAULT_PREFERENCES.explorerPanelWidth), clampSidePanelWidth),
  touchOptimizations: spec(
    "touchOptimizations",
    (raw) =>
      raw === undefined || raw === null
        ? DEFAULT_PREFERENCES.touchOptimizations
        : normalizeTouchMode(raw),
    normalizeTouchMode,
  ),
  editorFontSize: spec("editorFontSize", numberPref(DEFAULT_PREFERENCES.editorFontSize), clampEditorFontSize),
  editorTabSize: spec("editorTabSize", numberPref(DEFAULT_PREFERENCES.editorTabSize), clampEditorTabSize),
  editorLspTypescriptMode: spec("editorLspTypescriptMode", enumPref(["builtin", "lsp"] as const, DEFAULT_PREFERENCES.editorLspTypescriptMode)),
  editorWordWrap: spec("editorWordWrap", boolPref(DEFAULT_PREFERENCES.editorWordWrap)),
  leftSidebar: spec("layout.leftSidebar", normalizeLeftSidebarPref, normalizeLeftSidebarPref),
  panelVisibility: spec("layout.panels", normalizePanelVisibilityPref, normalizePanelVisibilityPref),
  sidebarCollapsed: spec("sidebarCollapsed", boolPref(DEFAULT_PREFERENCES.sidebarCollapsed)),
  workspacePanelTab: spec("workspacePanelTab", normalizeWorkspacePanelTab, normalizeWorkspacePanelTab),
  tabWidthMode: spec("tabWidthMode", normalizeTabWidthMode, normalizeTabWidthMode),
  tabFixedWidth: spec("tabFixedWidth", numberPref(DEFAULT_PREFERENCES.tabFixedWidth), clampTabFixedWidth),
};

export type PrefKey = keyof Preferences;

export async function loadPreferences(): Promise<Preferences> {
  const entries = await store.entries();
  const map = new Map<string, unknown>(entries);
  const result = {} as Preferences;
  const sink = result as unknown as Record<PrefKey, unknown>;
  for (const key of Object.keys(PREF_SPECS) as PrefKey[]) {
    const specEntry: AnyPrefSpec = PREF_SPECS[key];
    const raw = map.get(specEntry.storageKey) ??
      (specEntry.legacyKey !== undefined ? map.get(specEntry.legacyKey) : undefined);
    sink[key] = specEntry.read(raw);
  }
  return result;
}

/** 写盘前的统一入口：按 spec sanitize 后写存储键。 */
export async function setPreference<K extends PrefKey>(
  key: K,
  value: Preferences[K],
): Promise<void> {
  const specEntry = PREF_SPECS[key] as unknown as {
    storageKey: string;
    sanitize?: (value: unknown) => unknown;
  };
  const sanitized = specEntry.sanitize ? specEntry.sanitize(value) : value;
  await writePref(specEntry.storageKey, sanitized);
}

// ── 工作区偏好setter：供 workspacesPinia / workspaceRootPinia 直接使用 ──

export async function setOpenWorkspaces(
  value: PersistedWorkspace[],
): Promise<void> {
  await setPreference("openWorkspaces", value);
}

export async function setActiveWorkspaceId(
  value: string | null,
): Promise<void> {
  await setPreference("activeWorkspaceId", value);
}

export async function setLastWorkspace(
  value: StoredWorkspace | null,
): Promise<void> {
  await setPreference("lastWorkspace", value);
}

export async function setRecentWorkspaces(
  value: StoredWorkspace[],
): Promise<void> {
  await setPreference("recentWorkspaces", value);
}

export async function onPreferencesChange(
  cb: (key: PrefKey, value: unknown) => void,
): Promise<UnlistenFn> {
  const map: Record<string, PrefKey> = {};
  for (const key of Object.keys(PREF_SPECS) as PrefKey[]) {
    map[PREF_SPECS[key].storageKey] = key;
  }
  const unsubLocal = await store.onChange<unknown>((key, value) => {
    const mapped = map[key];
    if (mapped) cb(mapped, value);
  });
  const unsubEvent = await listen<{ key: string; value: unknown }>(
    PREFS_CHANGED_EVENT,
    (e) => {
      const mapped = map[e.payload.key];
      if (mapped) cb(mapped, e.payload.value);
    },
  );
  return () => {
    unsubLocal();
    unsubEvent();
  };
}
