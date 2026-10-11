import type { CommandSpec } from "@/modules/commands/types";

export const EXPLORER_COMMAND_SPECS: CommandSpec[] = [
  {
    id: "panel.explorer.toggle",
    titleKey: "commands.items.toggleExplorer",
    category: "panel",
    defaultKeybinding: "Ctrl+Shift+E",
    workspaceRequired: true,
  },
  {
    id: "explorer.refresh",
    titleKey: "commands.items.refreshExplorer",
    category: "explorer",
    defaultKeybinding: "F5",
    workspaceRequired: true,
  },
  {
    id: "search.findInFiles",
    titleKey: "commands.items.findInFiles",
    category: "explorer",
    defaultKeybinding: "Ctrl+Shift+F",
    workspaceRequired: true,
  },
  {
    id: "files.recent",
    titleKey: "commands.items.openRecentFile",
    category: "explorer",
    defaultKeybinding: "Ctrl+R",
    workspaceRequired: true,
  },
];
