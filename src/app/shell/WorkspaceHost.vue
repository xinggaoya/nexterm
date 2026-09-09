<script setup lang="ts">
/**
 * Per-workspace container that keeps a workspace's tabs, terminal sessions,
 * FS watcher, editor/explorer/source-control state, and task console all
 * alive — even when the workspace is not active (switched away from).
 *
 * MainApp renders one WorkspaceHost per open workspace inside a `v-show`
 * stack, so inactive workspaces stay mounted (xterm buffers accumulate,
 * PTY processes keep running, watchers keep firing) and are simply hidden.
 *
 * New terminal-first shell layout (v3):
 *   Rail(工作区轨道) | TopBar(工作区身份 + 会话条 + 动作) / Canvas(全幅画布
 *   + 玻璃浮层) / StatusDock(状态坞)。整屏即活动工作区,切换 = v-show 翻转。
 *
 * This component owns:
 *   - the env-bound `wsNative` surface (created once from `workspace.env`)
 *   - the WorkspaceContext provided to all descendants via inject
 *   - the per-workspace FS watcher lifecycle
 *   - the per-workspace task console controller
 *   - the per-workspace command wiring forwarded to Canvas
 */
import { computed, h, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { NInput, useDialog } from "naive-ui";
import { createNativeForEnv, type WorkspaceFsChangedEvent } from "@/lib/native";
import { notifyError } from "@/modules/notifications/notificationCenter";
import { workspaceScopeKey } from "@/modules/workspace";
import type { GitDecorationMap } from "@/modules/source-control";
import type {
  WorkspaceEnv,
  WorkspaceInstance,
} from "@/modules/workspace";
import { useTabsPiniaStore } from "@/modules/tabs/tabsPinia";
import type { Tab } from "@/modules/tabs/tabsTypes";
import { isDirtyEditorTab } from "@/modules/tabs/closeGuards";
import { leafIds, type SplitDir } from "@/modules/terminal/lib/layout";
import { MAX_PANES_PER_TAB } from "@/modules/tabs/tabsTypes";
import {
  provideWorkspaceContext,
} from "@/app/workspaceContext";
import { useWorkspaceLifecycle } from "@/app/useWorkspaceLifecycle";
import { useTaskConsoleController } from "@/app/useTaskConsoleController";
import { useWorkbenchCommands } from "@/app/useWorkbenchCommands";
import { readEditorDocument } from "@/modules/editor/lib/documentService";
import { isBinaryImagePath } from "@/modules/file-preview/lib/imageFiles";
import { normalizePreviewUrl } from "@/modules/preview/previewUrl";
import { t, tLoose } from "@/modules/i18n/translate";
import Rail, { type RailToolKey } from "./Rail.vue";
import TopBar from "./TopBar.vue";
import SessionStrip from "./SessionStrip.vue";
import Canvas from "./Canvas.vue";
import StatusDock from "./StatusDock.vue";
import { useWorkspacesPiniaStore } from "@/modules/workspace/workspacesPinia";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import { USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import type { SettingsTab } from "@/modules/settings/tabs";

const props = defineProps<{
  workspace: WorkspaceInstance;
}>();

const emit = defineEmits<{
  "add-workspace": [env: WorkspaceEnv];
  "request-settings": [tab?: SettingsTab];
  "request-command-palette": [mode?: "commands" | "files"];
  "request-rename": [payload: { leafId: number; currentTitle: string }];
  // 移除工作区需要二次确认，确认对话框由 MainApp 统一持有。
  "request-remove-workspace": [id: string];
}>();

const prefs = usePreferencesPiniaStore();
const tabs = useTabsPiniaStore();
const workspaces = useWorkspacesPiniaStore();

// Env-bound native surface — created once; env is immutable per workspace.
const wsNative = createNativeForEnv(props.workspace.env);

// Inject this workspace's context so descendants (FileExplorer,
// SourceControlPanel, EditorPane, terminal panes) can reach the correct
// env-bound native surface without a global singleton.
provideWorkspaceContext({ workspace: props.workspace, wsNative });

const workspaceRoot = computed(() => props.workspace.rootPath);
const workspaceId = computed(() => props.workspace.id);
const workspaceScope = computed(() => workspaceScopeKey(props.workspace.env));

const {
  startWorkspaceLifecycle,
  stopWorkspaceLifecycle,
  workspaceFsEvent,
  forceFlushNow,
} = useWorkspaceLifecycle({
  workspaceId: props.workspace.id,
  env: props.workspace.env,
  rootPath: workspaceRoot,
  wsNative,
});

const activeTab = computed<Tab | null>(
  () => tabs.workspaceTabs(props.workspace.id).find((tab) => tab.id === tabs.activeIdByWorkspace[props.workspace.id]) ?? null,
);
const activeRepoRoot = ref<string | null>(null);
// 源控浮层上抛的 git 角标（path → 变更状态），透传给 Canvas → FileExplorer
// 渲染文件树角标。浮层 v-show 隐藏时仍保持挂载，数据持续更新。
const gitDecorations = ref<GitDecorationMap>(new Map());
function onDecorationChange(decorations: GitDecorationMap): void {
  gitDecorations.value = decorations;
}
// 分支状态由活动工作区的源控面板上抛,状态坞就地显示(不再上抛 MainApp)。
const gitBranch = ref<string | null>(null);

// ── 浮层状态(终端优先:默认全关,画布即终端)──────────────────────────
const explorerOpen = ref(false);
const sourceControlOpen = ref(false);
const explorerWidth = ref(prefs.explorerPanelWidth);
const sourceControlWidth = ref(prefs.sourceControlPanelWidth);
// 拖拽过程中频繁 emit,持久化做 400ms 防抖;数值本身即时生效。
let widthSaveTimer: ReturnType<typeof setTimeout> | null = null;
function persistWidth(kind: "explorer" | "sourceControl", width: number): void {
  if (kind === "explorer") explorerWidth.value = width;
  else sourceControlWidth.value = width;
  if (widthSaveTimer) clearTimeout(widthSaveTimer);
  widthSaveTimer = setTimeout(() => {
    widthSaveTimer = null;
    if (kind === "explorer") void prefs.updateExplorerPanelWidth(width);
    else void prefs.updateSourceControlPanelWidth(width);
  }, 400);
}
onBeforeUnmount(() => {
  if (widthSaveTimer) clearTimeout(widthSaveTimer);
});

function setExplorerOpen(open: boolean): void {
  explorerOpen.value = open;
  if (open) sourceControlOpen.value = false;
}
function setSourceControlOpen(open: boolean): void {
  sourceControlOpen.value = open;
  if (open) explorerOpen.value = false;
}

const canSplitActiveTab = computed(() => {
  const tab = activeTab.value;
  if (!tab || tab.kind !== "terminal") return false;
  return leafIds(tab.paneTree).length < MAX_PANES_PER_TAB;
});

function newTerminalTab(): void {
  tabs.newTab(workspaceRoot.value ?? undefined, props.workspace.id);
}

function openTerminalInDir(cwd: string): void {
  if (!cwd) return;
  tabs.newTab(cwd, props.workspace.id);
}

function duplicateTerminalTab(tabId: number): void {
  const tab = tabs.workspaceTabs(props.workspace.id).find((t) => t.id === tabId);
  if (!tab || tab.kind !== "terminal") return;
  tabs.newTab(tab.cwd, props.workspace.id);
}

function renameTabTitle(tabId: number, title: string): void {
  const trimmed = title.trim();
  if (!trimmed) return;
  tabs.updateTab(tabId, { title: trimmed }, props.workspace.id);
}

function splitActivePane(dir: SplitDir): void {
  const tab = activeTab.value;
  if (tab?.kind !== "terminal") return;
  tabs.splitActivePane(tab.id, dir, props.workspace.id);
}

async function readWorkspaceTextFile(path: string): Promise<string | null> {
  const result = await readEditorDocument(wsNative, path);
  return result.status === "ready" ? result.content : null;
}

const taskConsole = useTaskConsoleController({
  workspaceRoot,
  wsNative,
  readTextFile: readWorkspaceTextFile,
  openTaskTerminal: (input) =>
    tabs.newTaskTerminal(input, props.workspace.id),
});

const runningTaskCount = computed(
  () => taskConsole.taskRunList.value.filter((run) => run.status === "running").length,
);

function openFileTab(path: string, pin: boolean): void {
  // 二进制图片在文本编辑器里没有意义,双击直接进图片预览 tab。
  if (isBinaryImagePath(path)) {
    tabs.newFilePreviewTab(path, props.workspace.id);
    void prefs.recordOpenedFile(path);
    return;
  }
  const shouldPin = pin || prefs.fileOpenMode === "pinned";
  tabs.openFileTab(path, props.workspace.id, shouldPin);
  void prefs.recordOpenedFile(path);
}

function openMarkdownPreview(path: string): void {
  tabs.newMarkdownTab(path, props.workspace.id);
}

function openFilePreview(path: string): void {
  tabs.newFilePreviewTab(path, props.workspace.id);
}

function openSearchResult(path: string, line: number): void {
  tabs.openFileTab(path, props.workspace.id, true);
  // 编辑器挂载是异步的（tab 激活 + 文档加载），用短轮询等它就绪后跳行。
  const startedAt = Date.now();
  const tryReveal = () => {
    if (canvas.value?.revealEditorLine?.(path, line)) return;
    if (Date.now() - startedAt < 2500) {
      setTimeout(tryReveal, 120);
    }
  };
  setTimeout(tryReveal, 120);
}

// `preview.open` 命令入口：对话框输入 URL，确认后创建 web 预览 tab。
function openUrlPreview(): void {
  const urlInput = ref("");
  const previewDialog = dialog.info({
    title: t("preview.openTitle"),
    content: () =>
      h(NInput, {
        value: urlInput.value,
        "onUpdate:value": (value: string) => {
          urlInput.value = value;
        },
        placeholder: t("preview.urlPlaceholder"),
        autofocus: true,
      }),
    positiveText: t("preview.open"),
    negativeText: t("common.cancel"),
    onPositiveClick: () => {
      const url = normalizePreviewUrl(urlInput.value);
      if (!url) return false;
      tabs.newPreviewTab(url, props.workspace.id);
      previewDialog.destroy();
    },
  });
}

function openSourceDiff(input: {
  repoRoot: string;
  path: string;
  mode: "-" | "+";
  originalPath: string | null;
  title?: string;
}): void {
  tabs.openGitDiffTab(input, props.workspace.id);
}

function openSourceHistory(input: {
  repoRoot: string;
  refName?: string | null;
  allRefs?: boolean;
}): void {
  tabs.openCommitHistoryTab(input, props.workspace.id);
}

function onHistoryRefChange(input: {
  tabId: number;
  refName: string | null;
  allRefs: boolean;
}): void {
  tabs.updateGitHistoryTabRef(
    input.tabId,
    { refName: input.refName, allRefs: input.allRefs },
    props.workspace.id,
  );
}

const canvas = ref<InstanceType<typeof Canvas> | null>(null);

async function saveActiveEditor(): Promise<void> {
  await canvas.value?.saveActiveEditor();
}

function openGotoLine(): void {
  canvas.value?.openGotoLine?.();
}

function openFindInFiles(): void {
  // Find in Files 依托文件树浮层的搜索模式:先展开浮层再进入 content 模式。
  setExplorerOpen(true);
  canvas.value?.openFindInFiles?.();
}

async function killActiveTerminal(): Promise<void> {
  const tab = activeTab.value;
  if (tab?.kind !== "terminal") return;
  await canvas.value?.killTerminal(tab.activeLeafId);
}

const showBranchesModal = ref(false);
// Canvas types this prop as Ref<boolean>; a template binding auto-unwraps
// refs to plain values, so we bridge via a computed that keeps the ref shape.
const showBranchesModalProp = computed(() => showBranchesModal);

// useWorkspaceLifecycle 的 fsEvent 类型含 undefined，模板绑定前归一为
// null，避免在模板里做 as unknown as 强转。
const normalizedFsEvent = computed<WorkspaceFsChangedEvent | null>(
  () => workspaceFsEvent.value ?? null,
);

// Rail 工具键 → 浮层开关。左列浮层(文件树/源控)互斥,任务浮层独立。
function handleToggleTool(key: RailToolKey): void {
  if (key === "explorer") {
    setExplorerOpen(!explorerOpen.value);
    return;
  }
  if (key === "sourceControl") {
    setSourceControlOpen(!sourceControlOpen.value);
    return;
  }
  if (taskConsole.taskConsoleOpen.value) {
    taskConsole.closeTaskConsole();
  } else {
    void taskConsole.openTaskConsole();
  }
}

// Rail 右键菜单:把当前工作区在独立窗口打开。
async function openThisWorkspaceInNewWindow(id: string): Promise<void> {
  const target = workspaces.workspaces.find((ws) => ws.id === id);
  if (!target) return;
  try {
    const { openWorkspaceInNewWindow } = await import(
      "@/modules/workspace/workspaceWindow"
    );
    await openWorkspaceInNewWindow({ path: target.rootPath, env: target.env });
  } catch (error) {
    notifyError(t("app.workspace.openWindowFailed"), error);
  }
}

// SessionStrip 右键菜单的"重命名终端标题"：复用 MainApp 的 RenameTerminalDialog
// 链路（与 terminal.rename 命令同一入口）。
function requestTabRename(tabId: number): void {
  const tab = tabs.workspaceTabs(props.workspace.id).find((tk) => tk.id === tabId);
  if (!tab || tab.kind !== "terminal") return;
  emit("request-rename", {
    leafId: tab.activeLeafId,
    currentTitle: tab.terminalTitle ?? "",
  });
}

/**
 * Workspace 切回可见时的"立即激活"编排(细节见设计文档/旧实现注释):
 * 直接主动重读 explorer 根+展开节点,forceFlushNow 抛后台补一次,
 * 源控立即补跑 git status。
 */
function onWorkspaceActivated(): void {
  canvas.value?.activateExplorer?.();
  forceFlushNow();
  void canvas.value?.refreshSourceControlOnActivate?.();
}

watch(
  () => workspaces.activeWorkspaceId,
  (activeId, prevId) => {
    // 只在 active 切到本 workspace 时触发(且不是初次 mount —— mount
    // 时的初始化路径已各自做完了加载)
    if (activeId === props.workspace.id && prevId !== undefined && activeId !== prevId) {
      onWorkspaceActivated();
    }
  },
);

onMounted(() => {
  void startWorkspaceLifecycle();
  // Ensure this workspace has at least one tab (a fresh terminal). Safe to
  // call repeatedly — initWorkspace is idempotent.
  tabs.initWorkspace(props.workspace.id, workspaceRoot.value ?? undefined);
});

onBeforeUnmount(async () => {
  // WorkspaceHost is unmounted when its workspace is removed from the store
  // (MainApp renders via `v-for` + `:key="ws.id"`). This is the single place
  // that must reclaim this workspace's resources, in order:
  //   1. FS watcher
  //   2. Background task processes (kill + clear poll timers)
  //   3. Terminal PTY sessions + tab state (disposeWorkspaceTabs internally
  //      calls disposeWorkspaceSessions(id))
  stopWorkspaceLifecycle();
  await taskConsole.disposeTaskConsole();
  tabs.disposeWorkspaceTabs(props.workspace.id);
});

// ── Command system ──────────────────────────────────────────────────────
// The workbench command registry (⌘K palette + global keybindings) is wired
// here because every option it needs (git ops via wsNative, editor actions,
// tab state) is workspace-scoped. MainApp renders the palette overlay and
// binds the global keydown listener, delegating execution to the *active*
// host via the exposed `commandApi`.
const dialog = useDialog();

function requestCloseTab(id: number): void {
  const tab = tabs.workspaceTabs(props.workspace.id).find((tk) => tk.id === id);
  if (!tab) return;
  if (!isDirtyEditorTab(tab)) {
    tabs.closeTab(id, props.workspace.id);
    return;
  }
  const warning = dialog.warning({
    title: t("app.unsaved.closeFileTitle"),
    content: t("app.unsaved.closeFileContent", {
      files: tab.path.split(/[\\/]/).pop() ?? tab.path,
    }),
    positiveText: t("app.unsaved.closeWithoutSaving"),
    negativeText: t("common.cancel"),
    onPositiveClick: () => {
      tabs.closeTab(id, props.workspace.id);
      warning.destroy();
    },
  });
}

const commandApi = useWorkbenchCommands({
  t: tLoose,
  keybindings: computed(() => prefs.keybindings ?? {}),
  hasWorkspace: computed(() => true),
  workspaceRoot,
  activeRepoRoot,
  activeTab,
  // 命令系统把 leftPanelOpen 当作"源控面板可见",rightPanelOpen 当作
  // "文件树面板可见";新壳层里它们就是两个浮层 ref。
  leftPanelOpen: sourceControlOpen,
  rightPanelOpen: explorerOpen,
  workspaceFsEvent,
  openBranchesModal: showBranchesModal,
  tabs,
  newTerminalTab,
  splitActivePane,
  openFileTab,
  openSettings: (tab?: SettingsTab) => emit("request-settings", tab),
  openTaskConsole: () => {
    void taskConsole.openTaskConsole();
  },
  requestCloseTab,
  saveActiveEditor,
  openGotoLine,
  openFindInFiles,
  openCommandPalette: (mode) => emit("request-command-palette", mode),
  openUrlPreview,
  openRenameDialog: (leafId, currentTitle) =>
    emit("request-rename", { leafId, currentTitle }),
  killActiveTerminal,
  resolveGitRepo: (root: string) => wsNative.gitResolveRepo(root),
  gitStatus: (repoRoot: string) => wsNative.gitStatus(repoRoot),
  gitStage: (repoRoot: string, paths: string[]) => wsNative.gitStage(repoRoot, paths),
  gitUnstage: (repoRoot: string, paths: string[]) => wsNative.gitUnstage(repoRoot, paths),
  gitFetch: (repoRoot: string) => wsNative.gitFetch(repoRoot),
  gitPullFfOnly: (repoRoot: string) => wsNative.gitPullFfOnly(repoRoot),
  gitPush: (repoRoot: string) => wsNative.gitPush(repoRoot),
  gitBranchList: (repoRoot: string) => wsNative.gitBranchList(repoRoot),
  gitCheckoutBranch: (repoRoot: string, branch: string, remote: boolean) =>
    wsNative.gitCheckoutBranch(repoRoot, branch, remote),
  gitCreateBranch: (repoRoot: string, branch: string) =>
    wsNative.gitCreateBranch(repoRoot, branch),
  gitStashList: (repoRoot: string) => wsNative.gitStashList(repoRoot),
  gitStashPush: (repoRoot: string, options) => wsNative.gitStashPush(repoRoot, options),
  gitStashPop: (repoRoot: string, selector: string) =>
    wsNative.gitStashPop(repoRoot, selector),
});

// Re-expose the workbench-bound actions so MainApp's command system can reach
// them for the *active* workspace. MainApp finds the active WorkspaceHost via
// the workspaces store + a ref map.
defineExpose({
  saveActiveEditor,
  openGotoLine,
  openFindInFiles,
  killActiveTerminal,
  workspaceId,
  commandApi,
  // 暴露 taskConsole 控制器,供 MainApp 联动活动工作区。
  taskConsole: {
    open: () => void taskConsole.openTaskConsole(),
    close: () => taskConsole.closeTaskConsole(),
    isOpen: taskConsole.taskConsoleOpen,
  },
});
</script>

<template>
  <div
    class="flex h-full min-h-0 bg-shell-bg"
    :data-workspace-id="workspace.id"
  >
    <Rail
      :workspaces="workspaces.workspaces"
      :active-workspace-id="workspaces.activeWorkspaceId"
      :explorer-open="explorerOpen"
      :source-control-open="sourceControlOpen"
      :tasks-open="taskConsole.taskConsoleOpen.value"
      @select-workspace="(id) => workspaces.setActive(id)"
      @close-workspace="(id) => emit('request-remove-workspace', id)"
      @add-workspace="(env) => emit('add-workspace', env)"
      @open-workspace-in-new-window="openThisWorkspaceInNewWindow"
      @toggle-tool="handleToggleTool"
      @open-settings="() => emit('request-settings')"
      @open-command-palette="() => emit('request-command-palette', 'commands')"
    />

    <div class="flex min-w-0 flex-1 flex-col">
      <TopBar
        :workspace-name="workspace.name"
        :workspace-path="workspace.rootPath"
        :env="workspace.env"
        :git-branch="gitBranch"
        :show-window-controls="USE_CUSTOM_WINDOW_CONTROLS"
        :can-split="canSplitActiveTab"
        @new-terminal="newTerminalTab"
        @split-pane="splitActivePane"
        @open-command-palette="() => emit('request-command-palette', 'commands')"
        @open-settings="() => emit('request-settings')"
      >
        <template #center>
          <SessionStrip
            :tabs="tabs.workspaceTabs(workspace.id)"
            :active-id="tabs.activeIdByWorkspace[workspace.id] ?? 0"
            :width-mode="prefs.tabWidthMode"
            :fixed-width="prefs.tabFixedWidth"
            @select-tab="(id) => tabs.setActiveId(id, workspace.id)"
            @close-tab="(id) => tabs.closeTab(id, workspace.id)"
            @close-others="(id) => tabs.closeOthers(id, workspace.id)"
            @close-to-right="(id) => tabs.closeToRight(id, workspace.id)"
            @close-all="tabs.closeAll(workspace.id)"
            @duplicate-terminal="duplicateTerminalTab"
            @rename-tab="renameTabTitle"
            @request-rename="requestTabRename"
            @pin-tab="(id) => tabs.pinTab(id, workspace.id)"
            @reorder-tab="(sourceId, targetId, placement) => tabs.moveTab(sourceId, targetId, placement, workspace.id)"
          />
        </template>
      </TopBar>

      <Canvas
        ref="canvas"
        :active-id="tabs.activeIdByWorkspace[workspace.id] ?? 0"
        :active-repo-root="activeRepoRoot"
        :active-tab="activeTab"
        :git-decorations="gitDecorations"
        :show-branches-modal="showBranchesModalProp"
        :tabs="tabs.workspaceTabs(workspace.id)"
        :tabs-store="{
          focusPane: (tabId, leafId) => tabs.focusPane(tabId, leafId, workspace.id),
          openCommitFileDiffTab: (input) => tabs.openCommitFileDiffTab(input, workspace.id),
          setLeafCwd: (leafId, cwd) => tabs.setLeafCwd(leafId, cwd, workspace.id),
          setLeafTitle: (leafId, titleVal) => tabs.setLeafTitle(leafId, titleVal, workspace.id),
          updateTab: (id, patch) => tabs.updateTab(id, patch, workspace.id),
        }"
        :task-console="taskConsole"
        :workspace-fs-event="normalizedFsEvent"
        :workspace-id="workspace.id"
        :workspace-root="workspaceRoot"
        :workspace-scope="workspaceScope"
        :explorer-open="explorerOpen"
        :source-control-open="sourceControlOpen"
        :explorer-width="explorerWidth"
        :source-control-width="sourceControlWidth"
        @open-file="openFileTab"
        @open-markdown-preview="openMarkdownPreview"
        @open-file-preview="openFilePreview"
        @open-in-terminal="openTerminalInDir"
        @open-search-result="openSearchResult"
        @open-source-diff="openSourceDiff"
        @open-source-history="openSourceHistory"
        @history-ref-change="onHistoryRefChange"
        @repo-selected="(repoRoot) => activeRepoRoot = repoRoot"
        @branch-change="(branch) => gitBranch = branch"
        @decorations-change="onDecorationChange"
        @update:explorer-open="setExplorerOpen"
        @update:source-control-open="setSourceControlOpen"
        @resize-explorer-width="(w) => persistWidth('explorer', w)"
        @resize-source-control-width="(w) => persistWidth('sourceControl', w)"
      />

      <StatusDock
        :workspace-name="workspace.name"
        :env="workspace.env"
        :git-branch="gitBranch"
        :running-tasks="runningTaskCount"
      />
    </div>
  </div>
</template>
