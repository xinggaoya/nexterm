export type SettingsTab =
  | "general"
  | "appearance"
  | "editor"
  | "terminal"
  | "keybindings"
  | "about";

export const SETTINGS_TABS: SettingsTab[] = [
  "general",
  "appearance",
  "editor",
  "terminal",
  "keybindings",
  "about",
];

export const SETTINGS_DEFAULT_TAB: SettingsTab = "general";

const SETTINGS_TAB_SET = new Set<string>(SETTINGS_TABS);

export function normalizeSettingsTab(tab: string | null | undefined): SettingsTab {
  if (tab && SETTINGS_TAB_SET.has(tab)) return tab as SettingsTab;
  return SETTINGS_DEFAULT_TAB;
}
