import { EDITOR_COMMAND_SPECS } from "@/modules/editor/editorCommands";
import { EXPLORER_COMMAND_SPECS } from "@/modules/explorer/explorerCommands";
import { PREVIEW_COMMAND_SPECS } from "@/modules/preview/previewCommands";
import { SOURCE_CONTROL_COMMAND_SPECS } from "@/modules/source-control/sourceControlCommands";
import { TAB_COMMAND_SPECS } from "@/modules/tabs/tabCommands";
import { TERMINAL_COMMAND_SPECS } from "@/modules/terminal/lib/commands";
import { WORKBENCH_COMMAND_SPECS } from "./workbenchCommands";
import type { CommandDefinition, CommandSpec } from "./types";

export const ALL_COMMAND_SPECS: CommandSpec[] = [
  ...WORKBENCH_COMMAND_SPECS,
  ...TERMINAL_COMMAND_SPECS,
  ...SOURCE_CONTROL_COMMAND_SPECS,
  ...EXPLORER_COMMAND_SPECS,
  ...EDITOR_COMMAND_SPECS,
  ...PREVIEW_COMMAND_SPECS,
  ...TAB_COMMAND_SPECS,
];

/**
 * spec → 可执行 definition 的唯一转换点。
 *
 * 以前 `useWorkbenchCommands` 和 `KeybindingsSection` 各自重写了一遍
 * “workspaceRequired → when”的拼装，两边很容易漂移（设置页列出来的命令和
 * 命令面板里能搜到的命令可能对不上）。标题翻译与可用性条件现在都从 spec 走。
 */
export function specToDefinition(
  spec: CommandSpec,
  t: (key: string) => string,
  run: CommandDefinition["run"],
): CommandDefinition {
  return {
    id: spec.id,
    title: t(spec.titleKey),
    category: spec.category,
    defaultKeybinding: spec.defaultKeybinding,
    captureInTerminal: spec.captureInTerminal,
    when: (context) => {
      if (spec.workspaceRequired && !context.workspaceReady) return false;
      return spec.when ? spec.when(context) : true;
    },
    run,
  };
}
