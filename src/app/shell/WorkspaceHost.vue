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
import { leafIds, type SplitDir } from "@/modules/terminal/lib/layout";
import { MAX_PANES_PER_TAB } from "@/modules/tabs/tabsTypes";
import {
  provideWorkspaceContext,
} from "@/app/workspaceContext";
import { useWorkspaceLifecycle } from "@/app/useWorkspaceLifecycle";
import { useTaskConsoleController } from "@/app/useTaskConsoleController";
import { readEditorDocument } from "@/modules/editor/lib/documentService";
import TabBar from "./TabBar.vue";
import Workbench from "./Workbench.vue";
import { useWorkbenchLayout } from "@/app/useWorkbenchLayout";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";

const props = defineProps<{
  workspace: WorkspaceInstance;
}>();

const prefs = usePreferencesPiniaStore();
const tabs = useTabsPiniaStore();

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

// Re-expose the workbench-bound actions so MainApp's command system can reach
// them for the *active* workspace. MainApp finds the active WorkspaceHost via
// the workspaces store + a ref map; for now these are internal.
defineExpose({
  saveActiveEditor,
  openGotoLine,
  openFindInFiles,
  killActiveTerminal,
  workspaceId,
});
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col" :data-workspace-id="workspace.id">
    <TabBar
      :tabs="tabs.workspaceTabs(workspace.id)"
      :active-id="tabs.activeIdByWorkspace[workspace.id] ?? 0"
      :can-split="canSplitActiveTab"
      :show-actions="true"
      :workspace-root="workspaceRoot"
      @select-tab="(id) => tabs.setActiveId(id, workspace.id)"
      @close-tab="(id) => tabs.closeTab(id, workspace.id)"
      @close-others="(id) => tabs.closeOthers(id, workspace.id)"
      @close-to-right="(id) => tabs.closeToRight(id, workspace.id)"
      @close-all="tabs.closeAll(workspace.id)"
      @duplicate-terminal="duplicateTerminalTab"
      @rename-tab="renameTabTitle"
      @request-rename="() => {}"
      @pin-tab="(id) => tabs.pinTab(id, workspace.id)"
      @copy-path="() => {}"
      @copy-relative-path="() => {}"
      @move-to-new-window="() => {}"
      @reorder-tab="(sourceId, targetId, placement) => tabs.moveTab(sourceId, targetId, placement, workspace.id)"
      @new-tab="newTerminalTab"
      @split-pane="splitActivePane"
    />
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
      />
    </main>
  </div>
</template>
