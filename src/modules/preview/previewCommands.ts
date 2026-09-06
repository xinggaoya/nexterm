import type { CommandSpec } from "@/modules/commands/types";

export const PREVIEW_COMMAND_SPECS: CommandSpec[] = [
  {
    id: "preview.open",
    titleKey: "commands.items.openUrlPreview",
    category: "workbench",
    defaultKeybinding: null,
    workspaceRequired: true,
  },
];
