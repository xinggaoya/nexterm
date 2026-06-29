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
  {
    id: "terminal.clear",
    titleKey: "commands.items.clearTerminal",
    category: "terminal",
    defaultKeybinding: null,
    workspaceRequired: true,
  },
  {
    id: "terminal.reset",
    titleKey: "commands.items.resetTerminal",
    category: "terminal",
    defaultKeybinding: null,
    workspaceRequired: true,
  },
  {
    id: "terminal.focusLeft",
    titleKey: "commands.items.focusLeft",
    category: "terminal",
    defaultKeybinding: "Alt+Left",
    workspaceRequired: true,
  },
  {
    id: "terminal.focusRight",
    titleKey: "commands.items.focusRight",
    category: "terminal",
    defaultKeybinding: "Alt+Right",
    workspaceRequired: true,
  },
  {
    id: "terminal.focusUp",
    titleKey: "commands.items.focusUp",
    category: "terminal",
    defaultKeybinding: "Alt+Up",
    workspaceRequired: true,
  },
  {
    id: "terminal.focusDown",
    titleKey: "commands.items.focusDown",
    category: "terminal",
    defaultKeybinding: "Alt+Down",
    workspaceRequired: true,
  },
];
