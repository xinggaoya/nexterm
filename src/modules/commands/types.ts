export type CommandId =
  | "workbench.commandPalette.open"
  | "workbench.quickOpen.open"
  | "workbench.closeActiveTab"
  | `snippet.${string}`
  | "terminal.new"
  | "terminal.splitHorizontal"
  | "terminal.splitVertical"
  | "terminal.clear"
  | "terminal.reset"
  | "terminal.selectDefaultShell"
  | "panel.sourceControl.toggle"
  | "panel.explorer.toggle"
  | "explorer.refresh"
  | "editor.save"
  | "editor.closeActive"
  | "settings.open"
  | "git.refresh"
  | "git.history.open"
  | "git.stageAll"
  | "git.unstageAll"
  | "git.fetch"
  | "git.pull"
  | "git.push"
  | "git.branch.checkout"
  | "git.branch.create"
  | "git.stash.save"
  | "git.stash.pop"
  | "tab.close"
  | "tab.closeOthers"
  | "tab.closeToRight"
  | "tab.closeAll"
  | "tab.next"
  | "tab.previous"
  | "tab.duplicate"
  | "tab.pin"
  | "tab.restoreClosed"
  | "files.recent"
  | "editor.gotoLine"
  | "editor.goToDefinition"
  | "editor.renameSymbol"
  | "editor.findReferences"
  | "terminal.focusLeft"
  | "terminal.focusRight"
  | "terminal.focusUp"
  | "terminal.focusDown"
  | "search.findInFiles"
  | "preview.open"
  | "terminal.runSnippet"
  | "terminal.rename"
  | "terminal.kill";

export type CommandCategory =
  | "editor"
  | "explorer"
  | "workbench"
  | "terminal"
  | "panel"
  | "settings"
  | "git"
  | "tab";

/** 分屏之间的四个方位（与 layout.ts 的 nextLeafInDir 同名同义）。 */
export type PaneDirection = "left" | "right" | "up" | "down";

export type CommandSpec = {
  id: CommandId;
  titleKey: string;
  category: CommandCategory;
  defaultKeybinding: string | null;
  workspaceRequired?: boolean;
  /**
   * 额外的可用性条件，与 `workspaceRequired` 取与。
   *
   * 存在的意义是让"这条命令此刻该不该生效"成为 spec 的一部分，而不是散在
   * 快捷键分发处：例如 `terminal.focusLeft` 只在**确实有左侧分屏**时才该
   * 生效 —— 否则 Alt+Left 应当留给 shell 做词跳转（readline 的
   * backward-word），而不是切一个不存在的焦点。
   */
  when?: (context: CommandContext) => boolean;
  /**
   * 终端聚焦时是否仍然抢占这次按键。
   *
   * 省略时按"该命令解析后有快捷键绑定"推导（对齐 VS Code）：用户显式绑了
   * 键位的命令就是全局和弦，终端里也该生效；没绑定的命令只能从命令面板 /
   * 右键菜单触发，终端焦不聚焦与它无关。显式写 `false` 用于把某个默认绑定
   * 从终端里"让"回给 shell。
   */
  captureInTerminal?: boolean;
};

export type CommandContext = {
  workspaceReady: boolean;
  /**
   * 活动分屏在每个方位上是否存在相邻 pane。
   *
   * 缺失的方位按 `false` 处理（不让位 = 不抢键），这样在没有分屏的终端里
   * Alt+方向键仍然是 shell 的词跳转。
   */
  paneNeighbour?: Partial<Record<PaneDirection, boolean>>;
  /** 活动标签的 kind（`terminal` / `editor` / ...），用于编辑器专属命令的可用性。 */
  activeTabKind?: string | null;
};

export type CommandDefinition<
  Context extends CommandContext = CommandContext,
> = {
  id: CommandId;
  title: string;
  category: CommandCategory;
  defaultKeybinding: string | null;
  when?: (context: Context) => boolean;
  /** 见 `CommandSpec.captureInTerminal`；已按"是否有绑定"求值完毕。 */
  captureInTerminal?: boolean;
  run: (context: Context) => void | Promise<void>;
};

export type KeybindingOverrides = Partial<Record<CommandId, string | null>>;
export type ResolvedKeybindings = Record<CommandId, string | null>;

export type KeybindingConflict = {
  keybinding: string;
  commandIds: CommandId[];
};
