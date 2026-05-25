import type { CommandSpec } from "@/modules/commands/types";

export const RUN_CONFIG_COMMAND_SPECS: CommandSpec[] = [
  {
    id: "runConfigs.runSelected",
    titleKey: "commands.items.runSelectedConfiguration",
    category: "tasks",
    defaultKeybinding: null,
    workspaceRequired: true,
  },
  {
    id: "runConfigs.stopSelected",
    titleKey: "commands.items.stopSelectedConfiguration",
    category: "tasks",
    defaultKeybinding: null,
    workspaceRequired: true,
  },
  {
    id: "runConfigs.manage",
    titleKey: "commands.items.manageRunConfigurations",
    category: "tasks",
    defaultKeybinding: null,
    workspaceRequired: true,
  },
];
