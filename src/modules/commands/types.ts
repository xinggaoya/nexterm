export type CommandId =
  | "workbench.commandPalette.open"
  | "workbench.quickOpen.open"
  | "workbench.closeActiveTab"
  | "tasks.run"
  | "terminal.new"
  | "terminal.splitHorizontal"
  | "terminal.splitVertical"
  | "terminal.clear"
  | "terminal.reset"
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
  | "tab.pin";

export type CommandCategory =
  | "editor"
  | "explorer"
  | "workbench"
  | "terminal"
  | "panel"
  | "settings"
  | "tasks"
  | "git"
  | "tab";

export type CommandSpec = {
  id: CommandId;
  titleKey: string;
  category: CommandCategory;
  defaultKeybinding: string | null;
  workspaceRequired?: boolean;
};

export type CommandContext = {
  workspaceReady: boolean;
};

export type CommandDefinition<
  Context extends CommandContext = CommandContext,
> = {
  id: CommandId;
  title: string;
  category: CommandCategory;
  defaultKeybinding: string | null;
  when?: (context: Context) => boolean;
  run: (context: Context) => void | Promise<void>;
};

export type KeybindingOverrides = Partial<Record<CommandId, string | null>>;
export type ResolvedKeybindings = Record<CommandId, string | null>;

export type KeybindingConflict = {
  keybinding: string;
  commandIds: CommandId[];
};
