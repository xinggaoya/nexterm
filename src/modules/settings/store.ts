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

export type Preferences = {
  theme: ThemePref;
  language: LanguagePref;
  editorTheme: EditorThemeId;
  autostart: boolean;
  restoreWindowState: boolean;
  vimMode: boolean;
  fileOpenMode: FileOpenMode;
  showHidden: boolean;
  terminalWebglEnabled: boolean;
  terminalContextMenuEnabled: boolean;
  terminalFontFamily: string;
  terminalLetterSpacing: number;
  terminalFontSize: number;
  terminalScrollback: number;
  terminalNotificationEnabled: boolean;
  terminalNotificationSoundEnabled: boolean;
  keybindings: KeybindingOverrides;
  lastWslDistro: string | null;
  lastWorkspace: StoredWorkspace | null;
  recentWorkspaces: StoredWorkspace[];
  recentFiles: string[];
  zoomLevel: number;
  sourceControlPanelWidth: number;
  explorerPanelWidth: number;
  touchOptimizations: TouchMode;
  editorFontSize: number;
  editorTabSize: number;
  editorWordWrap: boolean;
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
const KEY_TERMINAL_LETTER_SPACING = "terminalLetterSpacing";
const KEY_TERMINAL_FONT_SIZE = "terminalFontSize";
const KEY_TERMINAL_SCROLLBACK = "terminalScrollback";
const KEY_TERMINAL_NOTIFICATION_ENABLED = "terminalNotificationEnabled";
const KEY_TERMINAL_NOTIFICATION_SOUND_ENABLED = "terminalNotificationSoundEnabled";
const KEY_KEYBINDINGS = "keybindings";
const KEY_LAST_WSL_DISTRO = "lastWslDistro";
const KEY_LAST_WORKSPACE = "lastWorkspace";
const KEY_RECENT_WORKSPACES = "recentWorkspaces";
const KEY_RECENT_FILES = "recentFiles";
const KEY_ZOOM_LEVEL = "zoomLevel";
const KEY_EDITOR_FONT_SIZE = "editorFontSize";
const KEY_EDITOR_TAB_SIZE = "editorTabSize";
const KEY_EDITOR_WORD_WRAP = "editorWordWrap";
const KEY_SOURCE_CONTROL_PANEL_WIDTH = "sourceControlPanelWidth";
const KEY_EXPLORER_PANEL_WIDTH = "explorerPanelWidth";
const KEY_TOUCH_OPTIMIZATIONS = "touchOptimizations";

export const SIDE_PANEL_WIDTH_DEFAULT = 256;

export const EDITOR_FONT_SIZE_DEFAULT = 13;
export const EDITOR_FONT_SIZE_MIN = 10;
export const EDITOR_FONT_SIZE_MAX = 24;
export const EDITOR_TAB_SIZE_DEFAULT = 2;
export const SIDE_PANEL_WIDTH_MIN = 180;
export const SIDE_PANEL_WIDTH_MAX = 520;

export const TERMINAL_FONT_SIZE_DEFAULT = 14;
export const TERMINAL_FONT_SIZE_MIN = 8;
export const TERMINAL_FONT_SIZE_MAX = 32;

export const TERMINAL_FONT_SIZES = [
  10, 12, 13, 14, 15, 16, 18, 20, 22, 24,
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
  terminalWebglEnabled: true,
  terminalContextMenuEnabled: true,
  terminalFontFamily: "",
  terminalLetterSpacing: 0,
  terminalFontSize: TERMINAL_FONT_SIZE_DEFAULT,
  terminalScrollback: TERMINAL_SCROLLBACK_DEFAULT,
  terminalNotificationEnabled: true,
  terminalNotificationSoundEnabled: true,
  keybindings: {},
  lastWslDistro: null,
  lastWorkspace: null,
  recentWorkspaces: [],
  recentFiles: [],
  zoomLevel: 1.0,
  sourceControlPanelWidth: SIDE_PANEL_WIDTH_DEFAULT,
  explorerPanelWidth: SIDE_PANEL_WIDTH_DEFAULT,
  touchOptimizations: "off",
  editorFontSize: EDITOR_FONT_SIZE_DEFAULT,
  editorTabSize: EDITOR_TAB_SIZE_DEFAULT,
  editorWordWrap: false,
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
    terminalLetterSpacing:
      get<number>(KEY_TERMINAL_LETTER_SPACING) ??
      DEFAULT_PREFERENCES.terminalLetterSpacing,
    terminalFontSize:
      get<number>(KEY_TERMINAL_FONT_SIZE) ??
      DEFAULT_PREFERENCES.terminalFontSize,
    terminalScrollback: clampScrollback(
      get<number>(KEY_TERMINAL_SCROLLBACK) ??
        DEFAULT_PREFERENCES.terminalScrollback,
    ),
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
    [KEY_TERMINAL_LETTER_SPACING]: "terminalLetterSpacing",
    [KEY_TERMINAL_FONT_SIZE]: "terminalFontSize",
    [KEY_TERMINAL_SCROLLBACK]: "terminalScrollback",
    [KEY_TERMINAL_NOTIFICATION_ENABLED]: "terminalNotificationEnabled",
    [KEY_TERMINAL_NOTIFICATION_SOUND_ENABLED]: "terminalNotificationSoundEnabled",
    [KEY_KEYBINDINGS]: "keybindings",
    [KEY_LAST_WSL_DISTRO]: "lastWslDistro",
    [KEY_LAST_WORKSPACE]: "lastWorkspace",
    [KEY_RECENT_WORKSPACES]: "recentWorkspaces",
    [KEY_RECENT_FILES]: "recentFiles",
    [KEY_ZOOM_LEVEL]: "zoomLevel",
    [KEY_SOURCE_CONTROL_PANEL_WIDTH]: "sourceControlPanelWidth",
    [KEY_EXPLORER_PANEL_WIDTH]: "explorerPanelWidth",
    [KEY_TOUCH_OPTIMIZATIONS]: "touchOptimizations",
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
