import { defineStore } from "pinia";
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  onPreferencesChange,
  setAutocompleteEnabled,
  setAutocompleteModelId,
  setAutocompleteProvider,
  setAutostart,
  setCustomInstructions,
  setDefaultModel,
  setEditorTheme,
  setLmstudioBaseURL,
  setLmstudioModelId,
  setMlxBaseURL,
  setMlxModelId,
  setOllamaBaseURL,
  setOllamaModelId,
  setOpenaiCompatibleBaseURL,
  setOpenaiCompatibleContextLimit,
  setOpenaiCompatibleModelId,
  setRestoreWindowState,
  setShowHidden,
  setTerminalFontFamily,
  setTerminalFontSize,
  setTerminalLetterSpacing,
  setTerminalScrollback,
  setTerminalWebglEnabled,
  setTheme,
  setVimMode,
  type EditorThemeId,
  type Preferences,
  type ThemePref,
} from "./store";
import type {
  AutocompleteProviderId,
  ModelId,
} from "@/modules/ai/config";
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
    async updateDefaultModel(value: ModelId) {
      this.defaultModelId = value;
      patchPreferencesSnapshot("defaultModelId", value);
      await setDefaultModel(value);
    },
    async updateEditorTheme(value: EditorThemeId) {
      this.editorTheme = value;
      patchPreferencesSnapshot("editorTheme", value);
      await setEditorTheme(value);
    },
    async updateCustomInstructions(value: string) {
      this.customInstructions = value;
      patchPreferencesSnapshot("customInstructions", value);
      await setCustomInstructions(value);
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
    async updateAutocompleteEnabled(value: boolean) {
      this.autocompleteEnabled = value;
      patchPreferencesSnapshot("autocompleteEnabled", value);
      await setAutocompleteEnabled(value);
    },
    async updateAutocompleteProvider(value: AutocompleteProviderId) {
      this.autocompleteProvider = value;
      patchPreferencesSnapshot("autocompleteProvider", value);
      await setAutocompleteProvider(value);
    },
    async updateAutocompleteModelId(value: string) {
      this.autocompleteModelId = value;
      patchPreferencesSnapshot("autocompleteModelId", value);
      await setAutocompleteModelId(value);
    },
    async updateLmstudioBaseURL(value: string) {
      this.lmstudioBaseURL = value;
      patchPreferencesSnapshot("lmstudioBaseURL", value);
      await setLmstudioBaseURL(value);
    },
    async updateLmstudioModelId(value: string) {
      this.lmstudioModelId = value;
      patchPreferencesSnapshot("lmstudioModelId", value);
      await setLmstudioModelId(value);
    },
    async updateMlxBaseURL(value: string) {
      this.mlxBaseURL = value;
      patchPreferencesSnapshot("mlxBaseURL", value);
      await setMlxBaseURL(value);
    },
    async updateMlxModelId(value: string) {
      this.mlxModelId = value;
      patchPreferencesSnapshot("mlxModelId", value);
      await setMlxModelId(value);
    },
    async updateOllamaBaseURL(value: string) {
      this.ollamaBaseURL = value;
      patchPreferencesSnapshot("ollamaBaseURL", value);
      await setOllamaBaseURL(value);
    },
    async updateOllamaModelId(value: string) {
      this.ollamaModelId = value;
      patchPreferencesSnapshot("ollamaModelId", value);
      await setOllamaModelId(value);
    },
    async updateOpenaiCompatibleBaseURL(value: string) {
      this.openaiCompatibleBaseURL = value;
      patchPreferencesSnapshot("openaiCompatibleBaseURL", value);
      await setOpenaiCompatibleBaseURL(value);
    },
    async updateOpenaiCompatibleModelId(value: string) {
      this.openaiCompatibleModelId = value;
      patchPreferencesSnapshot("openaiCompatibleModelId", value);
      await setOpenaiCompatibleModelId(value);
    },
    async updateOpenaiCompatibleContextLimit(value: number) {
      this.openaiCompatibleContextLimit = value;
      patchPreferencesSnapshot("openaiCompatibleContextLimit", value);
      await setOpenaiCompatibleContextLimit(value);
    },
    async updateVimMode(value: boolean) {
      this.vimMode = value;
      patchPreferencesSnapshot("vimMode", value);
      await setVimMode(value);
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
  },
});
