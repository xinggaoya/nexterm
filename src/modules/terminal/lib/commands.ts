import type { CommandSpec } from "@/modules/commands/types";

/**
 * Terminal command specs exposed in the command palette. Each command
 * delegates to a handler supplied at registration time via the workbench
 * command wiring. i18n keys map to existing strings in `locales/*.ts`.
 */
export const TERMINAL_COMMAND_SPECS: CommandSpec[] = [
  {
    id: "terminal.new",
    titleKey: "commands.items.newTerminal",
    category: "terminal",
    defaultKeybinding: "Ctrl+Shift+`",
    workspaceRequired: true,
  },
  {
    id: "terminal.splitHorizontal",
    titleKey: "commands.items.splitRight",
    category: "terminal",
    defaultKeybinding: "Ctrl+Shift+5",
    workspaceRequired: true,
  },
  {
    id: "terminal.splitVertical",
    titleKey: "commands.items.splitDown",
    category: "terminal",
    defaultKeybinding: "Ctrl+Shift+D",
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
    id: "terminal.kill",
    titleKey: "terminal.kill",
    category: "terminal",
    defaultKeybinding: null,
    workspaceRequired: true,
  },
  {
    id: "terminal.runSnippet",
    titleKey: "snippets.runSnippetTitle",
    category: "terminal",
    defaultKeybinding: null,
    workspaceRequired: true,
  },
];
