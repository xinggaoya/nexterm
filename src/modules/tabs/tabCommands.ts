import type { CommandSpec } from "@/modules/commands/types";

export const TAB_COMMAND_SPECS: CommandSpec[] = [
  {
    id: "tab.close",
    titleKey: "commands.items.closeTab",
    category: "tab",
    defaultKeybinding: "Mod+W",
  },
  {
    id: "tab.closeOthers",
    titleKey: "commands.items.closeOtherTabs",
    category: "tab",
    defaultKeybinding: "Mod+K Mod+W",
  },
  {
    id: "tab.closeToRight",
    titleKey: "commands.items.closeTabsToRight",
    category: "tab",
    defaultKeybinding: null,
  },
  {
    id: "tab.closeAll",
    titleKey: "commands.items.closeAllTabs",
    category: "tab",
    defaultKeybinding: "Mod+K Mod+Shift+W",
  },
  {
    id: "tab.next",
    titleKey: "commands.items.nextTab",
    category: "tab",
    defaultKeybinding: "Ctrl+Tab",
  },
  {
    id: "tab.previous",
    titleKey: "commands.items.previousTab",
    category: "tab",
    defaultKeybinding: "Ctrl+Shift+Tab",
  },
  {
    id: "tab.duplicate",
    titleKey: "commands.items.duplicateTab",
    category: "tab",
    defaultKeybinding: null,
  },
  {
    id: "tab.pin",
    titleKey: "commands.items.pinTab",
    category: "tab",
    defaultKeybinding: null,
  },
  {
    id: "tab.restoreClosed",
    titleKey: "commands.items.restoreClosedTab",
    category: "tab",
    defaultKeybinding: "Ctrl+Shift+T",
  },
];

