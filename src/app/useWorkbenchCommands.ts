import { computed, ref, type ComputedRef, type Ref } from "vue";
import { IS_MAC } from "@/lib/platform";
import type {
  GitPushResult,
  GitRepoInfo,
  GitStatusSnapshot,
  WorkspaceFsChangedEvent,
} from "@/lib/native";
import {
  CORE_COMMAND_SPECS,
  buildResolvedKeybindings,
  createCommandRegistry,
  keybindingMatchesEvent,
  type CommandDefinition,
  type CommandId,
  type KeybindingOverrides,
} from "@/modules/commands";
import type { CommandPaletteMode } from "@/modules/commands/CommandPalette.vue";
import {
  buildSourceControlEntries,
  pathsToStage,
  pathsToUnstage,
} from "@/modules/source-control/sourceControlModel";
import type { SplitDir } from "@/modules/terminal/lib/panes";
import type { useTabsPiniaStore } from "@/modules/tabs/tabsPinia";
import type { Tab } from "@/modules/tabs/tabsTypes";

type WorkbenchCommandOptions = {
  t: (key: string) => string;
  keybindings: ComputedRef<KeybindingOverrides>;
  hasWorkspace: ComputedRef<boolean>;
  workspaceRoot: ComputedRef<string | null>;
  activeTab: ComputedRef<Tab | null>;
  leftPanelOpen: Ref<boolean>;
  rightPanelOpen: Ref<boolean>;
  workspaceFsEvent: Ref<WorkspaceFsChangedEvent | null>;
  tabs: ReturnType<typeof useTabsPiniaStore>;
  newTerminalTab: () => void;
  splitActivePane: (dir: SplitDir) => void;
  openFileTab: (path: string, pin: boolean) => void;
  openSettings: () => void;
  openTaskConsole: () => void | Promise<void>;
  runSelectedConfiguration: () => void | Promise<unknown>;
  stopSelectedConfiguration: () => void | Promise<void>;
  manageRunConfigurations: () => void | Promise<void>;
  requestCloseTab: (id: number) => void;
  saveActiveEditor: () => void | Promise<void>;
  resolveGitRepo: (root: string) => Promise<GitRepoInfo | null>;
  gitStatus: (repoRoot: string) => Promise<GitStatusSnapshot>;
  gitStage: (repoRoot: string, paths: string[]) => Promise<void>;
  gitUnstage: (repoRoot: string, paths: string[]) => Promise<void>;
  gitFetch: (repoRoot: string) => Promise<void>;
  gitPullFfOnly: (repoRoot: string) => Promise<void>;
  gitPush: (repoRoot: string) => Promise<GitPushResult>;
};

