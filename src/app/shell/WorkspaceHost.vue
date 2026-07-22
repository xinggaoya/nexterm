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
import { computed, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { createNativeForEnv, type WorkspaceFsChangedEvent } from "@/lib/native";
import { workspaceScopeKey } from "@/modules/workspace";
import type { WorkspaceInstance } from "@/modules/workspace/workspacesPinia";
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
import { useDialog } from "naive-ui";
import { readEditorDocument } from "@/modules/editor/lib/documentService";
import { t } from "@/modules/i18n/translate";
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
  "add-workspace": [];
  "open-in-new-window": [];
  "request-settings": [];
  "request-command-palette": [mode?: "commands" | "files"];
  "request-rename": [payload: { leafId: number; currentTitle: string }];
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
  const shouldPin = pin || prefs.fileOpenMode === "pinned";
  tabs.openFileTab(path, props.workspace.id, shouldPin);
  void prefs.recordOpenedFile(path);
}

function openMarkdownPreview(path: string): void {
  tabs.newMarkdownTab(path, props.workspace.id);
}

function openSearchResult(path: string, _line: number): void {
  tabs.openFileTab(path, props.workspace.id, true);
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
  branch?: string | null;
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

// Watch active tab changes to surface git branch in the status bar (read by
// MainApp via the workspaces store's active workspace). We keep a local ref
// and let MainApp derive from whatever workspace is active.
watch(activeTab, () => {
  // No-op placeholder — git branch resolution is handled by the
  // source-control panel which writes decorations. Branch display in the
  // status bar reads from the active workspace's source-control state.
});

onMounted(() => {
  void startWorkspaceLifecycle();
  // Ensure this workspace has at least one tab (a fresh terminal). Safe to
  // call repeatedly — initWorkspace is idempotent.
  tabs.initWorkspace(props.workspace.id, workspaceRoot.value ?? undefined);
  workbenchLayout.startLayoutObservers();
});

onBeforeUnmount(() => {
  stopWorkspaceLifecycle();
  taskConsole.disposeTaskConsole();
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
  t: (key: string, vars?: Record<string, unknown>) => t(key, vars),
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
  },
  requestCloseTab,
  saveActiveEditor,
  openGotoLine,
  openFindInFiles,
  openCommandPalette: (mode) => emit("request-command-palette", mode),
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
});
</script>

<template>
  <div class="flex min-h-0 flex-1" :data-workspace-id="workspace.id">
    <LeftSidebar
      :activity="workbenchLayout.leftSidebar.value.activity"
      :open="workbenchLayout.leftSidebar.value.open"
      :width="workbenchLayout.leftSidebar.value.width"
      :min-width="216"
      :max-width="420"
      :workspace="workspace"
      :active-repo-root="activeRepoRoot"
      :fs-event="workspaceFsEvent"
      :show-branches-modal="showBranchesModalProp"
      @select-activity="(k) => workbenchLayout.setLeftSidebarActivity(k)"
      @add-workspace="emit('add-workspace')"
      @open-in-new-window="emit('open-in-new-window')"
      @select-workspace="(id) => workspaces.setActive(id)"
      @close-workspace="(id) => workspaces.removeWorkspace(id)"
      @resize-width="(w) => workbenchLayout.setLeftSidebarWidth(w)"
      @open-diff="openSourceDiff"
      @open-history="openSourceHistory"
      @repo-selected="(repoRoot) => activeRepoRoot = repoRoot"
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
          :workspace-fs-event="workspaceFsEvent as unknown as WorkspaceFsChangedEvent | null"
          :workspace-root="workspaceRoot"
          :workspace-scope="workspaceScope"
          @open-file="openFileTab"
          @open-markdown-preview="openMarkdownPreview"
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
              @select-tab="(id) => tabs.setActiveId(id, workspace.id)"
              @close-tab="(id) => tabs.closeTab(id, workspace.id)"
              @close-others="(id) => tabs.closeOthers(id, workspace.id)"
              @close-to-right="(id) => tabs.closeToRight(id, workspace.id)"
              @close-all="tabs.closeAll(workspace.id)"
              @duplicate-terminal="duplicateTerminalTab"
              @rename-tab="renameTabTitle"
              @request-rename="() => {}"
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
