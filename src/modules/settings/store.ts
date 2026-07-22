import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { LazyStore } from "@tauri-apps/plugin-store";
import type { CommandId, KeybindingOverrides } from "@/modules/commands/types";
import type { LanguagePref } from "@/modules/i18n/types";
import type { WorkspaceEnv } from "@/modules/workspace/workspaceEnvSnapshot";

export type { LanguagePref } from "@/modules/i18n/types";

export type ThemePref = "system" | "light" | "dark";
export type FileOpenMode = "preview" | "pinned";
export type TouchMode = "auto" | "on" | "off";

const TOUCH_MODES: readonly TouchMode[] = ["auto", "on", "off"];

function normalizeTouchMode(value: unknown): TouchMode {
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
  editorTheme: EditorThemeId;
  autostart: boolean;
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
  terminalScrollback: number;
  terminalFastScrollSensitivity: number;
  terminalFastScrollModifier: TerminalFastScrollModifier;
  terminalMacOptionIsMeta: boolean;
  terminalMacOptionClickForcesSelection: boolean;
  terminalMinimumContrastRatio: number;
  terminalDrawBoldTextInBrightColors: boolean;
  terminalCustomGlyphs: boolean;
  terminalRescaleOverlappingGlyphs: boolean;
  // 终端 - OSC / UX
  terminalContextMenuEnabled: boolean;
  terminalOscHyperlink: boolean;
  terminalNotificationEnabled: boolean;
  terminalNotificationSoundEnabled: boolean;
  // 其它
  keybindings: KeybindingOverrides;
  lastWslDistro: string | null;
  lastWorkspace: StoredWorkspace | null;
  recentWorkspaces: StoredWorkspace[];
  /** Multi-workspace: workspaces left open at end of last session. */
  openWorkspaces: PersistedWorkspace[];
  /** Multi-workspace: which workspace id was active last session. */
  activeWorkspaceId: string | null;
  recentFiles: string[];
  zoomLevel: number;
  sourceControlPanelWidth: number;
  explorerPanelWidth: number;
  touchOptimizations: TouchMode;
  editorFontSize: number;
  editorTabSize: number;
  editorLspTypescriptMode: EditorLspTypescriptMode;
  editorWordWrap: boolean;
  leftSidebar: LeftSidebarPref;
  panelVisibility: PanelVisibilityPref;
};

const STORE_PATH = "nexterm-settings.json";
const KEY_THEME = "theme";
const KEY_LANGUAGE = "language";
const KEY_EDITOR_THEME = "editorTheme";
const KEY_AUTOSTART = "autostart";
const KEY_RESTORE_WINDOW = "restoreWindowState";
const KEY_VIM_MODE = "vimMode";
const KEY_FILE_OPEN_MODE = "fileOpenMode";
const KEY_SHOW_HIDDEN = "showHidden";
const LEGACY_KEY_SHOW_HIDDEN_DIRS = "showHiddenDirectories";
const KEY_TERMINAL_WEBGL_ENABLED = "terminalWebglEnabled";
const KEY_TERMINAL_CONTEXT_MENU_ENABLED = "terminalContextMenuEnabled";
const KEY_TERMINAL_FONT_FAMILY = "terminalFontFamily";
const KEY_TERMINAL_FONT_WEIGHT = "terminalFontWeight";
const KEY_TERMINAL_FONT_WEIGHT_BOLD = "terminalFontWeightBold";
const KEY_TERMINAL_LETTER_SPACING = "terminalLetterSpacing";
const KEY_TERMINAL_FONT_SIZE = "terminalFontSize";
const KEY_TERMINAL_NERD_FONT_ENABLED = "terminalNerdFontEnabled";
const KEY_TERMINAL_CJK_FONT_ENABLED = "terminalCjkFontEnabled";
const KEY_TERMINAL_EMOJI_FONT_ENABLED = "terminalEmojiFontEnabled";
const KEY_TERMINAL_CURSOR_STYLE = "terminalCursorStyle";
const KEY_TERMINAL_CURSOR_BLINK = "terminalCursorBlink";
const KEY_TERMINAL_CURSOR_INACTIVE_STYLE = "terminalCursorInactiveStyle";
const KEY_TERMINAL_RENDERER = "terminalRenderer";
const KEY_TERMINAL_RENDERER_AUTO_FALLBACK = "terminalRendererAutoFallback";
const KEY_TERMINAL_SCROLLBACK = "terminalScrollback";
const KEY_TERMINAL_FAST_SCROLL_SENSITIVITY = "terminalFastScrollSensitivity";
const KEY_TERMINAL_FAST_SCROLL_MODIFIER = "terminalFastScrollModifier";
const KEY_TERMINAL_MAC_OPTION_IS_META = "terminalMacOptionIsMeta";
const KEY_TERMINAL_MAC_OPTION_CLICK_FORCES_SELECTION =
  "terminalMacOptionClickForcesSelection";
