import { computed, ref, type ComputedRef, type Ref } from "vue";
import { IS_MAC } from "@/lib/platform";
import type {
  GitBranchInfo,
  GitBranchResult,
  GitFetchResult,
  GitPullResult,
  GitPushResult,
  GitRepoInfo,
  GitStashEntry,
  GitStashPushOptions,
  GitStashResult,
  GitStatusSnapshot,
  WorkspaceFsChangedEvent,
} from "@/lib/native";
import { notifyError, notifyInfo, notifySuccess } from "@/modules/notifications/notificationCenter";
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
import { createTerminalSessionHandle } from "@/modules/terminal/lib/terminalSessionCore";
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
  requestCloseTab: (id: number) => void;
  saveActiveEditor: () => void | Promise<void>;
  openGotoLine: () => void;
  resolveGitRepo: (root: string) => Promise<GitRepoInfo | null>;
  gitStatus: (repoRoot: string) => Promise<GitStatusSnapshot>;
  gitStage: (repoRoot: string, paths: string[]) => Promise<void>;
  gitUnstage: (repoRoot: string, paths: string[]) => Promise<void>;
  gitFetch: (repoRoot: string) => Promise<GitFetchResult>;
  gitPullFfOnly: (repoRoot: string) => Promise<GitPullResult>;
  gitPush: (repoRoot: string) => Promise<GitPushResult>;
  gitBranchList: (repoRoot: string) => Promise<GitBranchInfo[]>;
  gitCheckoutBranch: (
    repoRoot: string,
    branch: string,
    remote: boolean,
  ) => Promise<GitBranchResult>;
  gitCreateBranch: (repoRoot: string, branch: string) => Promise<GitBranchResult>;
  gitStashList: (repoRoot: string) => Promise<GitStashEntry[]>;
  gitStashPush: (
    repoRoot: string,
    options: GitStashPushOptions,
  ) => Promise<GitStashResult>;
  gitStashPop: (repoRoot: string, selector: string) => Promise<GitStashResult>;
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
    title: string,
    action: (repoRoot: string) => Promise<{ summary?: string } | GitPushResult>,
  ) {
    try {
      const repo = await resolveCurrentRepo();
      if (!repo) return;
      const result = await action(repo.repoRoot);
      const content =
        "summary" in result && result.summary
          ? result.summary
          : options.t("sourceControl.pushedLatestChanges");
      notifySuccess(title, content);
      refreshSourceControlFromCommand();
    } catch (error) {
      notifyError(title, error);
    }
  }

  async function openBranchWorkflowFromCommand() {
    const repo = await resolveCurrentRepo();
    if (!repo) return;
    options.leftPanelOpen.value = true;
    notifyInfo(
      options.t("sourceControl.branches"),
      options.t("sourceControl.branchCommandHint"),
    );
  }

  async function stashSaveFromCommand() {
    try {
      const repo = await resolveCurrentRepo();
      if (!repo) return;
      const result = await options.gitStashPush(repo.repoRoot, {
        message: null,
        includeUntracked: true,
      });
      notifySuccess(options.t("sourceControl.stashSaveSuccess"), result.message);
      refreshSourceControlFromCommand();
    } catch (error) {
      notifyError(options.t("sourceControl.stashSaveFailed"), error);
    }
  }

  async function stashPopFromCommand() {
    try {
      const repo = await resolveCurrentRepo();
      if (!repo) return;
      const stashes = await options.gitStashList(repo.repoRoot);
      const latest = stashes[0];
      if (!latest) {
        notifyInfo(
          options.t("sourceControl.stashPop"),
          options.t("sourceControl.noStashes"),
        );
        return;
      }
      const result = await options.gitStashPop(repo.repoRoot, latest.selector);
      notifySuccess(options.t("sourceControl.stashPopSuccess"), result.message);
      refreshSourceControlFromCommand();
    } catch (error) {
      notifyError(options.t("sourceControl.stashPopFailed"), error);
    }
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
      case "terminal.new":
        options.newTerminalTab();
        return;
      case "terminal.splitHorizontal":
        options.splitActivePane("row");
        return;
      case "terminal.splitVertical":
        options.splitActivePane("col");
        return;
      case "terminal.clear": {
        const tab = options.activeTab.value;
        if (tab?.kind === "terminal") {
          const handle = createTerminalSessionHandle(tab.activeLeafId);
          handle.write("\x1b[H\x1b[2J\x1b[3J\x1b[H");
        }
        return;
      }
      case "terminal.reset": {
        const tab = options.activeTab.value;
        if (tab?.kind === "terminal") {
          const handle = createTerminalSessionHandle(tab.activeLeafId);
          handle.write("\x1bc");
        }
        return;
      }
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
        await runGitRemoteCommand(options.t("sourceControl.fetchSuccess"), options.gitFetch);
        return;
      case "git.pull":
        await runGitRemoteCommand(options.t("sourceControl.pullSuccess"), options.gitPullFfOnly);
        return;
      case "git.push":
        await runGitRemoteCommand(options.t("sourceControl.pushSuccess"), options.gitPush);
        return;
      case "git.branch.checkout":
      case "git.branch.create":
        await openBranchWorkflowFromCommand();
        return;
      case "git.stash.save":
        await stashSaveFromCommand();
        return;
      case "git.stash.pop":
        await stashPopFromCommand();
        return;
      case "tab.close": {
        const tab = options.activeTab.value;
        if (!tab) return;
        options.requestCloseTab(tab.id);
        return;
      }
      case "tab.closeOthers": {
        const tab = options.activeTab.value;
        if (!tab) return;
        options.tabs.closeOthers(tab.id);
        return;
      }
      case "tab.closeToRight": {
        const tab = options.activeTab.value;
        if (!tab) return;
        options.tabs.closeToRight(tab.id);
        return;
      }
      case "tab.closeAll":
        options.tabs.closeAll();
        return;
      case "tab.next":
        options.tabs.cycleActive(1);
        return;
      case "tab.previous":
        options.tabs.cycleActive(-1);
        return;
      case "tab.duplicate": {
        const tab = options.activeTab.value;
        if (!tab || tab.kind !== "terminal") return;
        options.tabs.newTab(tab.cwd);
        return;
      }
      case "tab.pin": {
        const tab = options.activeTab.value;
        if (!tab || tab.kind !== "editor" || !tab.preview) return;
        options.tabs.pinTab(tab.id);
        return;
      }
      case "editor.gotoLine":
        options.openGotoLine();
        return;
      case "terminal.focusLeft":
      case "terminal.focusRight":
      case "terminal.focusUp":
      case "terminal.focusDown": {
        const tab = options.activeTab.value;
        if (!tab || tab.kind !== "terminal") return;
        const dir = id === "terminal.focusLeft" ? "left"
          : id === "terminal.focusRight" ? "right"
          : id === "terminal.focusUp" ? "up" : "down";
        options.tabs.focusDirection(tab.id, tab.activeLeafId, dir);
        return;
      }
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
