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
    // Alt+方向键在 shell 里是 readline 的前后词跳转（bash/zsh/fish 全都占）。
    // 只有当确实存在该方位的相邻分屏时才抢键，否则把键还给 shell ——
    // 单分屏（绝大多数时候）不应该因为一个"切焦点"快捷键而丢掉词跳转。
    when: (context) => context.paneNeighbour?.left === true,
  },
  {
    id: "terminal.focusRight",
    titleKey: "commands.items.focusRight",
    category: "terminal",
    defaultKeybinding: "Alt+Right",
    workspaceRequired: true,
    when: (context) => context.paneNeighbour?.right === true,
  },
  {
    id: "terminal.focusUp",
    titleKey: "commands.items.focusUp",
    category: "terminal",
    defaultKeybinding: "Alt+Up",
    workspaceRequired: true,
    when: (context) => context.paneNeighbour?.up === true,
  },
  {
    id: "terminal.focusDown",
    titleKey: "commands.items.focusDown",
    category: "terminal",
    defaultKeybinding: "Alt+Down",
    workspaceRequired: true,
    when: (context) => context.paneNeighbour?.down === true,
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
  {
    // 重命名分屏/标签的终端标题（OSC 0/2 改的标题，或用户手动起的名字）。
    // 以前这条命令只存在于 CommandId 联合类型和处理器表里，却没有任何 spec
    // 条目 —— 于是它既不出现在命令面板、也没有默认键位，是一条永远触发不了
    // 的死命令。spec 才是命令的“存在性”来源，补上它才能被触发/被重绑定。
    id: "terminal.rename",
    titleKey: "terminal.rename",
    category: "terminal",
    defaultKeybinding: null,
    workspaceRequired: true,
  },
  {
    // 打开设置的终端分区选择本地默认 Shell（Windows）。
    id: "terminal.selectDefaultShell",
    titleKey: "commands.items.selectDefaultShell",
    category: "terminal",
    defaultKeybinding: null,
  },
];
