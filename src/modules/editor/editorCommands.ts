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
  {
    id: "editor.goToDefinition",
    titleKey: "commands.items.goToDefinition",
    category: "editor",
    defaultKeybinding: "F12",
    workspaceRequired: true,
  },
  {
    id: "editor.renameSymbol",
    titleKey: "commands.items.renameSymbol",
    category: "editor",
    defaultKeybinding: "F2",
    workspaceRequired: true,
  },
  {
    id: "editor.findReferences",
    titleKey: "commands.items.findReferences",
    category: "editor",
    // Shift+F12，与 VS Code 一致
    defaultKeybinding: "Ctrl+Shift+F12",
    workspaceRequired: true,
  },
];