const KEY_TERMINAL_MINIMUM_CONTRAST_RATIO = "terminalMinimumContrastRatio";
const KEY_TERMINAL_DRAW_BOLD_TEXT_IN_BRIGHT_COLORS =
  "terminalDrawBoldTextInBrightColors";
const KEY_TERMINAL_CUSTOM_GLYPHS = "terminalCustomGlyphs";
const KEY_TERMINAL_RESCALE_OVERLAPPING_GLYPHS =
  "terminalRescaleOverlappingGlyphs";
const KEY_TERMINAL_OSC_HYPERLINK = "terminalOscHyperlink";
const KEY_TERMINAL_NOTIFICATION_ENABLED = "terminalNotificationEnabled";
const KEY_TERMINAL_NOTIFICATION_SOUND_ENABLED = "terminalNotificationSoundEnabled";
const KEY_KEYBINDINGS = "keybindings";
const KEY_LAST_WSL_DISTRO = "lastWslDistro";
const KEY_LAST_WORKSPACE = "lastWorkspace";
const KEY_RECENT_WORKSPACES = "recentWorkspaces";
const KEY_OPEN_WORKSPACES = "openWorkspaces";
const KEY_ACTIVE_WORKSPACE_ID = "activeWorkspaceId";
const KEY_RECENT_FILES = "recentFiles";
const KEY_ZOOM_LEVEL = "zoomLevel";
const KEY_EDITOR_FONT_SIZE = "editorFontSize";
const KEY_EDITOR_TAB_SIZE = "editorTabSize";
const KEY_EDITOR_WORD_WRAP = "editorWordWrap";
const KEY_SOURCE_CONTROL_PANEL_WIDTH = "sourceControlPanelWidth";
const KEY_EXPLORER_PANEL_WIDTH = "explorerPanelWidth";
const KEY_TOUCH_OPTIMIZATIONS = "touchOptimizations";
const KEY_EDITOR_LSP_TYPESCRIPT_MODE = "editorLspTypescriptMode";
const KEY_LAYOUT_LEFT_SIDEBAR = "layout.leftSidebar";
const KEY_LAYOUT_PANELS = "layout.panels";

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

export const LEFT_SIDEBAR_WIDTH_DEFAULT = 280;
export const LEFT_SIDEBAR_WIDTH_MIN = 200;
export const LEFT_SIDEBAR_WIDTH_MAX = 480;

const ACTIVITY_VALUES: readonly LeftSidebarPref["activity"][] = [
  "workspace",
  "sourceControl",
];

function clampLeftSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return LEFT_SIDEBAR_WIDTH_DEFAULT;
  return Math.min(
    LEFT_SIDEBAR_WIDTH_MAX,
    Math.max(LEFT_SIDEBAR_WIDTH_MIN, Math.round(value)),
  );
}

function normalizeLeftSidebarPref(value: unknown): LeftSidebarPref {
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

function normalizePanelVisibilityPref(value: unknown): PanelVisibilityPref {
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

export const SIDE_PANEL_WIDTH_DEFAULT = 288;

export const EDITOR_FONT_SIZE_DEFAULT = 13;
export const EDITOR_FONT_SIZE_MIN = 10;
export const EDITOR_FONT_SIZE_MAX = 24;
export const EDITOR_TAB_SIZE_DEFAULT = 2;
export const SIDE_PANEL_WIDTH_MIN = 220;
export const SIDE_PANEL_WIDTH_MAX = 440;

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
  editorTheme: "atomone",
  autostart: false,
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
  terminalOscHyperlink: true,
  terminalNotificationEnabled: true,
  terminalNotificationSoundEnabled: true,
  // 其它
  keybindings: {},
  lastWslDistro: null,
  lastWorkspace: null,
  recentWorkspaces: [],
  openWorkspaces: [],
  activeWorkspaceId: null,
  recentFiles: [],
  zoomLevel: 1.0,
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
};

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 200 });

const PREFS_CHANGED_EVENT = "nexterm://prefs-changed";

