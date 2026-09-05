import { defineStore } from "pinia";
import { ref } from "vue";
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  onPreferencesChange,
  setAccent,
  setAutostart,
  setAutoCheckUpdates,
  setEditorTheme,
  setExplorerPanelWidth,
  setEditorFontSize,
  setEditorTabSize,
  setEditorLspTypescriptMode,
  setEditorWordWrap,
  setFileOpenMode,
  setKeybindings,
  setLanguage,
  setLayoutLeftSidebar,
  setLayoutPanels,
  setRecentFiles,
  setRestoreWindowState,
  setShowHidden,
  setSourceControlPanelWidth,
  setTabFixedWidth,
  setTabWidthMode,
  setTerminalContextMenuEnabled,
  setTerminalCjkFontEnabled,
  setTerminalCursorBlink,
  setTerminalCursorInactiveStyle,
  setTerminalCursorStyle,
  setTerminalCustomGlyphs,
  setTerminalDrawBoldTextInBrightColors,
  setTerminalEmojiFontEnabled,
  setTerminalFastScrollModifier,
  setTerminalFastScrollSensitivity,
  setTerminalFontFamily,
  setTerminalFontSize,
  setTerminalFontWeight,
  setTerminalFontWeightBold,
  setTerminalLetterSpacing,
  setTerminalMacOptionIsMeta,
  setTerminalMacOptionClickForcesSelection,
  setTerminalMinimumContrastRatio,
  setTerminalNerdFontEnabled,
  setTerminalOscHyperlink,
  setTerminalRenderer,
  setTerminalRendererAutoFallback,
  setTerminalRescaleOverlappingGlyphs,
  setTerminalScrollback,
  setTerminalWebglEnabled,
  setTerminalNotificationEnabled,
  setTerminalNotificationSoundEnabled,
  setTheme,
  setTouchOptimizations,
  setVimMode,
  clampTabFixedWidth,
  clampTerminalCursorInactiveStyle,
  clampTerminalCursorStyle,
  clampTerminalFastScrollModifier,
  clampTerminalFastScrollSensitivity,
  clampTerminalFontWeight,
  clampTerminalMinimumContrastRatio,
  clampTerminalRenderer,
  type AccentPref,
  type EditorLspTypescriptMode,
  type TabWidthMode,
  type EditorThemeId,
  type FileOpenMode,
  type LanguagePref,
  type LeftSidebarPref,
  type PanelVisibilityPref,
  type Preferences,
  type TerminalCursorInactiveStyle,
  type TerminalCursorStyle,
  type TerminalFastScrollModifier,
  type TerminalFontWeight,
  type TerminalRenderer,
  type ThemePref,
  type TouchMode,
} from "./store";
import type { CommandId, KeybindingOverrides } from "@/modules/commands/types";
import {
  patchPreferencesSnapshot,
  replacePreferencesSnapshot,
} from "./preferencesSnapshot";

