import { createSimpleStore } from "@/lib/simpleStore";
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  onPreferencesChange,
  type Preferences,
} from "./store";
import {
  patchPreferencesSnapshot,
  replacePreferencesSnapshot,
} from "./preferencesSnapshot";

type State = Preferences & {
  hydrated: boolean;
  /** Subscribe & hydrate. Idempotent — safe to call from multiple windows. */
  init: () => Promise<void>;
};

let initialized = false;

export const usePreferencesStore = createSimpleStore<State>((set) => ({
  ...DEFAULT_PREFERENCES,
  hydrated: false,
  init: async () => {
    if (initialized) return;
    initialized = true;
    const prefs = await loadPreferences();
    replacePreferencesSnapshot(prefs);
    set({ ...prefs, hydrated: true });
    void onPreferencesChange((key, value) => {
      patchPreferencesSnapshot(key, value as never);
      set({ [key]: value } as Partial<State>);
    });
  },
}));