async function writePref<T>(key: string, value: T): Promise<void> {
  await store.set(key, value);
  await store.save();
  await emit(PREFS_CHANGED_EVENT, { key, value });
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

export async function loadPreferences(): Promise<Preferences> {
  const entries = await store.entries();
  const map = new Map<string, unknown>(entries);
  const get = <T>(k: string): T | undefined => map.get(k) as T | undefined;
  return {
    theme: get<ThemePref>(KEY_THEME) ?? DEFAULT_PREFERENCES.theme,
    language: get<LanguagePref>(KEY_LANGUAGE) ?? DEFAULT_PREFERENCES.language,
    editorTheme:
      get<EditorThemeId>(KEY_EDITOR_THEME) ?? DEFAULT_PREFERENCES.editorTheme,
    autostart: get<boolean>(KEY_AUTOSTART) ?? DEFAULT_PREFERENCES.autostart,
    restoreWindowState:
      get<boolean>(KEY_RESTORE_WINDOW) ??
      DEFAULT_PREFERENCES.restoreWindowState,
    vimMode: get<boolean>(KEY_VIM_MODE) ?? DEFAULT_PREFERENCES.vimMode,
    editorLspTypescriptMode:
      get<EditorLspTypescriptMode>(KEY_EDITOR_LSP_TYPESCRIPT_MODE) ??
      DEFAULT_PREFERENCES.editorLspTypescriptMode,
    fileOpenMode:
      get<FileOpenMode>(KEY_FILE_OPEN_MODE) ?? DEFAULT_PREFERENCES.fileOpenMode,
    showHidden:
      get<boolean>(KEY_SHOW_HIDDEN) ??
      get<boolean>(LEGACY_KEY_SHOW_HIDDEN_DIRS) ??
      DEFAULT_PREFERENCES.showHidden,
    terminalWebglEnabled:
      get<boolean>(KEY_TERMINAL_WEBGL_ENABLED) ??
      DEFAULT_PREFERENCES.terminalWebglEnabled,
    terminalContextMenuEnabled:
      get<boolean>(KEY_TERMINAL_CONTEXT_MENU_ENABLED) ??
      DEFAULT_PREFERENCES.terminalContextMenuEnabled,
    terminalFontFamily:
      get<string>(KEY_TERMINAL_FONT_FAMILY) ??
      DEFAULT_PREFERENCES.terminalFontFamily,
    terminalFontWeight:
      get<TerminalFontWeight>(KEY_TERMINAL_FONT_WEIGHT) ??
      DEFAULT_PREFERENCES.terminalFontWeight,
    terminalFontWeightBold:
      get<TerminalFontWeight>(KEY_TERMINAL_FONT_WEIGHT_BOLD) ??
      DEFAULT_PREFERENCES.terminalFontWeightBold,
    terminalLetterSpacing:
      get<number>(KEY_TERMINAL_LETTER_SPACING) ??
      DEFAULT_PREFERENCES.terminalLetterSpacing,
    terminalFontSize:
      get<number>(KEY_TERMINAL_FONT_SIZE) ??
      DEFAULT_PREFERENCES.terminalFontSize,
    terminalNerdFontEnabled:
      get<boolean>(KEY_TERMINAL_NERD_FONT_ENABLED) ??
      DEFAULT_PREFERENCES.terminalNerdFontEnabled,
    terminalCjkFontEnabled:
      get<boolean>(KEY_TERMINAL_CJK_FONT_ENABLED) ??
      DEFAULT_PREFERENCES.terminalCjkFontEnabled,
    terminalEmojiFontEnabled:
      get<boolean>(KEY_TERMINAL_EMOJI_FONT_ENABLED) ??
      DEFAULT_PREFERENCES.terminalEmojiFontEnabled,
    terminalCursorStyle:
      get<TerminalCursorStyle>(KEY_TERMINAL_CURSOR_STYLE) ??
      DEFAULT_PREFERENCES.terminalCursorStyle,
    terminalCursorBlink:
      get<boolean>(KEY_TERMINAL_CURSOR_BLINK) ??
      DEFAULT_PREFERENCES.terminalCursorBlink,
    terminalCursorInactiveStyle:
      get<TerminalCursorInactiveStyle>(
        KEY_TERMINAL_CURSOR_INACTIVE_STYLE,
      ) ?? DEFAULT_PREFERENCES.terminalCursorInactiveStyle,
    terminalRenderer:
      get<TerminalRenderer>(KEY_TERMINAL_RENDERER) ??
      DEFAULT_PREFERENCES.terminalRenderer,
    terminalRendererAutoFallback:
      get<boolean>(KEY_TERMINAL_RENDERER_AUTO_FALLBACK) ??
      DEFAULT_PREFERENCES.terminalRendererAutoFallback,
    terminalScrollback: clampScrollback(
      get<number>(KEY_TERMINAL_SCROLLBACK) ??
        DEFAULT_PREFERENCES.terminalScrollback,
    ),
    terminalFastScrollSensitivity:
      get<number>(KEY_TERMINAL_FAST_SCROLL_SENSITIVITY) ??
      DEFAULT_PREFERENCES.terminalFastScrollSensitivity,
    terminalFastScrollModifier:
      get<TerminalFastScrollModifier>(KEY_TERMINAL_FAST_SCROLL_MODIFIER) ??
      DEFAULT_PREFERENCES.terminalFastScrollModifier,
    terminalMacOptionIsMeta:
      get<boolean>(KEY_TERMINAL_MAC_OPTION_IS_META) ??
      DEFAULT_PREFERENCES.terminalMacOptionIsMeta,
    terminalMacOptionClickForcesSelection:
      get<boolean>(KEY_TERMINAL_MAC_OPTION_CLICK_FORCES_SELECTION) ??
      DEFAULT_PREFERENCES.terminalMacOptionClickForcesSelection,
    terminalMinimumContrastRatio:
      get<number>(KEY_TERMINAL_MINIMUM_CONTRAST_RATIO) ??
      DEFAULT_PREFERENCES.terminalMinimumContrastRatio,
    terminalDrawBoldTextInBrightColors:
      get<boolean>(KEY_TERMINAL_DRAW_BOLD_TEXT_IN_BRIGHT_COLORS) ??
      DEFAULT_PREFERENCES.terminalDrawBoldTextInBrightColors,
    terminalCustomGlyphs:
      get<boolean>(KEY_TERMINAL_CUSTOM_GLYPHS) ??
      DEFAULT_PREFERENCES.terminalCustomGlyphs,
    terminalRescaleOverlappingGlyphs:
      get<boolean>(KEY_TERMINAL_RESCALE_OVERLAPPING_GLYPHS) ??
      DEFAULT_PREFERENCES.terminalRescaleOverlappingGlyphs,
    terminalOscHyperlink:
      get<boolean>(KEY_TERMINAL_OSC_HYPERLINK) ??
      DEFAULT_PREFERENCES.terminalOscHyperlink,
    terminalNotificationEnabled:
      get<boolean>(KEY_TERMINAL_NOTIFICATION_ENABLED) ??
      DEFAULT_PREFERENCES.terminalNotificationEnabled,
    terminalNotificationSoundEnabled:
      get<boolean>(KEY_TERMINAL_NOTIFICATION_SOUND_ENABLED) ??
      DEFAULT_PREFERENCES.terminalNotificationSoundEnabled,
    keybindings: normalizeKeybindingOverrides(get(KEY_KEYBINDINGS)),
    lastWslDistro:
      get<string | null>(KEY_LAST_WSL_DISTRO) ??
      DEFAULT_PREFERENCES.lastWslDistro,
    lastWorkspace:
      get<StoredWorkspace | null>(KEY_LAST_WORKSPACE) ??
      DEFAULT_PREFERENCES.lastWorkspace,
    recentWorkspaces:
      get<StoredWorkspace[]>(KEY_RECENT_WORKSPACES) ??
      DEFAULT_PREFERENCES.recentWorkspaces,
    openWorkspaces:
      get<PersistedWorkspace[]>(KEY_OPEN_WORKSPACES) ??
      DEFAULT_PREFERENCES.openWorkspaces,
    activeWorkspaceId:
      get<string | null>(KEY_ACTIVE_WORKSPACE_ID) ??
      DEFAULT_PREFERENCES.activeWorkspaceId,
    recentFiles:
      get<string[]>(KEY_RECENT_FILES) ?? DEFAULT_PREFERENCES.recentFiles,
    zoomLevel: get<number>(KEY_ZOOM_LEVEL) ?? DEFAULT_PREFERENCES.zoomLevel,
    sourceControlPanelWidth: clampSidePanelWidth(
      get<number>(KEY_SOURCE_CONTROL_PANEL_WIDTH) ??
        DEFAULT_PREFERENCES.sourceControlPanelWidth,
    ),
    explorerPanelWidth: clampSidePanelWidth(
      get<number>(KEY_EXPLORER_PANEL_WIDTH) ??
        DEFAULT_PREFERENCES.explorerPanelWidth,
    ),
    touchOptimizations: normalizeTouchMode(get(KEY_TOUCH_OPTIMIZATIONS)),
    editorFontSize: clampEditorFontSize(
      get<number>(KEY_EDITOR_FONT_SIZE) ?? DEFAULT_PREFERENCES.editorFontSize,
    ),
    editorTabSize:
      get<number>(KEY_EDITOR_TAB_SIZE) ?? DEFAULT_PREFERENCES.editorTabSize,
    editorWordWrap:
      get<boolean>(KEY_EDITOR_WORD_WRAP) ?? DEFAULT_PREFERENCES.editorWordWrap,
    leftSidebar: normalizeLeftSidebarPref(get(KEY_LAYOUT_LEFT_SIDEBAR)),
    panelVisibility: normalizePanelVisibilityPref(get(KEY_LAYOUT_PANELS)),
  };
}

export async function setTheme(value: ThemePref): Promise<void> {
  await writePref(KEY_THEME, value);
}

export async function setLanguage(value: LanguagePref): Promise<void> {
  await writePref(KEY_LANGUAGE, value);
}

export async function setEditorTheme(value: EditorThemeId): Promise<void> {
  await writePref(KEY_EDITOR_THEME, value);
}

export async function setAutostart(value: boolean): Promise<void> {
  await writePref(KEY_AUTOSTART, value);
}

export async function setRestoreWindowState(value: boolean): Promise<void> {
  await writePref(KEY_RESTORE_WINDOW, value);
}

export async function setVimMode(value: boolean): Promise<void> {
  await writePref(KEY_VIM_MODE, value);
}

export async function setEditorLspTypescriptMode(
  value: EditorLspTypescriptMode,
): Promise<void> {
  await writePref(KEY_EDITOR_LSP_TYPESCRIPT_MODE, value);
}

export async function setFileOpenMode(value: FileOpenMode): Promise<void> {
  await writePref(KEY_FILE_OPEN_MODE, value);
}

export async function setShowHidden(value: boolean): Promise<void> {
  await writePref(KEY_SHOW_HIDDEN, value);
}

export async function setTerminalWebglEnabled(value: boolean): Promise<void> {
  await writePref(KEY_TERMINAL_WEBGL_ENABLED, value);
}

export async function setTerminalContextMenuEnabled(
  value: boolean,
): Promise<void> {
  await writePref(KEY_TERMINAL_CONTEXT_MENU_ENABLED, value);
}

export async function setTerminalFontFamily(value: string): Promise<void> {
  await writePref(KEY_TERMINAL_FONT_FAMILY, value.trim());
}

const TERMINAL_FONT_WEIGHT_VALUES: readonly TerminalFontWeight[] = [
  100, 200, 300, 400, 500, 600, 700, 800, 900,
];

function clampFontWeightStored(value: number): TerminalFontWeight {
  if (!Number.isFinite(value)) return 400;
  const rounded = Math.round(value / 100) * 100;
  const clamped = Math.max(100, Math.min(900, rounded));
  return (TERMINAL_FONT_WEIGHT_VALUES.includes(clamped as TerminalFontWeight)
    ? (clamped as TerminalFontWeight)
    : 400);
}

/** 暴露给 Pinia store 做乐观更新时的同步 clamp */
export const clampTerminalFontWeight = clampFontWeightStored;

export async function setTerminalFontWeight(
  value: number,
): Promise<void> {
  await writePref(KEY_TERMINAL_FONT_WEIGHT, clampFontWeightStored(value));
}

export async function setTerminalFontWeightBold(
  value: number,
): Promise<void> {
  await writePref(KEY_TERMINAL_FONT_WEIGHT_BOLD, clampFontWeightStored(value));
}

export async function setTerminalNerdFontEnabled(
  value: boolean,
): Promise<void> {
  await writePref(KEY_TERMINAL_NERD_FONT_ENABLED, value);
}

export async function setTerminalCjkFontEnabled(
  value: boolean,
): Promise<void> {
  await writePref(KEY_TERMINAL_CJK_FONT_ENABLED, value);
}

export async function setTerminalEmojiFontEnabled(
  value: boolean,
): Promise<void> {
  await writePref(KEY_TERMINAL_EMOJI_FONT_ENABLED, value);
}

const TERMINAL_CURSOR_STYLE_VALUES: readonly TerminalCursorStyle[] = [
  "block",
  "underline",
  "bar",
];

function clampCursorStyle(value: unknown): TerminalCursorStyle {
  return TERMINAL_CURSOR_STYLE_VALUES.includes(value as TerminalCursorStyle)
    ? (value as TerminalCursorStyle)
    : "block";
}

export const clampTerminalCursorStyle = clampCursorStyle;

const TERMINAL_CURSOR_INACTIVE_VALUES_INTERNAL: readonly TerminalCursorInactiveStyle[] =
  TERMINAL_CURSOR_INACTIVE_VALUES;

function clampCursorInactiveStyle(value: unknown): TerminalCursorInactiveStyle {
  return TERMINAL_CURSOR_INACTIVE_VALUES_INTERNAL.includes(
    value as TerminalCursorInactiveStyle,
  )
    ? (value as TerminalCursorInactiveStyle)
    : "outline";
}

export const clampTerminalCursorInactiveStyle = clampCursorInactiveStyle;

export async function setTerminalCursorStyle(
  value: TerminalCursorStyle,
): Promise<void> {
  await writePref(KEY_TERMINAL_CURSOR_STYLE, clampCursorStyle(value));
}

export async function setTerminalCursorBlink(value: boolean): Promise<void> {
  await writePref(KEY_TERMINAL_CURSOR_BLINK, value);
}

export async function setTerminalCursorInactiveStyle(
  value: TerminalCursorInactiveStyle,
): Promise<void> {
  await writePref(
    KEY_TERMINAL_CURSOR_INACTIVE_STYLE,
    clampCursorInactiveStyle(value),
  );
}

const TERMINAL_RENDERER_VALUES: readonly TerminalRenderer[] = ["webgl", "dom"];

function clampRenderer(value: unknown): TerminalRenderer {
  return TERMINAL_RENDERER_VALUES.includes(value as TerminalRenderer)
    ? (value as TerminalRenderer)
    : "webgl";
}

export const clampTerminalRenderer = clampRenderer;

export async function setTerminalRenderer(
  value: TerminalRenderer,
): Promise<void> {
  await writePref(KEY_TERMINAL_RENDERER, clampRenderer(value));
}

export async function setTerminalRendererAutoFallback(
  value: boolean,
): Promise<void> {
  await writePref(KEY_TERMINAL_RENDERER_AUTO_FALLBACK, value);
}

export function clampTerminalFastScrollSensitivity(value: number): number {
  if (!Number.isFinite(value)) return 5;
  return Math.max(1, Math.min(20, Math.round(value)));
}

export async function setTerminalFastScrollSensitivity(
  value: number,
): Promise<void> {
  await writePref(
    KEY_TERMINAL_FAST_SCROLL_SENSITIVITY,
    clampTerminalFastScrollSensitivity(value),
  );
}

const TERMINAL_FAST_SCROLL_MODIFIER_VALUES_INTERNAL: readonly TerminalFastScrollModifier[] =
  TERMINAL_FAST_SCROLL_MODIFIER_VALUES;

function clampFastScrollModifier(value: unknown): TerminalFastScrollModifier {
  return TERMINAL_FAST_SCROLL_MODIFIER_VALUES_INTERNAL.includes(
    value as TerminalFastScrollModifier,
  )
    ? (value as TerminalFastScrollModifier)
    : "alt";
}

export const clampTerminalFastScrollModifier = clampFastScrollModifier;

export async function setTerminalFastScrollModifier(
  value: TerminalFastScrollModifier,
): Promise<void> {
  await writePref(
    KEY_TERMINAL_FAST_SCROLL_MODIFIER,
    clampFastScrollModifier(value),
  );
}

export async function setTerminalMacOptionIsMeta(
  value: boolean,
): Promise<void> {
  await writePref(KEY_TERMINAL_MAC_OPTION_IS_META, value);
}

export async function setTerminalMacOptionClickForcesSelection(
  value: boolean,
): Promise<void> {
  await writePref(KEY_TERMINAL_MAC_OPTION_CLICK_FORCES_SELECTION, value);
}

export function clampTerminalMinimumContrastRatio(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(21, value));
}

