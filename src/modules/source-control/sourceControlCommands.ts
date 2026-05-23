import type { CommandSpec } from "@/modules/commands/types";

export const SOURCE_CONTROL_COMMAND_SPECS: CommandSpec[] = [
  {
    id: "panel.sourceControl.toggle",
    titleKey: "commands.items.toggleSourceControl",
    category: "panel",
    defaultKeybinding: null,
    workspaceRequired: true,
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
  {
    id: "git.stageAll",
    titleKey: "commands.items.stageAll",
    category: "git",
    defaultKeybinding: null,
    workspaceRequired: true,
  },
  {
    id: "git.unstageAll",
    titleKey: "commands.items.unstageAll",
    category: "git",
    defaultKeybinding: null,
    workspaceRequired: true,
  },
  {
    id: "git.fetch",
    titleKey: "commands.items.fetch",
    category: "git",
    defaultKeybinding: null,
    workspaceRequired: true,
  },
  {
    id: "git.pull",
    titleKey: "commands.items.pull",
    category: "git",
    defaultKeybinding: null,
    workspaceRequired: true,
  },
  {
    id: "git.push",
    titleKey: "commands.items.push",
    category: "git",
    defaultKeybinding: null,
    workspaceRequired: true,
  },
];
