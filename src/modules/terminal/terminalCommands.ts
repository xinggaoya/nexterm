import type { CommandSpec } from "@/modules/commands/types";

export const TERMINAL_COMMAND_SPECS: CommandSpec[] = [
  {
    id: "terminal.new",
    titleKey: "commands.items.newTerminal",
    category: "terminal",
    defaultKeybinding: null,
    workspaceRequired: true,
  },
  {
    id: "terminal.splitHorizontal",
    titleKey: "commands.items.splitRight",
    category: "terminal",
    defaultKeybinding: null,
    workspaceRequired: true,
  },
  {
    id: "terminal.splitVertical",
    titleKey: "commands.items.splitDown",
    category: "terminal",
    defaultKeybinding: null,
    workspaceRequired: true,
  },
];
