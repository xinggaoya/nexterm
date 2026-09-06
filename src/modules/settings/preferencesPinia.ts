import { defineStore } from "pinia";
import { ref, type Ref } from "vue";
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  onPreferencesChange,
  setPreference,
  PREF_SPECS,
  type AccentPref,
  type EditorLspTypescriptMode,
  type LeftSidebarPref,
  type PanelVisibilityPref,
  type Preferences,
  type PrefKey,
  type TabWidthMode,
} from "./store";
import type { CommandId, KeybindingOverrides } from "@/modules/commands/types";
import {
  patchPreferencesSnapshot,
  replacePreferencesSnapshot,
} from "./preferencesSnapshot";

/**
 * 偏好 Pinia store（spec 驱动）。
 *
 * 每个 pref 的 ref / 快照同步 / 乐观更新 / 持久化全部由 store.ts 的
 * PREF_SPECS 表驱动：updatePref 统一做「sanitize → 乐观更新 ref →
 * patch 快照 → 写盘」，不再出现逐字段手写的三行样板。对外保留
 * `updateXxx` 形式的具名函数，组件调用点无需感知这次重构。
 */
export const usePreferencesPiniaStore = defineStore("preferences", () => {
  const PREF_KEYS = Object.keys(DEFAULT_PREFERENCES) as PrefKey[];

  const stateRefs = Object.fromEntries(
    PREF_KEYS.map((key) => [key, ref(DEFAULT_PREFERENCES[key])]),
  ) as { [K in PrefKey]: Ref<Preferences[K]> };
  // 联合键循环写入的 unknown 视图（applySnapshot / 回灌用）。
  const stateSink = stateRefs as unknown as Record<PrefKey, Ref<unknown>>;

  const hydrated = ref(false);
  const listening = ref(false);

  function applySnapshot(snapshot: Preferences): void {
    const source = snapshot as unknown as Record<PrefKey, unknown>;
    for (const key of PREF_KEYS) {
      stateSink[key].value = source[key];
    }
  }

  async function hydrate(): Promise<void> {
    if (hydrated.value) return;
    const prefs = await loadPreferences();
    replacePreferencesSnapshot(prefs);
    applySnapshot(prefs);
    hydrated.value = true;
    if (listening.value) return;
    listening.value = true;
    void onPreferencesChange((key, value) => {
      // 跨窗口/跨 store 的变更回灌：值来自写盘路径（已 sanitize）。
      const sanitized = sanitizeValue(key, value);
      stateSink[key].value = sanitized;
      patchPreferencesSnapshot(key, sanitized);
    });
  }

  function sanitizeValue<K extends PrefKey>(
    key: K,
    value: unknown,
  ): Preferences[K] {
    const sanitize = PREF_SPECS[key].sanitize as
      | ((value: unknown) => unknown)
      | undefined;
    return (sanitize ? sanitize(value) : value) as Preferences[K];
  }

  /** 单一更新入口：sanitize → 乐观 ref → 快照 patch → 持久化。 */
  async function updatePref<K extends PrefKey>(
    key: K,
    value: Preferences[K],
  ): Promise<void> {
    const sanitized = sanitizeValue(key, value);
    stateSink[key].value = sanitized;
    patchPreferencesSnapshot(key, sanitized);
    await setPreference(key, sanitized);
  }

  // ── 具名更新函数：保持既有 API，实现全部委托 updatePref ──────────────
  const updateTheme = (value: Preferences["theme"]) => updatePref("theme", value);
  const updateLanguage = (value: Preferences["language"]) => updatePref("language", value);
  const updateAccent = (value: AccentPref) => updatePref("accent", value);
  const updateEditorTheme = (value: Preferences["editorTheme"]) => updatePref("editorTheme", value);
  const updateAutostart = (value: boolean) => updatePref("autostart", value);
  const updateAutoCheckUpdates = (value: boolean) => updatePref("autoCheckUpdates", value);
  const updateRestoreWindowState = (value: boolean) => updatePref("restoreWindowState", value);
  const updateVimMode = (value: boolean) => updatePref("vimMode", value);
  const updateEditorLspTypescriptMode = (value: EditorLspTypescriptMode) =>
    updatePref("editorLspTypescriptMode", value);
  const updateFileOpenMode = (value: Preferences["fileOpenMode"]) => updatePref("fileOpenMode", value);
  const updateShowHidden = (value: boolean) => updatePref("showHidden", value);
  const updateTabWidthMode = (value: TabWidthMode) => updatePref("tabWidthMode", value);
  const updateTabFixedWidth = (value: number) => updatePref("tabFixedWidth", value);
  const updateTerminalWebglEnabled = (value: boolean) => updatePref("terminalWebglEnabled", value);
  const updateTerminalContextMenuEnabled = (value: boolean) =>
    updatePref("terminalContextMenuEnabled", value);
  const updateTerminalFontFamily = (value: string) => updatePref("terminalFontFamily", value);
  const updateTerminalFontWeight = (value: number) =>
    updatePref("terminalFontWeight", value as Preferences["terminalFontWeight"]);
  const updateTerminalFontWeightBold = (value: number) =>
    updatePref("terminalFontWeightBold", value as Preferences["terminalFontWeightBold"]);
  const updateTerminalNerdFontEnabled = (value: boolean) => updatePref("terminalNerdFontEnabled", value);
  const updateTerminalCjkFontEnabled = (value: boolean) => updatePref("terminalCjkFontEnabled", value);
  const updateTerminalEmojiFontEnabled = (value: boolean) => updatePref("terminalEmojiFontEnabled", value);
  const updateTerminalCursorStyle = (value: Preferences["terminalCursorStyle"]) =>
    updatePref("terminalCursorStyle", value);
  const updateTerminalCursorBlink = (value: boolean) => updatePref("terminalCursorBlink", value);
  const updateTerminalCursorInactiveStyle = (value: Preferences["terminalCursorInactiveStyle"]) =>
    updatePref("terminalCursorInactiveStyle", value);
  const updateTerminalRenderer = (value: Preferences["terminalRenderer"]) =>
    updatePref("terminalRenderer", value);
  const updateTerminalRendererAutoFallback = (value: boolean) =>
    updatePref("terminalRendererAutoFallback", value);
  const updateTerminalLetterSpacing = (value: number) => updatePref("terminalLetterSpacing", value);
  const updateTerminalFontSize = (value: number) => updatePref("terminalFontSize", value);
  const updateTerminalScrollback = (value: number) => updatePref("terminalScrollback", value);
  const updateTerminalFastScrollSensitivity = (value: number) =>
    updatePref("terminalFastScrollSensitivity", value);
  const updateTerminalFastScrollModifier = (value: Preferences["terminalFastScrollModifier"]) =>
    updatePref("terminalFastScrollModifier", value);
  const updateTerminalMacOptionIsMeta = (value: boolean) =>
    updatePref("terminalMacOptionIsMeta", value);
  const updateTerminalMacOptionClickForcesSelection = (value: boolean) =>
    updatePref("terminalMacOptionClickForcesSelection", value);
  const updateTerminalMinimumContrastRatio = (value: number) =>
    updatePref("terminalMinimumContrastRatio", value);
  const updateTerminalDrawBoldTextInBrightColors = (value: boolean) =>
    updatePref("terminalDrawBoldTextInBrightColors", value);
  const updateTerminalCustomGlyphs = (value: boolean) => updatePref("terminalCustomGlyphs", value);
  const updateTerminalRescaleOverlappingGlyphs = (value: boolean) =>
    updatePref("terminalRescaleOverlappingGlyphs", value);
  const updateTerminalNotificationEnabled = (value: boolean) =>
    updatePref("terminalNotificationEnabled", value);
  const updateTerminalNotificationSoundEnabled = (value: boolean) =>
    updatePref("terminalNotificationSoundEnabled", value);
  const updateSourceControlPanelWidth = (value: number) =>
    updatePref("sourceControlPanelWidth", value);
  const updateExplorerPanelWidth = (value: number) => updatePref("explorerPanelWidth", value);
  const updateTouchOptimizations = (value: Preferences["touchOptimizations"]) =>
    updatePref("touchOptimizations", value);
  const updateEditorFontSize = (value: number) => updatePref("editorFontSize", value);
  const updateEditorTabSize = (value: number) => updatePref("editorTabSize", value);
  const updateEditorWordWrap = (value: boolean) => updatePref("editorWordWrap", value);
  const updateLeftSidebar = (value: LeftSidebarPref) => updatePref("leftSidebar", value);
  const updatePanelVisibility = (value: PanelVisibilityPref) => updatePref("panelVisibility", value);

  async function updateCommandKeybinding(
    id: CommandId,
    keybinding: string | null | undefined,
  ): Promise<void> {
    const next: KeybindingOverrides = { ...stateRefs.keybindings.value };
    if (keybinding === undefined) delete next[id];
    else next[id] = keybinding;
    await updatePref("keybindings", next);
  }

  const RECENT_FILES_MAX = 50;

  async function recordOpenedFile(path: string): Promise<void> {
    if (!path) return;
    const next = [
      path,
      ...stateRefs.recentFiles.value.filter((p) => p !== path),
    ].slice(0, RECENT_FILES_MAX);
    await updatePref("recentFiles", next);
  }

  function clearRecentFiles(): void {
    void updatePref("recentFiles", []);
  }

  return {
    ...stateRefs,
    hydrated,
    listening,
    hydrate,
    updatePref,
    updateTheme,
    updateLanguage,
    updateAccent,
    updateEditorTheme,
    updateAutostart,
    updateAutoCheckUpdates,
    updateRestoreWindowState,
    updateVimMode,
    updateEditorLspTypescriptMode,
    updateFileOpenMode,
    updateShowHidden,
    updateTabWidthMode,
    updateTabFixedWidth,
    updateTerminalWebglEnabled,
    updateTerminalContextMenuEnabled,
    updateTerminalFontFamily,
    updateTerminalFontWeight,
    updateTerminalFontWeightBold,
    updateTerminalNerdFontEnabled,
    updateTerminalCjkFontEnabled,
    updateTerminalEmojiFontEnabled,
    updateTerminalCursorStyle,
    updateTerminalCursorBlink,
    updateTerminalCursorInactiveStyle,
    updateTerminalRenderer,
    updateTerminalRendererAutoFallback,
    updateTerminalLetterSpacing,
    updateTerminalFontSize,
    updateTerminalScrollback,
    updateTerminalFastScrollSensitivity,
    updateTerminalFastScrollModifier,
    updateTerminalMacOptionIsMeta,
    updateTerminalMacOptionClickForcesSelection,
    updateTerminalMinimumContrastRatio,
    updateTerminalDrawBoldTextInBrightColors,
    updateTerminalCustomGlyphs,
    updateTerminalRescaleOverlappingGlyphs,
    updateTerminalNotificationEnabled,
    updateTerminalNotificationSoundEnabled,
    updateSourceControlPanelWidth,
    updateExplorerPanelWidth,
    updateTouchOptimizations,
    updateEditorFontSize,
    updateEditorTabSize,
    updateEditorWordWrap,
    updateLeftSidebar,
    updatePanelVisibility,
    updateCommandKeybinding,
    recordOpenedFile,
    clearRecentFiles,
  };
});
