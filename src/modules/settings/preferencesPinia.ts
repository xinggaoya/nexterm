import { defineStore } from "pinia";
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  onPreferencesChange,
  setAutostart,
  setEditorTheme,
  setExplorerPanelWidth,
  setFileOpenMode,
  setRestoreWindowState,
  setShowHidden,
  setSourceControlPanelWidth,
  setTerminalFontFamily,
  setTerminalFontSize,
  setTerminalLetterSpacing,
  setTerminalScrollback,
  setTerminalWebglEnabled,
  setTheme,
  setVimMode,
  type EditorThemeId,
  type FileOpenMode,
  type Preferences,
  type ThemePref,
} from "./store";
import {
  patchPreferencesSnapshot,
  replacePreferencesSnapshot,
} from "./preferencesSnapshot";

type State = Preferences & {
  hydrated: boolean;
  listening: boolean;
};

function applyPatch<K extends keyof Preferences>(
  state: State,
  key: K,
  value: Preferences[K],
) {
  (state as unknown as Preferences)[key] = value;
}

export const usePreferencesPiniaStore = defineStore("preferences", {
  state: (): State => ({
    ...DEFAULT_PREFERENCES,
    hydrated: false,
    listening: false,
  }),
  actions: {
    async hydrate() {
      if (this.hydrated) return;
      const prefs = await loadPreferences();
      replacePreferencesSnapshot(prefs);
      this.$patch({ ...prefs, hydrated: true });
      if (this.listening) return;
      this.listening = true;
      void onPreferencesChange((key, value) => {
        patchPreferencesSnapshot(key, value as never);
        this.$patch((state) => {
          applyPatch(state, key, value as never);
        });
      });
    },
    async updateTheme(value: ThemePref) {
      this.theme = value;
      patchPreferencesSnapshot("theme", value);
      await setTheme(value);
    },
    async updateEditorTheme(value: EditorThemeId) {
      this.editorTheme = value;
      patchPreferencesSnapshot("editorTheme", value);
      await setEditorTheme(value);
    },
    async updateAutostart(value: boolean) {
      this.autostart = value;
      patchPreferencesSnapshot("autostart", value);
      await setAutostart(value);
    },
    async updateRestoreWindowState(value: boolean) {
      this.restoreWindowState = value;
      patchPreferencesSnapshot("restoreWindowState", value);
      await setRestoreWindowState(value);
    },
    async updateVimMode(value: boolean) {
      this.vimMode = value;
      patchPreferencesSnapshot("vimMode", value);
      await setVimMode(value);
    },
    async updateFileOpenMode(value: FileOpenMode) {
      this.fileOpenMode = value;
      patchPreferencesSnapshot("fileOpenMode", value);
      await setFileOpenMode(value);
    },
    async updateShowHidden(value: boolean) {
      this.showHidden = value;
      patchPreferencesSnapshot("showHidden", value);
      await setShowHidden(value);
    },
    async updateTerminalWebglEnabled(value: boolean) {
      this.terminalWebglEnabled = value;
      patchPreferencesSnapshot("terminalWebglEnabled", value);
      await setTerminalWebglEnabled(value);
    },
    async updateTerminalFontFamily(value: string) {
      this.terminalFontFamily = value;
      patchPreferencesSnapshot("terminalFontFamily", value);
      await setTerminalFontFamily(value);
    },
    async updateTerminalLetterSpacing(value: number) {
      this.terminalLetterSpacing = value;
      patchPreferencesSnapshot("terminalLetterSpacing", value);
      await setTerminalLetterSpacing(value);
    },
    async updateTerminalFontSize(value: number) {
      this.terminalFontSize = value;
      patchPreferencesSnapshot("terminalFontSize", value);
      await setTerminalFontSize(value);
    },
    async updateTerminalScrollback(value: number) {
      this.terminalScrollback = value;
      patchPreferencesSnapshot("terminalScrollback", value);
      await setTerminalScrollback(value);
    },
    async updateSourceControlPanelWidth(value: number) {
      this.sourceControlPanelWidth = value;
      patchPreferencesSnapshot("sourceControlPanelWidth", value);
      await setSourceControlPanelWidth(value);
    },
    async updateExplorerPanelWidth(value: number) {
      this.explorerPanelWidth = value;
      patchPreferencesSnapshot("explorerPanelWidth", value);
      await setExplorerPanelWidth(value);
    },
  },
});