export function useWorkbenchCommands(options: WorkbenchCommandOptions) {
  const commandPaletteOpen = ref(false);
  const commandPaletteMode = ref<CommandPaletteMode>("commands");
  const commandContext = computed(() => ({
    workspaceReady: options.hasWorkspace.value,
  }));

  const commandDefinitions = computed<CommandDefinition[]>(() =>
    CORE_COMMAND_SPECS.map((spec) => ({
      id: spec.id,
      title: options.t(spec.titleKey),
      category: spec.category,
      defaultKeybinding: spec.defaultKeybinding,
      when: spec.workspaceRequired
        ? (context) => context.workspaceReady
        : undefined,
      run: () => runCoreCommand(spec.id),
    })),
  );

  const commandRegistry = computed(() =>
    createCommandRegistry(commandDefinitions.value),
  );

  const resolvedCommandKeybindings = computed(() =>
    buildResolvedKeybindings(commandDefinitions.value, options.keybindings.value),
  );

  function openCommandPalette(mode: CommandPaletteMode = "commands") {
    commandPaletteMode.value = mode;
    commandPaletteOpen.value = true;
  }

  function closeCommandPalette() {
    commandPaletteOpen.value = false;
  }

  function refreshSourceControlFromCommand() {
    const root = options.workspaceRoot.value;
    if (!root) return;
    options.leftPanelOpen.value = true;
    options.workspaceFsEvent.value = {
      rootPath: root,
      paths: [],
      gitRelated: true,
    };
  }

  function refreshExplorerFromCommand() {
    const root = options.workspaceRoot.value;
    if (!root) return;
    options.rightPanelOpen.value = true;
    options.workspaceFsEvent.value = {
      rootPath: root,
      paths: [],
      gitRelated: false,
    };
  }

  async function resolveCurrentRepo(): Promise<GitRepoInfo | null> {
    const root = options.workspaceRoot.value;
    if (!root) return null;
    return options.resolveGitRepo(root);
  }

  async function openGitHistoryFromCommand() {
    try {
      const repo = await resolveCurrentRepo();
      if (!repo) return;
      options.tabs.openCommitHistoryTab({
        repoRoot: repo.repoRoot,
        branch: repo.branch,
      });
    } catch (error) {
      console.warn("Failed to resolve git repository", error);
    }
  }

  async function stageAllFromCommand() {
    const repo = await resolveCurrentRepo();
    if (!repo) return;
    const status = await options.gitStatus(repo.repoRoot);
    const paths = pathsToStage(buildSourceControlEntries(status.changedFiles));
    if (paths.length === 0) return;
    await options.gitStage(repo.repoRoot, paths);
    refreshSourceControlFromCommand();
  }

  async function unstageAllFromCommand() {
    const repo = await resolveCurrentRepo();
    if (!repo) return;
    const status = await options.gitStatus(repo.repoRoot);
    const paths = pathsToUnstage(buildSourceControlEntries(status.changedFiles));
    if (paths.length === 0) return;
    await options.gitUnstage(repo.repoRoot, paths);
    refreshSourceControlFromCommand();
  }

  async function runGitRemoteCommand(
    action: (repoRoot: string) => Promise<unknown>,
  ) {
    const repo = await resolveCurrentRepo();
    if (!repo) return;
    await action(repo.repoRoot);
    refreshSourceControlFromCommand();
  }

  async function saveActiveEditorFromCommand() {
    if (options.activeTab.value?.kind !== "editor") return;
    await options.saveActiveEditor();
  }

  function closeActiveTabFromCommand() {
    const tab = options.activeTab.value;
    if (!tab) return;
    options.requestCloseTab(tab.id);
  }

  async function runCoreCommand(id: CommandId) {
    switch (id) {
      case "workbench.commandPalette.open":
        openCommandPalette("commands");
        return;
      case "workbench.quickOpen.open":
        openCommandPalette("files");
        return;
      case "workbench.closeActiveTab":
        closeActiveTabFromCommand();
        return;
      case "tasks.run":
        await options.openTaskConsole();
        return;
      case "runConfigs.runSelected":
        await options.runSelectedConfiguration();
        return;
      case "runConfigs.stopSelected":
        await options.stopSelectedConfiguration();
        return;
      case "runConfigs.manage":
        await options.manageRunConfigurations();
        return;
      case "terminal.new":
        options.newTerminalTab();
        return;
      case "terminal.splitHorizontal":
        options.splitActivePane("row");
        return;
      case "terminal.splitVertical":
        options.splitActivePane("col");
        return;
      case "panel.sourceControl.toggle":
        options.leftPanelOpen.value = !options.leftPanelOpen.value;
        return;
      case "panel.explorer.toggle":
        options.rightPanelOpen.value = !options.rightPanelOpen.value;
        return;
      case "explorer.refresh":
        refreshExplorerFromCommand();
        return;
      case "editor.save":
        await saveActiveEditorFromCommand();
        return;
      case "editor.closeActive":
        if (options.activeTab.value?.kind === "editor") closeActiveTabFromCommand();
        return;
      case "settings.open":
        options.openSettings();
        return;
      case "git.refresh":
        refreshSourceControlFromCommand();
        return;
      case "git.history.open":
        await openGitHistoryFromCommand();
        return;
      case "git.stageAll":
        await stageAllFromCommand();
        return;
      case "git.unstageAll":
        await unstageAllFromCommand();
        return;
      case "git.fetch":
        await runGitRemoteCommand(options.gitFetch);
        return;
      case "git.pull":
        await runGitRemoteCommand(options.gitPullFfOnly);
        return;
      case "git.push":
        await runGitRemoteCommand(options.gitPush);
        return;
    }
  }

  async function executeCommand(id: CommandId) {
    await commandRegistry.value.execute(id, commandContext.value);
  }

  async function executeCommandFromPalette(id: CommandId) {
    closeCommandPalette();
    await executeCommand(id);
  }

  function openFileFromCommandPalette(path: string) {
    options.openFileTab(path, false);
    closeCommandPalette();
  }

  function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    return !!target.closest(
      "input, textarea, select, [contenteditable='true'], [data-command-palette]",
    );
  }

  function canCaptureCommandShortcut(
    id: CommandId,
    event: KeyboardEvent,
  ): boolean {
    if (
      id === "workbench.commandPalette.open" ||
      id === "workbench.quickOpen.open"
    ) {
      return true;
    }
    return !isEditableTarget(event.target);
  }

  function handleGlobalCommandKeydown(event: KeyboardEvent) {
    if (commandPaletteOpen.value) return;
    for (const command of commandDefinitions.value) {
      if (command.when && !command.when(commandContext.value)) continue;
      if (
        !keybindingMatchesEvent(
          resolvedCommandKeybindings.value[command.id],
          event,
          IS_MAC,
        )
      ) {
        continue;
      }
      if (!canCaptureCommandShortcut(command.id, event)) continue;
      event.preventDefault();
      void executeCommand(command.id);
      return;
    }
  }

  return {
    commandContext,
    commandDefinitions,
    commandPaletteMode,
    commandPaletteOpen,
    closeCommandPalette,
    executeCommandFromPalette,
    handleGlobalCommandKeydown,
    openCommandPalette,
    openFileFromCommandPalette,
    resolvedCommandKeybindings,
  };
}