export async function setTerminalMinimumContrastRatio(
  value: number,
): Promise<void> {
  await writePref(
    KEY_TERMINAL_MINIMUM_CONTRAST_RATIO,
    clampTerminalMinimumContrastRatio(value),
  );
}

export async function setTerminalDrawBoldTextInBrightColors(
  value: boolean,
): Promise<void> {
  await writePref(KEY_TERMINAL_DRAW_BOLD_TEXT_IN_BRIGHT_COLORS, value);
}

export async function setTerminalCustomGlyphs(value: boolean): Promise<void> {
  await writePref(KEY_TERMINAL_CUSTOM_GLYPHS, value);
}

export async function setTerminalRescaleOverlappingGlyphs(
  value: boolean,
): Promise<void> {
  await writePref(KEY_TERMINAL_RESCALE_OVERLAPPING_GLYPHS, value);
}

export async function setTerminalOscHyperlink(value: boolean): Promise<void> {
  await writePref(KEY_TERMINAL_OSC_HYPERLINK, value);
}

export async function setTerminalLetterSpacing(value: number): Promise<void> {
  const clamped = Number.isFinite(value)
    ? Math.max(-10, Math.min(10, Math.round(value)))
    : 0;
  await writePref(KEY_TERMINAL_LETTER_SPACING, clamped);
}

