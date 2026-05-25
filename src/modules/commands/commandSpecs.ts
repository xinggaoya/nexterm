import { EDITOR_COMMAND_SPECS } from "@/modules/editor/editorCommands";
import { EXPLORER_COMMAND_SPECS } from "@/modules/explorer/explorerCommands";
import { RUN_CONFIG_COMMAND_SPECS } from "@/modules/run-configs/runConfigCommands";
import { SOURCE_CONTROL_COMMAND_SPECS } from "@/modules/source-control/sourceControlCommands";
import { TASK_COMMAND_SPECS } from "@/modules/tasks/taskCommands";
import { TERMINAL_COMMAND_SPECS } from "@/modules/terminal/terminalCommands";
import { WORKBENCH_COMMAND_SPECS } from "./workbenchCommands";
import type { CommandSpec } from "./types";

export const ALL_COMMAND_SPECS: CommandSpec[] = [
  ...WORKBENCH_COMMAND_SPECS,
  ...TASK_COMMAND_SPECS,
  ...RUN_CONFIG_COMMAND_SPECS,
  ...TERMINAL_COMMAND_SPECS,
  ...SOURCE_CONTROL_COMMAND_SPECS,
  ...EXPLORER_COMMAND_SPECS,
  ...EDITOR_COMMAND_SPECS,
];