export const usePreferencesPiniaStore = defineStore("preferences", () => {
  const theme = ref<ThemePref>(DEFAULT_PREFERENCES.theme);
  const language = ref<LanguagePref>(DEFAULT_PREFERENCES.language);
  const accent = ref<AccentPref>(DEFAULT_PREFERENCES.accent);
  const editorTheme = ref<EditorThemeId>(DEFAULT_PREFERENCES.editorTheme);
  const autostart = ref<boolean>(DEFAULT_PREFERENCES.autostart);
  const autoCheckUpdates = ref<boolean>(
    DEFAULT_PREFERENCES.autoCheckUpdates,
  );
  const restoreWindowState = ref<boolean>(
    DEFAULT_PREFERENCES.restoreWindowState,
  );
  const vimMode = ref<boolean>(DEFAULT_PREFERENCES.vimMode);
  const editorLspTypescriptMode = ref<EditorLspTypescriptMode>(
    DEFAULT_PREFERENCES.editorLspTypescriptMode,
  );
  const fileOpenMode = ref<FileOpenMode>(DEFAULT_PREFERENCES.fileOpenMode);
  const showHidden = ref<boolean>(DEFAULT_PREFERENCES.showHidden);
  const terminalWebglEnabled = ref<boolean>(
    DEFAULT_PREFERENCES.terminalWebglEnabled,
  );
  const terminalContextMenuEnabled = ref<boolean>(
    DEFAULT_PREFERENCES.terminalContextMenuEnabled,
  );
  const terminalFontFamily = ref<string>(
    DEFAULT_PREFERENCES.terminalFontFamily,
  );
  const terminalFontWeight = ref<TerminalFontWeight>(
    DEFAULT_PREFERENCES.terminalFontWeight,
  );
  const terminalFontWeightBold = ref<TerminalFontWeight>(
    DEFAULT_PREFERENCES.terminalFontWeightBold,
  );
  const terminalLetterSpacing = ref<number>(
    DEFAULT_PREFERENCES.terminalLetterSpacing,
  );
  const terminalFontSize = ref<number>(DEFAULT_PREFERENCES.terminalFontSize);
  const terminalNerdFontEnabled = ref<boolean>(
    DEFAULT_PREFERENCES.terminalNerdFontEnabled,
  );
  const terminalCjkFontEnabled = ref<boolean>(
    DEFAULT_PREFERENCES.terminalCjkFontEnabled,
  );
  const terminalEmojiFontEnabled = ref<boolean>(
    DEFAULT_PREFERENCES.terminalEmojiFontEnabled,
  );
  const terminalCursorStyle = ref<TerminalCursorStyle>(
    DEFAULT_PREFERENCES.terminalCursorStyle,
  );
  const terminalCursorBlink = ref<boolean>(
    DEFAULT_PREFERENCES.terminalCursorBlink,
  );
  const terminalCursorInactiveStyle = ref<TerminalCursorInactiveStyle>(
    DEFAULT_PREFERENCES.terminalCursorInactiveStyle,
  );
  const terminalRenderer = ref<TerminalRenderer>(
    DEFAULT_PREFERENCES.terminalRenderer,
  );
  const terminalRendererAutoFallback = ref<boolean>(
    DEFAULT_PREFERENCES.terminalRendererAutoFallback,
  );
  const terminalScrollback = ref<number>(
    DEFAULT_PREFERENCES.terminalScrollback,
  );
  const terminalFastScrollSensitivity = ref<number>(
    DEFAULT_PREFERENCES.terminalFastScrollSensitivity,
  );
  const terminalFastScrollModifier = ref<TerminalFastScrollModifier>(
    DEFAULT_PREFERENCES.terminalFastScrollModifier,
  );
  const terminalMacOptionIsMeta = ref<boolean>(
    DEFAULT_PREFERENCES.terminalMacOptionIsMeta,
  );
  const terminalMacOptionClickForcesSelection = ref<boolean>(
    DEFAULT_PREFERENCES.terminalMacOptionClickForcesSelection,
  );
  const terminalMinimumContrastRatio = ref<number>(
    DEFAULT_PREFERENCES.terminalMinimumContrastRatio,
  );
  const terminalDrawBoldTextInBrightColors = ref<boolean>(
    DEFAULT_PREFERENCES.terminalDrawBoldTextInBrightColors,
  );
  const terminalCustomGlyphs = ref<boolean>(
    DEFAULT_PREFERENCES.terminalCustomGlyphs,
  );
  const terminalRescaleOverlappingGlyphs = ref<boolean>(
    DEFAULT_PREFERENCES.terminalRescaleOverlappingGlyphs,
  );
  const terminalOscHyperlink = ref<boolean>(
    DEFAULT_PREFERENCES.terminalOscHyperlink,
  );
  const terminalNotificationEnabled = ref<boolean>(
    DEFAULT_PREFERENCES.terminalNotificationEnabled,
  );
  const terminalNotificationSoundEnabled = ref<boolean>(
    DEFAULT_PREFERENCES.terminalNotificationSoundEnabled,
  );
  const keybindings = ref<KeybindingOverrides>(
    DEFAULT_PREFERENCES.keybindings,
  );
  const lastWslDistro = ref<string | null>(DEFAULT_PREFERENCES.lastWslDistro);
  const lastWorkspace = ref<Preferences["lastWorkspace"]>(
    DEFAULT_PREFERENCES.lastWorkspace,
  );
  const recentWorkspaces = ref<Preferences["recentWorkspaces"]>(
    DEFAULT_PREFERENCES.recentWorkspaces,
  );
  const openWorkspaces = ref<Preferences["openWorkspaces"]>(
    DEFAULT_PREFERENCES.openWorkspaces,
  );
  const activeWorkspaceId = ref<Preferences["activeWorkspaceId"]>(
    DEFAULT_PREFERENCES.activeWorkspaceId,
  );
  const recentFiles = ref<Preferences["recentFiles"]>(
    DEFAULT_PREFERENCES.recentFiles,
  );
  const zoomLevel = ref<number>(DEFAULT_PREFERENCES.zoomLevel);
  const sourceControlPanelWidth = ref<number>(
    DEFAULT_PREFERENCES.sourceControlPanelWidth,
  );
  const explorerPanelWidth = ref<number>(
    DEFAULT_PREFERENCES.explorerPanelWidth,
  );
  const editorFontSize = ref<number>(DEFAULT_PREFERENCES.editorFontSize);
  const editorTabSize = ref<number>(DEFAULT_PREFERENCES.editorTabSize);
  const editorWordWrap = ref<boolean>(DEFAULT_PREFERENCES.editorWordWrap);
  const touchOptimizations = ref<TouchMode>(
    DEFAULT_PREFERENCES.touchOptimizations,
  );
  const leftSidebar = ref<Preferences["leftSidebar"]>(
    DEFAULT_PREFERENCES.leftSidebar,
  );
  const panelVisibility = ref<Preferences["panelVisibility"]>(
    DEFAULT_PREFERENCES.panelVisibility,
  );
  const tabWidthMode = ref<TabWidthMode>(DEFAULT_PREFERENCES.tabWidthMode);
  const tabFixedWidth = ref<number>(
    clampTabFixedWidth(DEFAULT_PREFERENCES.tabFixedWidth),
  );

  const hydrated = ref(false);
  const listening = ref(false);

  function applySnapshot(snapshot: Preferences): void {
    theme.value = snapshot.theme;
    language.value = snapshot.language;
    accent.value = snapshot.accent;
    editorTheme.value = snapshot.editorTheme;
    autostart.value = snapshot.autostart;
    autoCheckUpdates.value = snapshot.autoCheckUpdates;
    restoreWindowState.value = snapshot.restoreWindowState;
    vimMode.value = snapshot.vimMode;
    editorLspTypescriptMode.value = snapshot.editorLspTypescriptMode;
    fileOpenMode.value = snapshot.fileOpenMode;
    showHidden.value = snapshot.showHidden;
    terminalWebglEnabled.value = snapshot.terminalWebglEnabled;
    terminalContextMenuEnabled.value = snapshot.terminalContextMenuEnabled;
    terminalFontFamily.value = snapshot.terminalFontFamily;
    terminalFontWeight.value = snapshot.terminalFontWeight;
    terminalFontWeightBold.value = snapshot.terminalFontWeightBold;
    terminalLetterSpacing.value = snapshot.terminalLetterSpacing;
    terminalFontSize.value = snapshot.terminalFontSize;
    terminalNerdFontEnabled.value = snapshot.terminalNerdFontEnabled;
    terminalCjkFontEnabled.value = snapshot.terminalCjkFontEnabled;
    terminalEmojiFontEnabled.value = snapshot.terminalEmojiFontEnabled;
    terminalCursorStyle.value = snapshot.terminalCursorStyle;
    terminalCursorBlink.value = snapshot.terminalCursorBlink;
    terminalCursorInactiveStyle.value = snapshot.terminalCursorInactiveStyle;
    terminalRenderer.value = snapshot.terminalRenderer;
    terminalRendererAutoFallback.value = snapshot.terminalRendererAutoFallback;
    terminalScrollback.value = snapshot.terminalScrollback;
    terminalFastScrollSensitivity.value = snapshot.terminalFastScrollSensitivity;
    terminalFastScrollModifier.value = snapshot.terminalFastScrollModifier;
    terminalMacOptionIsMeta.value = snapshot.terminalMacOptionIsMeta;
    terminalMacOptionClickForcesSelection.value =
      snapshot.terminalMacOptionClickForcesSelection;
    terminalMinimumContrastRatio.value = snapshot.terminalMinimumContrastRatio;
    terminalDrawBoldTextInBrightColors.value =
      snapshot.terminalDrawBoldTextInBrightColors;
    terminalCustomGlyphs.value = snapshot.terminalCustomGlyphs;
    terminalRescaleOverlappingGlyphs.value =
      snapshot.terminalRescaleOverlappingGlyphs;
    terminalOscHyperlink.value = snapshot.terminalOscHyperlink;
    terminalNotificationEnabled.value = snapshot.terminalNotificationEnabled;
    terminalNotificationSoundEnabled.value = snapshot.terminalNotificationSoundEnabled;
    keybindings.value = snapshot.keybindings;
    lastWslDistro.value = snapshot.lastWslDistro;
    lastWorkspace.value = snapshot.lastWorkspace;
    recentWorkspaces.value = snapshot.recentWorkspaces;
    openWorkspaces.value = snapshot.openWorkspaces;
    activeWorkspaceId.value = snapshot.activeWorkspaceId;
    recentFiles.value = snapshot.recentFiles;
    zoomLevel.value = snapshot.zoomLevel;
    sourceControlPanelWidth.value = snapshot.sourceControlPanelWidth;
    explorerPanelWidth.value = snapshot.explorerPanelWidth;
    touchOptimizations.value = snapshot.touchOptimizations;
    editorFontSize.value = snapshot.editorFontSize;
    editorTabSize.value = snapshot.editorTabSize;
    editorWordWrap.value = snapshot.editorWordWrap;
    leftSidebar.value = snapshot.leftSidebar;
    panelVisibility.value = snapshot.panelVisibility;
    tabWidthMode.value = snapshot.tabWidthMode;
    tabFixedWidth.value = clampTabFixedWidth(snapshot.tabFixedWidth);
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
      patchPreferencesSnapshot(key, value as never);
      const partial = { [key]: value } as Partial<Preferences>;
      applySnapshot({ ...(readPreferencesSnapshot()), ...partial });
    });
  }

  async function updateTheme(value: ThemePref): Promise<void> {
    theme.value = value;
    patchPreferencesSnapshot("theme", value);
    await setTheme(value);
  }

  async function updateLanguage(value: LanguagePref): Promise<void> {
    language.value = value;
    patchPreferencesSnapshot("language", value);
    await setLanguage(value);
  }

  async function updateAccent(value: AccentPref): Promise<void> {
    accent.value = value;
    patchPreferencesSnapshot("accent", value);
    await setAccent(value);
  }

  async function updateEditorTheme(value: EditorThemeId): Promise<void> {
    editorTheme.value = value;
    patchPreferencesSnapshot("editorTheme", value);
    await setEditorTheme(value);
  }

  async function updateAutostart(value: boolean): Promise<void> {
    autostart.value = value;
    patchPreferencesSnapshot("autostart", value);
    await setAutostart(value);
  }

  async function updateAutoCheckUpdates(value: boolean): Promise<void> {
    autoCheckUpdates.value = value;
    patchPreferencesSnapshot("autoCheckUpdates", value);
    await setAutoCheckUpdates(value);
  }

  async function updateRestoreWindowState(value: boolean): Promise<void> {
    restoreWindowState.value = value;
    patchPreferencesSnapshot("restoreWindowState", value);
    await setRestoreWindowState(value);
  }

  async function updateVimMode(value: boolean): Promise<void> {
    vimMode.value = value;
    patchPreferencesSnapshot("vimMode", value);
    await setVimMode(value);
  }

  async function updateEditorLspTypescriptMode(
    value: EditorLspTypescriptMode,
  ): Promise<void> {
    editorLspTypescriptMode.value = value;
    patchPreferencesSnapshot("editorLspTypescriptMode", value);
    await setEditorLspTypescriptMode(value);
  }

  async function updateFileOpenMode(value: FileOpenMode): Promise<void> {
    fileOpenMode.value = value;
    patchPreferencesSnapshot("fileOpenMode", value);
    await setFileOpenMode(value);
  }

  async function updateTabWidthMode(value: TabWidthMode): Promise<void> {
    tabWidthMode.value = value;
    patchPreferencesSnapshot("tabWidthMode", value);
    await setTabWidthMode(value);
  }

  async function updateTabFixedWidth(value: number): Promise<void> {
    const clamped = clampTabFixedWidth(value);
    tabFixedWidth.value = clamped;
    patchPreferencesSnapshot("tabFixedWidth", clamped);
    await setTabFixedWidth(value);
  }

  async function updateShowHidden(value: boolean): Promise<void> {
    showHidden.value = value;
    patchPreferencesSnapshot("showHidden", value);
    await setShowHidden(value);
  }

  async function updateTerminalWebglEnabled(value: boolean): Promise<void> {
    terminalWebglEnabled.value = value;
    patchPreferencesSnapshot("terminalWebglEnabled", value);
    await setTerminalWebglEnabled(value);
  }

  async function updateTerminalContextMenuEnabled(
    value: boolean,
  ): Promise<void> {
    terminalContextMenuEnabled.value = value;
    patchPreferencesSnapshot("terminalContextMenuEnabled", value);
    await setTerminalContextMenuEnabled(value);
  }

  async function updateTerminalFontFamily(value: string): Promise<void> {
    terminalFontFamily.value = value;
    patchPreferencesSnapshot("terminalFontFamily", value);
    await setTerminalFontFamily(value);
  }

  async function updateTerminalFontWeight(value: number): Promise<void> {
    const clamped = clampTerminalFontWeight(value);
    terminalFontWeight.value = clamped;
    patchPreferencesSnapshot("terminalFontWeight", clamped);
    await setTerminalFontWeight(value);
  }

  async function updateTerminalFontWeightBold(value: number): Promise<void> {
    const clamped = clampTerminalFontWeight(value);
    terminalFontWeightBold.value = clamped;
    patchPreferencesSnapshot("terminalFontWeightBold", clamped);
    await setTerminalFontWeightBold(value);
  }

  async function updateTerminalNerdFontEnabled(value: boolean): Promise<void> {
    terminalNerdFontEnabled.value = value;
    patchPreferencesSnapshot("terminalNerdFontEnabled", value);
    await setTerminalNerdFontEnabled(value);
  }

  async function updateTerminalCjkFontEnabled(value: boolean): Promise<void> {
    terminalCjkFontEnabled.value = value;
    patchPreferencesSnapshot("terminalCjkFontEnabled", value);
    await setTerminalCjkFontEnabled(value);
  }

  async function updateTerminalEmojiFontEnabled(
    value: boolean,
  ): Promise<void> {
    terminalEmojiFontEnabled.value = value;
    patchPreferencesSnapshot("terminalEmojiFontEnabled", value);
    await setTerminalEmojiFontEnabled(value);
  }

  async function updateTerminalCursorStyle(
    value: TerminalCursorStyle,
  ): Promise<void> {
    const clamped = clampTerminalCursorStyle(value);
    terminalCursorStyle.value = clamped;
    patchPreferencesSnapshot("terminalCursorStyle", clamped);
    await setTerminalCursorStyle(value);
  }

  async function updateTerminalCursorBlink(value: boolean): Promise<void> {
    terminalCursorBlink.value = value;
    patchPreferencesSnapshot("terminalCursorBlink", value);
    await setTerminalCursorBlink(value);
  }

  async function updateTerminalCursorInactiveStyle(
    value: TerminalCursorInactiveStyle,
  ): Promise<void> {
    const clamped = clampTerminalCursorInactiveStyle(value);
    terminalCursorInactiveStyle.value = clamped;
    patchPreferencesSnapshot("terminalCursorInactiveStyle", clamped);
    await setTerminalCursorInactiveStyle(value);
  }

  async function updateTerminalRenderer(
    value: TerminalRenderer,
  ): Promise<void> {
    const clamped = clampTerminalRenderer(value);
    terminalRenderer.value = clamped;
    patchPreferencesSnapshot("terminalRenderer", clamped);
    await setTerminalRenderer(value);
  }

  async function updateTerminalRendererAutoFallback(
    value: boolean,
  ): Promise<void> {
    terminalRendererAutoFallback.value = value;
    patchPreferencesSnapshot("terminalRendererAutoFallback", value);
    await setTerminalRendererAutoFallback(value);
  }

  async function updateTerminalFastScrollSensitivity(
    value: number,
  ): Promise<void> {
    const clamped = clampTerminalFastScrollSensitivity(value);
    terminalFastScrollSensitivity.value = clamped;
    patchPreferencesSnapshot("terminalFastScrollSensitivity", clamped);
    await setTerminalFastScrollSensitivity(value);
  }

  async function updateTerminalFastScrollModifier(
    value: TerminalFastScrollModifier,
  ): Promise<void> {
    const clamped = clampTerminalFastScrollModifier(value);
    terminalFastScrollModifier.value = clamped;
    patchPreferencesSnapshot("terminalFastScrollModifier", clamped);
    await setTerminalFastScrollModifier(value);
  }

  async function updateTerminalMacOptionIsMeta(value: boolean): Promise<void> {
    terminalMacOptionIsMeta.value = value;
    patchPreferencesSnapshot("terminalMacOptionIsMeta", value);
    await setTerminalMacOptionIsMeta(value);
  }

  async function updateTerminalMacOptionClickForcesSelection(
    value: boolean,
  ): Promise<void> {
    terminalMacOptionClickForcesSelection.value = value;
    patchPreferencesSnapshot("terminalMacOptionClickForcesSelection", value);
    await setTerminalMacOptionClickForcesSelection(value);
  }

  async function updateTerminalMinimumContrastRatio(
    value: number,
  ): Promise<void> {
    const clamped = clampTerminalMinimumContrastRatio(value);
    terminalMinimumContrastRatio.value = clamped;
    patchPreferencesSnapshot("terminalMinimumContrastRatio", clamped);
    await setTerminalMinimumContrastRatio(value);
  }

  async function updateTerminalDrawBoldTextInBrightColors(
    value: boolean,
  ): Promise<void> {
    terminalDrawBoldTextInBrightColors.value = value;
    patchPreferencesSnapshot("terminalDrawBoldTextInBrightColors", value);
    await setTerminalDrawBoldTextInBrightColors(value);
  }

  async function updateTerminalCustomGlyphs(value: boolean): Promise<void> {
    terminalCustomGlyphs.value = value;
    patchPreferencesSnapshot("terminalCustomGlyphs", value);
    await setTerminalCustomGlyphs(value);
  }

  async function updateTerminalRescaleOverlappingGlyphs(
    value: boolean,
  ): Promise<void> {
    terminalRescaleOverlappingGlyphs.value = value;
    patchPreferencesSnapshot("terminalRescaleOverlappingGlyphs", value);
    await setTerminalRescaleOverlappingGlyphs(value);
  }

  async function updateTerminalOscHyperlink(value: boolean): Promise<void> {
    terminalOscHyperlink.value = value;
    patchPreferencesSnapshot("terminalOscHyperlink", value);
    await setTerminalOscHyperlink(value);
  }

  async function updateTerminalLetterSpacing(value: number): Promise<void> {
    terminalLetterSpacing.value = value;
    patchPreferencesSnapshot("terminalLetterSpacing", value);
    await setTerminalLetterSpacing(value);
  }

  async function updateTerminalFontSize(value: number): Promise<void> {
    terminalFontSize.value = value;
    patchPreferencesSnapshot("terminalFontSize", value);
    await setTerminalFontSize(value);
  }

  async function updateTerminalScrollback(value: number): Promise<void> {
    terminalScrollback.value = value;
    patchPreferencesSnapshot("terminalScrollback", value);
    await setTerminalScrollback(value);
  }

  async function updateTerminalNotificationEnabled(value: boolean): Promise<void> {
    terminalNotificationEnabled.value = value;
    patchPreferencesSnapshot("terminalNotificationEnabled", value);
    await setTerminalNotificationEnabled(value);
  }

  async function updateTerminalNotificationSoundEnabled(value: boolean): Promise<void> {
    terminalNotificationSoundEnabled.value = value;
    patchPreferencesSnapshot("terminalNotificationSoundEnabled", value);
    await setTerminalNotificationSoundEnabled(value);
  }

  async function updateCommandKeybinding(
    id: CommandId,
    keybinding: string | null | undefined,
  ): Promise<void> {
    const next = { ...keybindings.value };
    if (keybinding === undefined) delete next[id];
    else next[id] = keybinding;
    keybindings.value = next;
    patchPreferencesSnapshot("keybindings", next);
    await setKeybindings(next);
  }

  async function updateSourceControlPanelWidth(value: number): Promise<void> {
    sourceControlPanelWidth.value = value;
    patchPreferencesSnapshot("sourceControlPanelWidth", value);
    await setSourceControlPanelWidth(value);
  }

  async function updateExplorerPanelWidth(value: number): Promise<void> {
    explorerPanelWidth.value = value;
    patchPreferencesSnapshot("explorerPanelWidth", value);
    await setExplorerPanelWidth(value);
  }

  async function updateTouchOptimizations(value: TouchMode): Promise<void> {
    touchOptimizations.value = value;
    patchPreferencesSnapshot("touchOptimizations", value);
    await setTouchOptimizations(value);
  }

  async function updateEditorFontSize(value: number): Promise<void> {
    editorFontSize.value = value;
    patchPreferencesSnapshot("editorFontSize", value);
    await setEditorFontSize(value);
  }

  async function updateEditorTabSize(value: number): Promise<void> {
    editorTabSize.value = value;
    patchPreferencesSnapshot("editorTabSize", value);
    await setEditorTabSize(value);
  }

  async function updateEditorWordWrap(value: boolean): Promise<void> {
    editorWordWrap.value = value;
    patchPreferencesSnapshot("editorWordWrap", value);
    await setEditorWordWrap(value);
  }

  const RECENT_FILES_MAX = 50;

  async function recordOpenedFile(path: string): Promise<void> {
    if (!path) return;
    const next = [path, ...recentFiles.value.filter((p) => p !== path)].slice(
      0,
      RECENT_FILES_MAX,
    );
    recentFiles.value = next;
    patchPreferencesSnapshot("recentFiles", next);
    await setRecentFiles(next);
  }

  function clearRecentFiles(): void {
    recentFiles.value = [];
    void setRecentFiles([]);
  }

  async function updateLeftSidebar(value: LeftSidebarPref): Promise<void> {
    leftSidebar.value = value;
    patchPreferencesSnapshot("leftSidebar", value);
    await setLayoutLeftSidebar(value);
  }

  async function updatePanelVisibility(
    next: PanelVisibilityPref,
  ): Promise<void> {
    panelVisibility.value = next;
    patchPreferencesSnapshot("panelVisibility", next);
    await setLayoutPanels(next);
  }

  function readPreferencesSnapshot(): Preferences {
    return {
      theme: theme.value,
      language: language.value,
      accent: accent.value,
      editorTheme: editorTheme.value,
      autostart: autostart.value,
      autoCheckUpdates: autoCheckUpdates.value,
      restoreWindowState: restoreWindowState.value,
      vimMode: vimMode.value,
      editorLspTypescriptMode: editorLspTypescriptMode.value,
      fileOpenMode: fileOpenMode.value,
      showHidden: showHidden.value,
      terminalWebglEnabled: terminalWebglEnabled.value,
      terminalContextMenuEnabled: terminalContextMenuEnabled.value,
      terminalFontFamily: terminalFontFamily.value,
      terminalFontWeight: terminalFontWeight.value,
      terminalFontWeightBold: terminalFontWeightBold.value,
      terminalLetterSpacing: terminalLetterSpacing.value,
      terminalFontSize: terminalFontSize.value,
      terminalNerdFontEnabled: terminalNerdFontEnabled.value,
      terminalCjkFontEnabled: terminalCjkFontEnabled.value,
      terminalEmojiFontEnabled: terminalEmojiFontEnabled.value,
      terminalCursorStyle: terminalCursorStyle.value,
      terminalCursorBlink: terminalCursorBlink.value,
      terminalCursorInactiveStyle: terminalCursorInactiveStyle.value,
      terminalRenderer: terminalRenderer.value,
      terminalRendererAutoFallback: terminalRendererAutoFallback.value,
      terminalScrollback: terminalScrollback.value,
      terminalFastScrollSensitivity: terminalFastScrollSensitivity.value,
      terminalFastScrollModifier: terminalFastScrollModifier.value,
      terminalMacOptionIsMeta: terminalMacOptionIsMeta.value,
      terminalMacOptionClickForcesSelection:
        terminalMacOptionClickForcesSelection.value,
      terminalMinimumContrastRatio: terminalMinimumContrastRatio.value,
      terminalDrawBoldTextInBrightColors: terminalDrawBoldTextInBrightColors.value,
      terminalCustomGlyphs: terminalCustomGlyphs.value,
      terminalRescaleOverlappingGlyphs: terminalRescaleOverlappingGlyphs.value,
      terminalOscHyperlink: terminalOscHyperlink.value,
      terminalNotificationEnabled: terminalNotificationEnabled.value,
      terminalNotificationSoundEnabled: terminalNotificationSoundEnabled.value,
      keybindings: keybindings.value,
      lastWslDistro: lastWslDistro.value,
      lastWorkspace: lastWorkspace.value,
      recentWorkspaces: recentWorkspaces.value,
      openWorkspaces: openWorkspaces.value,
      activeWorkspaceId: activeWorkspaceId.value,
      recentFiles: recentFiles.value,
      zoomLevel: zoomLevel.value,
      sourceControlPanelWidth: sourceControlPanelWidth.value,
      explorerPanelWidth: explorerPanelWidth.value,
      touchOptimizations: touchOptimizations.value,
      editorFontSize: editorFontSize.value,
      editorTabSize: editorTabSize.value,
      editorWordWrap: editorWordWrap.value,
      leftSidebar: leftSidebar.value,
      panelVisibility: panelVisibility.value,
      tabWidthMode: tabWidthMode.value,
      tabFixedWidth: tabFixedWidth.value,
    };
  }

  return {
    theme,
    language,
    accent,
    editorTheme,
    autostart,
    autoCheckUpdates,
    restoreWindowState,
    vimMode,
    editorLspTypescriptMode,
    fileOpenMode,
    showHidden,
    terminalWebglEnabled,
    terminalContextMenuEnabled,
    terminalFontFamily,
    terminalFontWeight,
    terminalFontWeightBold,
    terminalLetterSpacing,
    terminalFontSize,
    terminalNerdFontEnabled,
    terminalCjkFontEnabled,
    terminalEmojiFontEnabled,
    terminalCursorStyle,
    terminalCursorBlink,
    terminalCursorInactiveStyle,
    terminalRenderer,
    terminalRendererAutoFallback,
    terminalScrollback,
    terminalFastScrollSensitivity,
    terminalFastScrollModifier,
    terminalMacOptionIsMeta,
    terminalMacOptionClickForcesSelection,
    terminalMinimumContrastRatio,
    terminalDrawBoldTextInBrightColors,
    terminalCustomGlyphs,
    terminalRescaleOverlappingGlyphs,
    terminalOscHyperlink,
    terminalNotificationEnabled,
    terminalNotificationSoundEnabled,
    keybindings,
    lastWslDistro,
    lastWorkspace,
    recentWorkspaces,
    openWorkspaces,
    activeWorkspaceId,
    recentFiles,
    zoomLevel,
    sourceControlPanelWidth,
    explorerPanelWidth,
    touchOptimizations,
    editorFontSize,
    editorTabSize,
    editorWordWrap,
    leftSidebar,
    panelVisibility,
    tabWidthMode,
    tabFixedWidth,
    updateEditorLspTypescriptMode,
    updateTabWidthMode,
    updateTabFixedWidth,
    hydrated,
    listening,
    hydrate,
    updateTheme,
    updateLanguage,
    updateAccent,
    updateEditorTheme,
    updateAutostart,
    updateAutoCheckUpdates,
    updateRestoreWindowState,
    updateVimMode,
    updateFileOpenMode,
    updateShowHidden,
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
    updateTerminalFastScrollSensitivity,
    updateTerminalFastScrollModifier,
    updateTerminalMacOptionIsMeta,
    updateTerminalMacOptionClickForcesSelection,
    updateTerminalMinimumContrastRatio,
    updateTerminalDrawBoldTextInBrightColors,
    updateTerminalCustomGlyphs,
    updateTerminalRescaleOverlappingGlyphs,
    updateTerminalOscHyperlink,
    updateTerminalLetterSpacing,
    updateTerminalFontSize,
    updateTerminalScrollback,
    updateTerminalNotificationEnabled,
    updateTerminalNotificationSoundEnabled,
    updateCommandKeybinding,
    updateSourceControlPanelWidth,
    updateExplorerPanelWidth,
    updateTouchOptimizations,
    updateEditorFontSize,
    updateEditorTabSize,
    updateEditorWordWrap,
    recordOpenedFile,
    clearRecentFiles,
    updateLeftSidebar,
    updatePanelVisibility,
  };
});
