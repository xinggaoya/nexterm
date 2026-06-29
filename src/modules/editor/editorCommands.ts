import type { CommandSpec } from "@/modules/commands/types";

export const EDITOR_COMMAND_SPECS: CommandSpec[] = [
  {
    id: "editor.save",
    titleKey: "commands.items.saveEditor",
    category: "editor",
    defaultKeybinding: null,
    workspaceRequired: true,
  },
  {
    id: "editor.closeActive",
    titleKey: "commands.items.closeEditor",
    category: "editor",
    defaultKeybinding: null,
    workspaceRequired: true,
  },
  {
    id: "editor.gotoLine",
    titleKey: "commands.items.gotoLine",
    category: "editor",
    defaultKeybinding: "Ctrl+G",
    workspaceRequired: true,
  },
];