export async function setTerminalFontSize(value: number): Promise<void> {
  const clamped = Number.isFinite(value)
    ? Math.min(
        TERMINAL_FONT_SIZE_MAX,
        Math.max(TERMINAL_FONT_SIZE_MIN, Math.round(value)),
      )
    : TERMINAL_FONT_SIZE_DEFAULT;
  await writePref(KEY_TERMINAL_FONT_SIZE, clamped);
}

function clampScrollback(value: number): number {
  if (!Number.isFinite(value)) return TERMINAL_SCROLLBACK_DEFAULT;
  return Math.min(
    TERMINAL_SCROLLBACK_MAX,
    Math.max(TERMINAL_SCROLLBACK_MIN, Math.round(value)),
  );
}

export async function setTerminalScrollback(value: number): Promise<void> {
  await writePref(KEY_TERMINAL_SCROLLBACK, clampScrollback(value));
}

export async function setTerminalNotificationEnabled(
  value: boolean,
): Promise<void> {
  await writePref(KEY_TERMINAL_NOTIFICATION_ENABLED, value);
}

export async function setTerminalNotificationSoundEnabled(
  value: boolean,
): Promise<void> {
  await writePref(KEY_TERMINAL_NOTIFICATION_SOUND_ENABLED, value);
}

export async function setKeybindings(
  value: KeybindingOverrides,
): Promise<void> {
  await writePref(KEY_KEYBINDINGS, value);
}

