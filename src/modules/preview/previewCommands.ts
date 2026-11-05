import type { CommandSpec } from "@/modules/commands/types";

export const PREVIEW_COMMAND_SPECS: CommandSpec[] = [
  {
    id: "preview.open",
    titleKey: "commands.items.openUrlPreview",
    category: "workbench",
    defaultKeybinding: "Ctrl+Shift+V",
    workspaceRequired: true,
    // Ctrl+Shift+V 在终端里是**粘贴**（xterm 的快捷键层自己拦下这个键）。
    // 命令默认「有绑定就抢」，于是终端里按 Ctrl+Shift+V 会「既粘贴又弹出
    // 预览框」—— 两件事同时发生。显式让位：终端里归粘贴，终端之外
    // （文件树 / 面板 / 命令面板）归预览。
    captureInTerminal: false,
  },
];
