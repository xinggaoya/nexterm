import type { CommandCategory, CommandId } from "./types";

export type CoreCommandSpec = {
  id: CommandId;
  titleKey: string;
  category: CommandCategory;
  defaultKeybinding: string | null;
  workspaceRequired?: boolean;
};

export const CORE_COMMAND_SPECS: CoreCommandSpec[] = [
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
    id: "panel.sourceControl.toggle",
    titleKey: "commands.items.toggleSourceControl",
    category: "panel",
    defaultKeybinding: null,
    workspaceRequired: true,
  },
  {
    id: "panel.explorer.toggle",
    titleKey: "commands.items.toggleExplorer",
    category: "panel",
    defaultKeybinding: null,
    workspaceRequired: true,
  },
  {
    id: "settings.open",
    titleKey: "commands.items.openSettings",
    category: "settings",
    defaultKeybinding: null,
  },
  {
    id: "git.refresh",
    titleKey: "commands.items.refreshSourceControl",
    category: "git",
    defaultKeybinding: null,
    workspaceRequired: true,
  },
  {
    id: "git.history.open",
    titleKey: "commands.items.openGitHistory",
    category: "git",
    defaultKeybinding: null,
    workspaceRequired: true,
  },
];