export async function setLastWslDistro(value: string | null): Promise<void> {
  await writePref(KEY_LAST_WSL_DISTRO, value);
}

export async function setLastWorkspace(
  value: StoredWorkspace | null,
): Promise<void> {
  await writePref(KEY_LAST_WORKSPACE, value);
}

export async function setRecentWorkspaces(
  value: StoredWorkspace[],
): Promise<void> {
  await writePref(KEY_RECENT_WORKSPACES, value);
}

export async function setOpenWorkspaces(
  value: PersistedWorkspace[],
): Promise<void> {
  await writePref(KEY_OPEN_WORKSPACES, value);
}

export async function setActiveWorkspaceId(
  value: string | null,
): Promise<void> {
  await writePref(KEY_ACTIVE_WORKSPACE_ID, value);
}

export async function setRecentFiles(value: string[]): Promise<void> {
  await writePref(KEY_RECENT_FILES, value);
}

export async function setZoomLevel(value: number): Promise<void> {
  await writePref(KEY_ZOOM_LEVEL, value);
}

function clampSidePanelWidth(value: number): number {
  if (!Number.isFinite(value)) return SIDE_PANEL_WIDTH_DEFAULT;
  return Math.min(
    SIDE_PANEL_WIDTH_MAX,
    Math.max(SIDE_PANEL_WIDTH_MIN, Math.round(value)),
  );
}

