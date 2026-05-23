export type CommandId =
  | "workbench.commandPalette.open"
  | "workbench.quickOpen.open"
  | "terminal.new"
  | "terminal.splitHorizontal"
  | "terminal.splitVertical"
  | "panel.sourceControl.toggle"
  | "panel.explorer.toggle"
  | "settings.open"
  | "git.refresh"
  | "git.history.open";

export type CommandCategory =
  | "workbench"
  | "terminal"
  | "panel"
  | "settings"
  | "git";

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
