import { defineStore } from "pinia";
import { ref } from "vue";
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  onPreferencesChange,
  setAutostart,
  setEditorTheme,
  setExplorerPanelWidth,
  setEditorFontSize,
  setEditorTabSize,
  setEditorWordWrap,
  setFileOpenMode,
  setKeybindings,
  setLanguage,
  setRecentFiles,
  setRestoreWindowState,
  setShowHidden,
  setSourceControlPanelWidth,
  setTerminalContextMenuEnabled,
  setTerminalFontFamily,
  setTerminalFontSize,
  setTerminalLetterSpacing,
  setTerminalScrollback,
  setTerminalWebglEnabled,
  setTerminalNotificationEnabled,
  setTerminalNotificationSoundEnabled,
  setTheme,
  setTouchOptimizations,
  setVimMode,
  type EditorThemeId,
  type FileOpenMode,
  type LanguagePref,
  type Preferences,
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
  const editorTheme = ref<EditorThemeId>(DEFAULT_PREFERENCES.editorTheme);
  const autostart = ref<boolean>(DEFAULT_PREFERENCES.autostart);
  const restoreWindowState = ref<boolean>(
    DEFAULT_PREFERENCES.restoreWindowState,
  );
  const vimMode = ref<boolean>(DEFAULT_PREFERENCES.vimMode);
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
  const terminalLetterSpacing = ref<number>(
    DEFAULT_PREFERENCES.terminalLetterSpacing,
  );
  const terminalFontSize = ref<number>(DEFAULT_PREFERENCES.terminalFontSize);
  const terminalScrollback = ref<number>(
    DEFAULT_PREFERENCES.terminalScrollback,
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

  const hydrated = ref(false);
  const listening = ref(false);

  function applySnapshot(snapshot: Preferences): void {
    theme.value = snapshot.theme;
    language.value = snapshot.language;
    editorTheme.value = snapshot.editorTheme;
    autostart.value = snapshot.autostart;
    restoreWindowState.value = snapshot.restoreWindowState;
    vimMode.value = snapshot.vimMode;
    fileOpenMode.value = snapshot.fileOpenMode;
    showHidden.value = snapshot.showHidden;
    terminalWebglEnabled.value = snapshot.terminalWebglEnabled;
    terminalContextMenuEnabled.value = snapshot.terminalContextMenuEnabled;
    terminalFontFamily.value = snapshot.terminalFontFamily;
    terminalLetterSpacing.value = snapshot.terminalLetterSpacing;
    terminalFontSize.value = snapshot.terminalFontSize;
    terminalScrollback.value = snapshot.terminalScrollback;
    terminalNotificationEnabled.value = snapshot.terminalNotificationEnabled;
    terminalNotificationSoundEnabled.value = snapshot.terminalNotificationSoundEnabled;
    keybindings.value = snapshot.keybindings;
    lastWslDistro.value = snapshot.lastWslDistro;
    lastWorkspace.value = snapshot.lastWorkspace;
    recentWorkspaces.value = snapshot.recentWorkspaces;
    recentFiles.value = snapshot.recentFiles;
    zoomLevel.value = snapshot.zoomLevel;
    sourceControlPanelWidth.value = snapshot.sourceControlPanelWidth;
    explorerPanelWidth.value = snapshot.explorerPanelWidth;
    touchOptimizations.value = snapshot.touchOptimizations;
    editorFontSize.value = snapshot.editorFontSize;
    editorTabSize.value = snapshot.editorTabSize;
    editorWordWrap.value = snapshot.editorWordWrap;
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

  async function updateFileOpenMode(value: FileOpenMode): Promise<void> {
    fileOpenMode.value = value;
    patchPreferencesSnapshot("fileOpenMode", value);
    await setFileOpenMode(value);
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

  function readPreferencesSnapshot(): Preferences {
    return {
      theme: theme.value,
      language: language.value,
      editorTheme: editorTheme.value,
      autostart: autostart.value,
      restoreWindowState: restoreWindowState.value,
      vimMode: vimMode.value,
      fileOpenMode: fileOpenMode.value,
      showHidden: showHidden.value,
      terminalWebglEnabled: terminalWebglEnabled.value,
      terminalContextMenuEnabled: terminalContextMenuEnabled.value,
      terminalFontFamily: terminalFontFamily.value,
      terminalLetterSpacing: terminalLetterSpacing.value,
      terminalFontSize: terminalFontSize.value,
      terminalScrollback: terminalScrollback.value,
      terminalNotificationEnabled: terminalNotificationEnabled.value,
      terminalNotificationSoundEnabled: terminalNotificationSoundEnabled.value,
      keybindings: keybindings.value,
      lastWslDistro: lastWslDistro.value,
      lastWorkspace: lastWorkspace.value,
      recentWorkspaces: recentWorkspaces.value,
    recentFiles: recentFiles.value,
      zoomLevel: zoomLevel.value,
      sourceControlPanelWidth: sourceControlPanelWidth.value,
      explorerPanelWidth: explorerPanelWidth.value,
      touchOptimizations: touchOptimizations.value,
      editorFontSize: editorFontSize.value,
      editorTabSize: editorTabSize.value,
      editorWordWrap: editorWordWrap.value,
    };
  }

  return {
    theme,
    language,
    editorTheme,
    autostart,
    restoreWindowState,
    vimMode,
    fileOpenMode,
    showHidden,
    terminalWebglEnabled,
    terminalContextMenuEnabled,
    terminalFontFamily,
    terminalLetterSpacing,
    terminalFontSize,
    terminalScrollback,
    terminalNotificationEnabled,
    terminalNotificationSoundEnabled,
    keybindings,
    lastWslDistro,
    lastWorkspace,
    recentWorkspaces,
    recentFiles,
    zoomLevel,
    sourceControlPanelWidth,
    explorerPanelWidth,
    touchOptimizations,
    editorFontSize,
    editorTabSize,
    editorWordWrap,
    hydrated,
    listening,
    hydrate,
    updateTheme,
    updateLanguage,
    updateEditorTheme,
    updateAutostart,
    updateRestoreWindowState,
    updateVimMode,
    updateFileOpenMode,
    updateShowHidden,
    updateTerminalWebglEnabled,
    updateTerminalContextMenuEnabled,
    updateTerminalFontFamily,
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
  };
});
