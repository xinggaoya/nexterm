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
    // 原来是 "Mod+K Mod+W"，被 normalizeKeybinding 折叠成 "Mod+W" 与
    // tab.close 撞车。改用不撞车的单键序列；快捷键体系不支持和弦，
    // 详见 commands/keybindings.ts 的 normalizeKeybinding。
    defaultKeybinding: "Mod+Alt+W",
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
    // 原来是 "Mod+K Mod+Shift+W"，同样被折叠成 "Mod+Shift+W"。
    defaultKeybinding: "Mod+Shift+W",
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

