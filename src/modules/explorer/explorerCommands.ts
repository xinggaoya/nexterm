import type { CommandSpec } from "@/modules/commands/types";

export const EXPLORER_COMMAND_SPECS: CommandSpec[] = [
  {
    id: "panel.explorer.toggle",
    titleKey: "commands.items.toggleExplorer",
    category: "panel",
    defaultKeybinding: null,
    workspaceRequired: true,
  },
  {
    id: "explorer.refresh",
    titleKey: "commands.items.refreshExplorer",
    category: "explorer",
    defaultKeybinding: null,
    workspaceRequired: true,
  },
];
