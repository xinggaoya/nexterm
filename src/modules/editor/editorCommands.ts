import type { CommandContext, CommandSpec } from "@/modules/commands/types";

/** 编辑器专属命令只在活动标签是编辑器时可用（同时用于命令面板过滤与快捷键抢占）。 */
function isEditorActive(context: CommandContext): boolean {
  return context.activeTabKind === "editor";
}

export const EDITOR_COMMAND_SPECS: CommandSpec[] = [
  {
    id: "editor.save",
    titleKey: "commands.items.saveEditor",
    category: "editor",
    defaultKeybinding: null,
    workspaceRequired: true,
    when: isEditorActive,
  },
  {
    id: "editor.closeActive",
    titleKey: "commands.items.closeEditor",
    category: "editor",
    defaultKeybinding: null,
    workspaceRequired: true,
    when: isEditorActive,
  },
  {
    id: "editor.gotoLine",
    titleKey: "commands.items.gotoLine",
    category: "editor",
    defaultKeybinding: "Ctrl+G",
    workspaceRequired: true,
    // Ctrl+G 在 bash 里是 abort（丢弃当前整行），所以在终端聚焦且没有编辑器
    // 时不能抢键。availability 同时决定了“命令面板里出不出现这条命令”。
    when: isEditorActive,
  },
  {
    id: "editor.goToDefinition",
    titleKey: "commands.items.goToDefinition",
    category: "editor",
    defaultKeybinding: "F12",
    workspaceRequired: true,
    when: isEditorActive,
  },
  {
    id: "editor.renameSymbol",
    titleKey: "commands.items.renameSymbol",
    category: "editor",
    defaultKeybinding: "F2",
    workspaceRequired: true,
    when: isEditorActive,
  },
  {
    id: "editor.findReferences",
    titleKey: "commands.items.findReferences",
    category: "editor",
    // Shift+F12，与 VS Code 一致
    defaultKeybinding: "Ctrl+Shift+F12",
    workspaceRequired: true,
    when: isEditorActive,
  },
];
