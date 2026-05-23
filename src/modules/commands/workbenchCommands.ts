import type { CommandSpec } from "./types";

export const WORKBENCH_COMMAND_SPECS: CommandSpec[] = [
  {
    id: "workbench.commandPalette.open",
    titleKey: "commands.items.commandCenter",
    category: "workbench",
    defaultKeybinding: "Mod+K",
  },
  {
    id: "workbench.quickOpen.open",
    titleKey: "commands.items.quickOpen",
    category: "workbench",
    defaultKeybinding: "Mod+P",
    workspaceRequired: true,
  },
  {
    id: "workbench.closeActiveTab",
    titleKey: "commands.items.closeActiveTab",
    category: "workbench",
    defaultKeybinding: null,
    workspaceRequired: true,
  },
  {
    id: "settings.open",
    titleKey: "commands.items.openSettings",
    category: "settings",
    defaultKeybinding: null,
  },
];
