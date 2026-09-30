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
  resolveCaptureInTerminal,
  specToDefinition,
  type CommandContext,
  type CommandDefinition,
  type CommandId,
  type KeybindingOverrides,
  type PaneDirection,
} from "@/modules/commands";
import {
  isTerminalInputSurface,
  isTextEntryTarget,
} from "@/modules/commands/shortcutTarget";
import type { CommandPaletteMode } from "@/modules/commands/CommandPalette.vue";
import {
  buildSourceControlEntries,
  pathsToStage,
  pathsToUnstage,
} from "@/modules/source-control/sourceControlModel";
import type { SplitDir } from "@/modules/terminal/lib/layout";
import { createTerminalSessionHandle } from "@/modules/terminal";
import type { SettingsTab } from "@/modules/settings/tabs";
import { DEFAULT_TERMINAL_SNIPPETS } from "@/modules/snippets";
import type { useTabsPiniaStore } from "@/modules/tabs/tabsPinia";
import type { Tab } from "@/modules/tabs/tabsTypes";

type WorkbenchCommandOptions = {
  t: (key: string) => string;
  keybindings: ComputedRef<KeybindingOverrides>;
  hasWorkspace: ComputedRef<boolean>;
  workspaceRoot: ComputedRef<string | null>;
  activeRepoRoot: Ref<string | null>;
  activeTab: ComputedRef<Tab | null>;
  /**
   * 活动分屏在四个方位上是否存在相邻 pane。
   *
   * 决定 Alt+方向键是“切分屏焦点”还是“把键还给 shell 做前后词跳转”——
   * 单分屏时后者才是用户想要的，所以没有邻居时命令不生效。
   */
  paneNeighbour: ComputedRef<Record<PaneDirection, boolean>>;
  leftPanelOpen: Ref<boolean>;
  rightPanelOpen: Ref<boolean>;
  workspaceFsEvent: Ref<WorkspaceFsChangedEvent | null>;
  openBranchesModal: Ref<boolean>;
  tabs: ReturnType<typeof useTabsPiniaStore>;
  newTerminalTab: () => void;
  splitActivePane: (dir: SplitDir) => void;
  openFileTab: (path: string, pin: boolean) => void;
  openSettings: (tab?: SettingsTab) => void;
  requestCloseTab: (id: number) => void;
  saveActiveEditor: () => void | Promise<void>;
  openGotoLine: () => void;
  /** LSP 跳转定义（F12）：打开目标文件并跳到定义处。 */
  goToDefinition: () => void | Promise<void>;
  /** LSP 重命名符号（F2）：取 WorkspaceEdit 后上抛给宿主确认。 */
  renameSymbol: () => void | Promise<void>;
  /** LSP 查找引用（Shift+F12）。 */
  findReferences: () => void | Promise<void>;
  openFindInFiles: () => void;
  openCommandPalette: (mode?: "commands" | "files") => void;
  openRenameDialog: (leafId: number, currentTitle: string) => void;
  openUrlPreview: () => void;
  killActiveTerminal: () => void | Promise<void>;
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
  const commandContext = computed<CommandContext>(() => ({
    workspaceReady: options.hasWorkspace.value,
    paneNeighbour: options.paneNeighbour.value,
    activeTabKind: options.activeTab.value?.kind ?? null,
  }));

  const commandDefinitions = computed<CommandDefinition[]>(() => [
    ...CORE_COMMAND_SPECS.map((spec) =>
      specToDefinition(spec, options.t, () => runCoreCommand(spec.id)),
    ),
    ...DEFAULT_TERMINAL_SNIPPETS.map((snippet) => ({
      id: `snippet.${snippet.id}` as CommandId,
      title: options.t(snippet.nameKey),
      category: "terminal" as const,
      defaultKeybinding: null,
      when: (context: CommandContext) => context.workspaceReady,
      run: () => {
        if (options.workspaceRoot.value) {
          options.tabs.newTaskTerminal({
            cwd: options.workspaceRoot.value,
            command: snippet.command,
          });
        }
      },
    })),
  ]);

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
    const activeRoot = options.activeRepoRoot.value;
    let activeRejected = false;
    let activeError: unknown;
    if (activeRoot) {
      try {
        const activeRepo = await options.resolveGitRepo(activeRoot);
        if (activeRepo) return activeRepo;
      } catch (error) {
        activeRejected = true;
        activeError = error;
      }
    }

    const workspaceRoot = options.workspaceRoot.value;
    if (!workspaceRoot) {
      if (activeRejected) throw activeError;
      return null;
    }
    return options.resolveGitRepo(workspaceRoot);
  }

  async function openGitHistoryFromCommand() {
    try {
      const repo = await resolveCurrentRepo();
      if (!repo) return;
      options.tabs.openCommitHistoryTab({
        repoRoot: repo.repoRoot,
        refName: repo.isDetached ? null : repo.branch,
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
    options.openBranchesModal.value = true;
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

  /** 把分屏焦点移到指定方位。只有确实存在邻居时才会被调用（见 spec 的 when）。 */
  function focusPane(dir: PaneDirection) {
    const tab = options.activeTab.value;
    if (!tab || tab.kind !== "terminal") return;
    options.tabs.focusDirection(tab.id, tab.activeLeafId, dir);
  }

  /**
   * 每条命令的处理器。
   *
   * 以前是一个 49 分支的 `switch`：新增命令时忘了加 case 只会静默 no-op
   * （TypeScript 对 switch 不做穷尽性检查）。改成 `Record<CommandId, …>`
   * 之后漏写一条就是编译期错误 —— 命令 id、spec 表、处理器表由类型强制对齐。
   */
  const CORE_RUNNERS: Record<CommandId, () => Promise<void> | void> = {
    "workbench.commandPalette.open": async () => {
      openCommandPalette("commands");
    },
    "workbench.quickOpen.open": async () => {
      openCommandPalette("files");
    },
    "workbench.closeActiveTab": async () => {
      closeActiveTabFromCommand();
    },
    "terminal.new": async () => {
      options.newTerminalTab();
    },
    "terminal.splitHorizontal": async () => {
      options.splitActivePane("row");
    },
    "terminal.splitVertical": async () => {
      options.splitActivePane("col");
    },
    "terminal.clear": async () => {
      const tab = options.activeTab.value;
      if (tab?.kind === "terminal") {
        const handle = createTerminalSessionHandle(tab.workspaceId, tab.activeLeafId);
        handle.write("\x1b[H\x1b[2J\x1b[3J\x1b[H");
      }
    },
    "terminal.reset": async () => {
      const tab = options.activeTab.value;
      if (tab?.kind === "terminal") {
        const handle = createTerminalSessionHandle(tab.workspaceId, tab.activeLeafId);
        handle.write("\x1bc");
      }
    },
    "panel.sourceControl.toggle": async () => {
      options.leftPanelOpen.value = !options.leftPanelOpen.value;
    },
    "panel.explorer.toggle": async () => {
      options.rightPanelOpen.value = !options.rightPanelOpen.value;
    },
    "explorer.refresh": async () => {
      refreshExplorerFromCommand();
    },
    "editor.save": async () => {
      await saveActiveEditorFromCommand();
    },
    "editor.closeActive": async () => {
      if (options.activeTab.value?.kind === "editor") closeActiveTabFromCommand();
    },
    "settings.open": async () => {
      options.openSettings();
    },
    "terminal.selectDefaultShell": async () => {
      options.openSettings("terminal");
    },
    "preview.open": async () => {
      options.openUrlPreview();
    },
    "git.refresh": async () => {
      refreshSourceControlFromCommand();
    },
    "git.history.open": async () => {
      await openGitHistoryFromCommand();
    },
    "git.stageAll": async () => {
      await stageAllFromCommand();
    },
    "git.unstageAll": async () => {
      await unstageAllFromCommand();
    },
    "git.fetch": async () => {
      await runGitRemoteCommand(options.t("sourceControl.fetchSuccess"), options.gitFetch);
    },
    "git.pull": async () => {
      await runGitRemoteCommand(options.t("sourceControl.pullSuccess"), options.gitPullFfOnly);
    },
    "git.push": async () => {
      await runGitRemoteCommand(options.t("sourceControl.pushSuccess"), options.gitPush);
    },
    "git.branch.checkout": async () => {
      await openBranchWorkflowFromCommand();
    },
    "git.branch.create": async () => {
      await openBranchWorkflowFromCommand();
    },
    "git.stash.save": async () => {
      await stashSaveFromCommand();
    },
    "git.stash.pop": async () => {
      await stashPopFromCommand();
    },
    "tab.close": async () => {
      const tab = options.activeTab.value;
      if (!tab) return;
      options.requestCloseTab(tab.id);
    },
    "tab.closeOthers": async () => {
      const tab = options.activeTab.value;
      if (!tab) return;
      options.tabs.closeOthers(tab.id);
    },
    "tab.closeToRight": async () => {
      const tab = options.activeTab.value;
      if (!tab) return;
      options.tabs.closeToRight(tab.id);
    },
    "tab.closeAll": async () => {
      options.tabs.closeAll();
    },
    "tab.next": async () => {
      options.tabs.cycleActive(1);
    },
    "tab.previous": async () => {
      options.tabs.cycleActive(-1);
    },
    "tab.duplicate": async () => {
      const tab = options.activeTab.value;
      if (!tab || tab.kind !== "terminal") return;
      options.tabs.newTab(tab.cwd);
    },
    "tab.pin": async () => {
      const tab = options.activeTab.value;
      if (!tab || tab.kind !== "editor" || !tab.preview) return;
      options.tabs.pinTab(tab.id);
    },
    "tab.restoreClosed": async () => {
      options.tabs.restoreClosed();
    },
    "editor.gotoLine": async () => {
      options.openGotoLine();
    },
    "editor.goToDefinition": async () => {
      void options.goToDefinition();
    },
    "editor.renameSymbol": async () => {
      void options.renameSymbol();
    },
    "editor.findReferences": async () => {
      void options.findReferences();
    },
    "terminal.focusLeft": async () => focusPane("left"),
    "terminal.focusRight": async () => focusPane("right"),
    "terminal.focusUp": async () => focusPane("up"),
    "terminal.focusDown": async () => focusPane("down"),
    "search.findInFiles": async () => {
      options.openFindInFiles();
    },
    "files.recent": async () => {
      // 触发命令面板并预设搜索词 "recent"
      options.openCommandPalette("files");
    },
    "terminal.runSnippet": async () => {
      options.openCommandPalette("commands");
    },
    "terminal.rename": async () => {
      const tab = options.activeTab.value;
      if (tab?.kind !== "terminal") return;
      options.openRenameDialog(tab.activeLeafId, tab.terminalTitle ?? "");
    },
    "terminal.kill": async () => {
      await options.killActiveTerminal();
    },
  };

  function runCoreCommand(id: CommandId): Promise<void> | void {
    return CORE_RUNNERS[id]?.();
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
    return isTextEntryTarget(target);
  }

  /**
   * 这条命令该不该抢下这次按键。
   *
   * 三层规则，从强到弱：
   * 1. **真的在输入框里打字**（搜索框 / 设置项 / 行内重命名 / 命令面板）
   *    → 一律让位，任何命令都不抢。
   * 2. **焦点不在终端**（面板按钮、文件树等）→ 抢。
   * 3. **焦点在终端** → 看 `captureInTerminal`（对齐 VS Code：用户显式绑了
   *    键位的命令就是全局和弦，终端里也生效；显式标了
   *    `captureInTerminal: false` 的命令把键还给 shell）。
   *
   * 第 1 层的关键是把 xterm 的 `xterm-helper-textarea` 从“输入框”里排除：
   * 它只是终端的键盘入口，键入的真正去处是 PTY。以前它被当成普通 textarea，
   * 导致除命令面板外**所有**快捷键在终端里失效。
   *
   * `terminal.focus*` 还额外受 spec 的 `when` 约束：只有确实存在该方位的
   * 相邻分屏时才生效，否则 Alt+方向键仍然是 shell 的前后词跳转。
   */
  function canCaptureCommandShortcut(
    command: CommandDefinition,
    event: KeyboardEvent,
  ): boolean {
    if (isEditableTarget(event.target)) return false;
    if (!isTerminalInputSurface(event.target)) return true;
    return resolveCaptureInTerminal(
      command,
      resolvedCommandKeybindings.value[command.id],
    );
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
      if (!canCaptureCommandShortcut(command, event)) continue;
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
    resolveCurrentRepo,
    resolvedCommandKeybindings,
  };
}