export async function setSourceControlPanelWidth(value: number): Promise<void> {
  await writePref(KEY_SOURCE_CONTROL_PANEL_WIDTH, clampSidePanelWidth(value));
}

export async function setExplorerPanelWidth(value: number): Promise<void> {
  await writePref(KEY_EXPLORER_PANEL_WIDTH, clampSidePanelWidth(value));
}

export async function setTouchOptimizations(value: TouchMode): Promise<void> {
  await writePref(KEY_TOUCH_OPTIMIZATIONS, normalizeTouchMode(value));
}

function clampEditorFontSize(value: number): number {
  if (!Number.isFinite(value)) return EDITOR_FONT_SIZE_DEFAULT;
  return Math.min(EDITOR_FONT_SIZE_MAX, Math.max(EDITOR_FONT_SIZE_MIN, Math.round(value)));
}

export async function setEditorFontSize(value: number): Promise<void> {
  await writePref(KEY_EDITOR_FONT_SIZE, clampEditorFontSize(value));
}

export async function setEditorTabSize(value: number): Promise<void> {
  const valid = [2, 4, 8].includes(value) ? value : EDITOR_TAB_SIZE_DEFAULT;
  await writePref(KEY_EDITOR_TAB_SIZE, valid);
}

export async function setEditorWordWrap(value: boolean): Promise<void> {
  await writePref(KEY_EDITOR_WORD_WRAP, value);
}

export async function setLayoutLeftSidebar(
  value: LeftSidebarPref,
): Promise<void> {
  await writePref(KEY_LAYOUT_LEFT_SIDEBAR, normalizeLeftSidebarPref(value));
}

export async function setLayoutPanels(
  value: PanelVisibilityPref,
): Promise<void> {
  await writePref(KEY_LAYOUT_PANELS, normalizePanelVisibilityPref(value));
}

export type PrefKey = keyof Preferences;

