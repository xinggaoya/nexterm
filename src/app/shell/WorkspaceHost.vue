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
 * This component owns:
 *   - the env-bound `wsNative` surface (created once from `workspace.env`)
 *   - the WorkspaceContext provided to all descendants via inject
 *   - the per-workspace FS watcher lifecycle
 *   - the per-workspace task console controller
 *   - the per-workspace command wiring forwarded to Workbench
 *
 * It does NOT own global shell concerns (title bar, status bar, workspace
 * bar, settings drawer) — those live in MainApp and read the *active*
 * workspace from the workspaces store.
 */
import { computed, h, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { useDialog, NInput } from "naive-ui";
import { createNativeForEnv, type WorkspaceFsChangedEvent } from "@/lib/native";
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
import LeftSidebar from "./LeftSidebar.vue";
import TabBar from "./TabBar.vue";
import Workbench from "./Workbench.vue";
import { useWorkbenchLayout } from "@/app/useWorkbenchLayout";
import { useWorkspacesPiniaStore } from "@/modules/workspace/workspacesPinia";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";

const props = defineProps<{
  workspace: WorkspaceInstance;
}>();

const emit = defineEmits<{
  "add-workspace": [env: WorkspaceEnv];
  "open-in-new-window": [];
  "request-settings": [];
  "request-command-palette": [mode?: "commands" | "files"];
  "request-rename": [payload: { leafId: number; currentTitle: string }];
  "branch-change": [workspaceId: string, branch: string | null];
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

// Layout is shared from prefs (global panel widths). Each workspace gets its
// own layout binding instance so panel open/close state is independent.
const workbenchLayout = useWorkbenchLayout({ prefs });

const activeTab = computed<Tab | null>(
  () => tabs.workspaceTabs(props.workspace.id).find((tab) => tab.id === tabs.activeIdByWorkspace[props.workspace.id]) ?? null,
);
const activeRepoRoot = ref<string | null>(null);
// 源控面板上抛的 git 角标（path → 变更状态），透传给 Workbench →
// FileExplorer 渲染文件树角标。面板 v-show 隐藏时仍保持挂载，数据持续更新。
const gitDecorations = ref<GitDecorationMap>(new Map());
function onDecorationChange(decorations: GitDecorationMap): void {
  gitDecorations.value = decorations;
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
    if (workbench.value?.revealEditorLine?.(path, line)) return;
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

const workbench = ref<InstanceType<typeof Workbench> | null>(null);

async function saveActiveEditor(): Promise<void> {
  await workbench.value?.saveActiveEditor();
}

function openGotoLine(): void {
  workbench.value?.openGotoLine?.();
}

function openFindInFiles(): void {
  workbench.value?.openFindInFiles?.();
}

async function killActiveTerminal(): Promise<void> {
  const tab = activeTab.value;
  if (tab?.kind !== "terminal") return;
  await workbench.value?.killTerminal(tab.activeLeafId);
}

const showBranchesModal = ref(false);
// Workbench types this prop as Ref<boolean>; a template binding auto-unwraps
// refs to plain values, so we bridge via a computed that keeps the ref shape.
const showBranchesModalProp = computed(() => showBranchesModal);

// useWorkspaceLifecycle 的 fsEvent 类型含 undefined，模板绑定前归一为
// null，避免在模板里做 as unknown as 强转。
const normalizedFsEvent = computed<WorkspaceFsChangedEvent | null>(
  () => workspaceFsEvent.value ?? null,
);

// TabBar 右键菜单的"重命名终端标题"：复用 MainApp 的 RenameTerminalDialog
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
 * Workspace 切回可见时的"立即激活"编排。
 *
 * 用户报告:切换终端或项目后切换回去,发现字段内容清空、只有新内容
 * 出现才会有内容。这是三类延迟叠加导致的:
 *   1. Rust 端 FS watcher 200ms 批窗口 — 切走期间的累积事件要等窗口
 *      满才 emit 到 webview
 *   2. 前端 FileExplorer 180ms 防抖 — fsEvent 触发后还要等 180ms 才
 *      调 loadChildren
 *   3. 终端 xterm rAF 批 — PTY 数据在 rAF 边界才写入 buffer
 *
 * 关键:flush 链路是 fire-and-forget IPC,await forceFlushNow 也不能保
 * 证 batcher 已经 emit + watch(fsEvent) 已经触发 + FileExplorer 已经
 * 把 path 加入 pendingFsEventPaths。这里不等 forceFlush 完成,而是**直
 * 接主动重读根+展开节点**(用户可见状态),保证切回时立即是最新;同
 * 时把 forceFlushNow 抛到后台,180ms 防抖后续自然再补一次,重复读由
 * inFlightLoads + 防抖合并吃掉。
 */
function onWorkspaceActivated(): void {
  // 1) FileExplorer 立即激活:同步重读根+展开节点,不依赖 fsEvent
  workbench.value?.activateExplorer?.();
  // 2) 后端 batcher 立即 emit 累积 batch(fire-and-forget)
  forceFlushNow();
  // 3) source-control 立即补一次(切走期间状态可能陈旧)
  void workbench.value?.refreshSourceControlOnActivate?.();
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
  workbenchLayout.startLayoutObservers();
});

onBeforeUnmount(async () => {
  // WorkspaceHost is unmounted when its workspace is removed from the store
  // (MainApp renders via `v-for` + `:key="ws.id"`). This is the single place
  // that must reclaim this workspace's resources, in order:
  //   1. FS watcher (already correct)
  //   2. Background task processes (kill + clear poll timers)
  //   3. Terminal PTY sessions + tab state (disposeWorkspaceTabs internally
  //      calls disposeWorkspaceSessions(id), closing every backend PTY for
  //      this workspace and clearing the tabsByWorkspace maps)
  stopWorkspaceLifecycle();
  await taskConsole.disposeTaskConsole();
  tabs.disposeWorkspaceTabs(props.workspace.id);
  workbenchLayout.stopLayoutObservers();
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
  // Panel open/closed state lives in the shared panel-visibility store so
  // title-bar toggles reach this host. We pass the store's writable refs
  // (not the workbench layout's readonly computed wrappers).
  leftPanelOpen: workbenchLayout.leftPanelOpenRef,
  rightPanelOpen: workbenchLayout.rightPanelOpenRef,
  workspaceFsEvent,
  openBranchesModal: showBranchesModal,
  tabs,
  newTerminalTab,
  splitActivePane,
  openFileTab,
  openSettings: () => emit("request-settings"),
  openTaskConsole: () => {
    workbenchLayout.panelVisibility.value.taskConsole = true;
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
// the workspaces store + a ref map; for now these are internal.
defineExpose({
  saveActiveEditor,
  openGotoLine,
  openFindInFiles,
  killActiveTerminal,
  workspaceId,
  commandApi,
  // 暴露 taskConsole 控制器，供 MainApp 的底部栏 taskConsole 按钮联动活动工作区。
  taskConsole: {
    open: () => void taskConsole.openTaskConsole(),
    close: () => taskConsole.closeTaskConsole(),
    isOpen: taskConsole.taskConsoleOpen,
  },
});
</script>

<template>
  <div
    class="flex min-h-0 flex-1 gap-1 bg-shell-bg p-1"
    :data-workspace-id="workspace.id"
  >
    <LeftSidebar
      :activity="workbenchLayout.leftSidebar.value.activity"
      :open="workbenchLayout.leftSidebar.value.open"
      :width="workbenchLayout.leftSidebar.value.width"
      :min-width="workbenchLayout.leftSidebarWidthMin"
      :max-width="workbenchLayout.leftSidebarWidthMax"
      :workspace="workspace"
      :active-repo-root="activeRepoRoot"
      :fs-event="workspaceFsEvent"
      :show-branches-modal="showBranchesModalProp"
      @select-activity="(k) => workbenchLayout.setLeftSidebarActivity(k)"
      @toggle-left-sidebar="() => workbenchLayout.toggleLeftSidebar()"
      @add-workspace="(env) => emit('add-workspace', env)"
      @open-in-new-window="emit('open-in-new-window')"
      @select-workspace="(id) => workspaces.setActive(id)"
      @close-workspace="(id) => workspaces.removeWorkspace(id)"
      @resize-width="(w) => workbenchLayout.setLeftSidebarWidth(w)"
      @open-diff="openSourceDiff"
      @open-history="openSourceHistory"
      @repo-selected="(repoRoot) => activeRepoRoot = repoRoot"
      @decoration-change="onDecorationChange"
      @branch-change="(branch) => emit('branch-change', workspace.id, branch)"
    />

    <div class="flex min-w-0 flex-1 flex-col">
      <main class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Workbench
          ref="workbench"
          :active-id="tabs.activeIdByWorkspace[workspace.id] ?? 0"
          :active-repo-root="activeRepoRoot"
          :active-tab="activeTab"
          :layout="workbenchLayout"
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
          :git-decorations="gitDecorations"
          :workspace-fs-event="normalizedFsEvent"
          :workspace-root="workspaceRoot"
          :workspace-scope="workspaceScope"
          @open-file="openFileTab"
          @open-markdown-preview="openMarkdownPreview"
          @open-file-preview="openFilePreview"
          @open-in-terminal="openTerminalInDir"
          @open-search-result="openSearchResult"
          @open-source-diff="openSourceDiff"
          @open-source-history="openSourceHistory"
          @history-ref-change="onHistoryRefChange"
          @repo-selected="(repoRoot) => activeRepoRoot = repoRoot"
        >
          <template #tab-bar>
            <TabBar
              :tabs="tabs.workspaceTabs(workspace.id)"
              :active-id="tabs.activeIdByWorkspace[workspace.id] ?? 0"
              :can-split="canSplitActiveTab"
              :show-actions="true"
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
              @new-tab="newTerminalTab"
              @split-pane="splitActivePane"
            />
          </template>
        </Workbench>
      </main>
    </div>
  </div>
</template>
