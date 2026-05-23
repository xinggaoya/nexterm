import type { CommandSpec } from "@/modules/commands/types";

export const TASK_COMMAND_SPECS: CommandSpec[] = [
  {
    id: "tasks.run",
    titleKey: "commands.items.runTask",
    category: "tasks",
    defaultKeybinding: null,
    workspaceRequired: true,
  },
];