export async function onPreferencesChange(
  cb: (key: PrefKey, value: unknown) => void,
): Promise<UnlistenFn> {
  const map: Record<string, PrefKey> = {
    [KEY_THEME]: "theme",
    [KEY_LANGUAGE]: "language",
    [KEY_EDITOR_THEME]: "editorTheme",
    [KEY_AUTOSTART]: "autostart",
    [KEY_RESTORE_WINDOW]: "restoreWindowState",
    [KEY_VIM_MODE]: "vimMode",
    [KEY_FILE_OPEN_MODE]: "fileOpenMode",
    [KEY_SHOW_HIDDEN]: "showHidden",
    [KEY_TERMINAL_WEBGL_ENABLED]: "terminalWebglEnabled",
    [KEY_TERMINAL_CONTEXT_MENU_ENABLED]: "terminalContextMenuEnabled",
    [KEY_TERMINAL_FONT_FAMILY]: "terminalFontFamily",
    [KEY_TERMINAL_FONT_WEIGHT]: "terminalFontWeight",
    [KEY_TERMINAL_FONT_WEIGHT_BOLD]: "terminalFontWeightBold",
    [KEY_TERMINAL_LETTER_SPACING]: "terminalLetterSpacing",
    [KEY_TERMINAL_FONT_SIZE]: "terminalFontSize",
    [KEY_TERMINAL_NERD_FONT_ENABLED]: "terminalNerdFontEnabled",
    [KEY_TERMINAL_CJK_FONT_ENABLED]: "terminalCjkFontEnabled",
    [KEY_TERMINAL_EMOJI_FONT_ENABLED]: "terminalEmojiFontEnabled",
    [KEY_TERMINAL_CURSOR_STYLE]: "terminalCursorStyle",
    [KEY_TERMINAL_CURSOR_BLINK]: "terminalCursorBlink",
    [KEY_TERMINAL_CURSOR_INACTIVE_STYLE]: "terminalCursorInactiveStyle",
    [KEY_TERMINAL_RENDERER]: "terminalRenderer",
    [KEY_TERMINAL_RENDERER_AUTO_FALLBACK]: "terminalRendererAutoFallback",
    [KEY_TERMINAL_SCROLLBACK]: "terminalScrollback",
    [KEY_TERMINAL_FAST_SCROLL_SENSITIVITY]: "terminalFastScrollSensitivity",
    [KEY_TERMINAL_FAST_SCROLL_MODIFIER]: "terminalFastScrollModifier",
    [KEY_TERMINAL_MAC_OPTION_IS_META]: "terminalMacOptionIsMeta",
    [KEY_TERMINAL_MAC_OPTION_CLICK_FORCES_SELECTION]:
      "terminalMacOptionClickForcesSelection",
    [KEY_TERMINAL_MINIMUM_CONTRAST_RATIO]: "terminalMinimumContrastRatio",
    [KEY_TERMINAL_DRAW_BOLD_TEXT_IN_BRIGHT_COLORS]:
      "terminalDrawBoldTextInBrightColors",
    [KEY_TERMINAL_CUSTOM_GLYPHS]: "terminalCustomGlyphs",
    [KEY_TERMINAL_RESCALE_OVERLAPPING_GLYPHS]:
      "terminalRescaleOverlappingGlyphs",
    [KEY_TERMINAL_OSC_HYPERLINK]: "terminalOscHyperlink",
    [KEY_TERMINAL_NOTIFICATION_ENABLED]: "terminalNotificationEnabled",
    [KEY_TERMINAL_NOTIFICATION_SOUND_ENABLED]:
      "terminalNotificationSoundEnabled",
    [KEY_KEYBINDINGS]: "keybindings",
    [KEY_LAST_WSL_DISTRO]: "lastWslDistro",
    [KEY_LAST_WORKSPACE]: "lastWorkspace",
    [KEY_RECENT_WORKSPACES]: "recentWorkspaces",
    [KEY_OPEN_WORKSPACES]: "openWorkspaces",
    [KEY_ACTIVE_WORKSPACE_ID]: "activeWorkspaceId",
    [KEY_RECENT_FILES]: "recentFiles",
    [KEY_ZOOM_LEVEL]: "zoomLevel",
    [KEY_SOURCE_CONTROL_PANEL_WIDTH]: "sourceControlPanelWidth",
    [KEY_EXPLORER_PANEL_WIDTH]: "explorerPanelWidth",
    [KEY_TOUCH_OPTIMIZATIONS]: "touchOptimizations",
    [KEY_LAYOUT_LEFT_SIDEBAR]: "leftSidebar",
    [KEY_LAYOUT_PANELS]: "panelVisibility",
  };
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
