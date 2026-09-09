<script setup lang="ts">
import { computed, defineAsyncComponent, ref, type ComputedRef, type Ref } from "vue";
import { native, type GitCommitResult, type WorkspaceFsChangedEvent } from "@/lib/native";
import { getPtyIdForLeaf, TerminalWorkspace, disposeSession } from "@/modules/terminal";
import { tryWorkspaceContext } from "@/app/workspaceContext";
import { t } from "@/modules/i18n/translate";
const EditorPane = defineAsyncComponent(() => import("@/modules/editor/EditorPane.vue"));
import GitDiffStack from "@/modules/editor/GitDiffStack.vue";
import FileExplorer from "@/modules/explorer/FileExplorer.vue";
import GitHistoryStack from "@/modules/git-history/GitHistoryStack.vue";
import MarkdownStack from "@/modules/markdown/MarkdownStack.vue";
import PreviewStack from "@/modules/preview/PreviewStack.vue";
import FilePreviewStack from "@/modules/file-preview/FilePreviewStack.vue";
import type { GitDecorationMap } from "@/modules/source-control";
import SourceControlPanel from "@/modules/source-control/SourceControlPanel.vue";
import type { TaskRun, TaskRunGroup } from "@/modules/tasks";
import TaskConsole from "@/modules/tasks/TaskConsole.vue";
import type { TaskConsoleView } from "@/modules/tasks/taskConsoleTypes";
import type { WorkspaceTask } from "@/modules/tasks/taskTypes";
import type { Tab, TerminalTab } from "@/modules/tabs/tabsTypes";
import OverlayPanel from "./OverlayPanel.vue";

type TaskConsoleBinding = {
  activeTaskRun: ComputedRef<TaskRun | null> | Ref<TaskRun | null>;
  closeTaskConsole: () => void;
  refreshWorkspaceTasks: () => void | Promise<void>;
  runTaskInTerminal: (input: { command: string; cwd: string }) => void;
  runWorkspaceCommand: (command: string) => void | Promise<void>;
  runWorkspaceTask: (task: WorkspaceTask) => void | Promise<void>;
  taskConsoleOpen: Ref<boolean>;
  taskConsoleView: Ref<TaskConsoleView>;
  taskRunList: ComputedRef<TaskRun[]> | Ref<TaskRun[]>;
  taskRuns: {
    rerun: (id: number) => void | Promise<unknown>;
    runGroups: Ref<TaskRunGroup[]>;
    setActiveRun: (id: number) => void;
    stopRun: (id: number) => void | Promise<unknown>;
    stopRunGroup: (id: number) => void | Promise<unknown>;
  };
  setTaskConsoleView: (view: TaskConsoleView) => void;
  workspaceTasks: Ref<WorkspaceTask[]>;
  workspaceTasksError: Ref<string | null>;
  workspaceTasksLoading: Ref<boolean>;
};

type TabsStoreBinding = {
  focusPane: (tabId: number, leafId: number) => void;
  openCommitFileDiffTab: (input: {
    repoRoot: string;
    sha: string;
    shortSha: string;
    subject: string;
    path: string;
    originalPath: string | null;
  }) => void;
  setLeafCwd: (leafId: number, cwd: string) => void;
  setLeafTitle: (leafId: number, title: string) => void;
  updateTab: (id: number, patch: { url?: string; dirty?: boolean }) => void;
};

const props = defineProps<{
  activeId: number;
  activeRepoRoot: string | null;
  activeTab: Tab | null;
  gitDecorations: GitDecorationMap;
  showBranchesModal: Ref<boolean>;
  tabs: Tab[];
  tabsStore: TabsStoreBinding;
  taskConsole: TaskConsoleBinding;
  workspaceFsEvent: WorkspaceFsChangedEvent | null;
  workspaceId: string;
  workspaceRoot: string | null;
  workspaceScope: string;
  explorerOpen: boolean;
  sourceControlOpen: boolean;
  explorerWidth: number;
  sourceControlWidth: number;
}>();

const emit = defineEmits<{
  "open-file": [path: string, pin: boolean];
  "open-markdown-preview": [path: string];
  "open-file-preview": [path: string];
  "open-in-terminal": [path: string];
  "open-search-result": [path: string, line: number];
  "open-source-diff": [
    input: {
      repoRoot: string;
      path: string;
      mode: "-" | "+";
      originalPath: string | null;
      title?: string;
    },
  ];
  "open-source-history": [
    input: {
      repoRoot: string;
      refName?: string | null;
      allRefs?: boolean;
    },
  ];
  "history-ref-change": [
    input: { tabId: number; refName: string | null; allRefs: boolean },
  ];
  "repo-selected": [repoRoot: string | null];
  "branch-change": [branch: string | null];
  "decorations-change": [decorations: GitDecorationMap];
  "committed": [result: GitCommitResult];
  "update:explorerOpen": [open: boolean];
  "update:sourceControlOpen": [open: boolean];
  "resize-explorer-width": [width: number];
  "resize-source-control-width": [width: number];
}>();

const activeEditorPane = ref<InstanceType<typeof EditorPane> | null>(null);
const fileExplorerRef = ref<InstanceType<typeof import("@/modules/explorer/FileExplorer.vue").default> | null>(null);

function isActiveKind(kind: Tab["kind"]): boolean {
  return props.activeTab?.kind === kind;
}

function isActiveGitDiff(): boolean {
  return (
    props.activeTab?.kind === "git-diff" ||
    props.activeTab?.kind === "git-commit-file"
  );
}

function handleHistoryRefChange(input: {
  tabId: number;
  refName: string | null;
  allRefs: boolean;
}) {
  emit("history-ref-change", input);
}

async function saveActiveEditor() {
  await activeEditorPane.value?.save();
}

function openGotoLine() {
  activeEditorPane.value?.openGotoLine();
}

function openFindInFiles() {
  fileExplorerRef.value?.setMode("content");
}

function flushPendingExplorerRefresh(): void {
  // workspace 切回时调:取消 FileExplorer 内部的 180ms 防抖,立即执行
  // pending 的 loadChildren 队列。
  fileExplorerRef.value?.flushPendingTreeRefresh();
}

function activateExplorer(): void {
  // 切回时立即主动重读根+展开节点(不等 fsEvent 到达)。
  fileExplorerRef.value?.activate();
}

function refreshSourceControlOnActivate(): void {
  // 切回时让 source-control 立即重跑一次 git status。通过约定的 custom
  // event 通知 SourceControlPanel(detail.workspaceId 做多工作区过滤),
  // 避免在 Canvas 里直接持有它的 ref。
  const wsId = tryWorkspaceContext()?.workspace.id;
  if (!wsId) return;
  window.dispatchEvent(
    new CustomEvent("nexterm:workspace-activated", { detail: { workspaceId: wsId } }),
  );
}

async function killTerminal(leafId: number) {
  const wsId = tryWorkspaceContext()?.workspace.id ?? "";
  const ptyId = getPtyIdForLeaf(wsId, leafId);
  if (ptyId === null) {
    disposeSession(wsId, leafId.toString());
    return;
  }
  try {
    await native.ptyKill(ptyId);
  } catch (error) {
    console.warn("killTerminal failed", error);
  }
}

const terminalTabs = computed<TerminalTab[]>(() =>
  props.tabs.filter((tab): tab is TerminalTab => tab.kind === "terminal"),
);

/** Find in Files 跳转:仅当活动 tab 正是该文件且编辑器已挂载时生效。 */
function revealEditorLine(path: string, line: number): boolean {
  if (!props.activeTab || props.activeTab.kind !== "editor") return false;
  if (props.activeTab.path !== path) return false;
  if (!activeEditorPane.value) return false;
  activeEditorPane.value.revealLine(line);
  return true;
}

defineExpose({
  saveActiveEditor,
  openGotoLine,
  openFindInFiles,
  revealEditorLine,
  killTerminal,
  flushPendingExplorerRefresh,
  activateExplorer,
  refreshSourceControlOnActivate,
});
</script>

<template>
  <div
    class="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-background"
    data-canvas
  >
    <!-- ── Tab 内容层:全部常驻挂载,按活动 tab 切换可见性 ───────────── -->
    <div
      :class="[
        'absolute inset-0',
        isActiveKind('terminal') ? '' : 'pointer-events-none invisible',
      ]"
      :aria-hidden="!isActiveKind('terminal')"
    >
      <div
        v-for="terminalTab in terminalTabs"
        v-show="terminalTab.id === activeId"
        :key="terminalTab.id"
        class="absolute inset-0"
      >
        <TerminalWorkspace
          :tab="terminalTab"
          :is-active="isActiveKind('terminal') && terminalTab.id === activeId"
        />
      </div>
    </div>

    <div
      :class="[
        'absolute inset-0',
        isActiveKind('preview') ? '' : 'pointer-events-none invisible',
      ]"
      :aria-hidden="!isActiveKind('preview')"
    >
      <PreviewStack
        :tabs="tabs"
        :active-id="activeId"
        @url-change="(id, url) => tabsStore.updateTab(id, { url })"
      />
    </div>

    <div
      :class="[
        'absolute inset-0',
        isActiveKind('markdown') ? '' : 'pointer-events-none invisible',
      ]"
      :aria-hidden="!isActiveKind('markdown')"
    >
      <MarkdownStack :tabs="tabs" :active-id="activeId" />
    </div>

    <div
      :class="[
        'absolute inset-0',
        isActiveKind('file-preview') ? '' : 'pointer-events-none invisible',
      ]"
      :aria-hidden="!isActiveKind('file-preview')"
    >
      <FilePreviewStack :tabs="tabs" :active-id="activeId" />
    </div>

    <div
      :class="[
        'absolute inset-0',
        isActiveGitDiff() ? '' : 'pointer-events-none invisible',
      ]"
      :aria-hidden="!isActiveGitDiff()"
    >
      <GitDiffStack :tabs="tabs" :active-id="activeId" />
    </div>

    <div
      :class="[
        'absolute inset-0',
        isActiveKind('git-history') ? '' : 'pointer-events-none invisible',
      ]"
      :aria-hidden="!isActiveKind('git-history')"
    >
      <GitHistoryStack
        :tabs="tabs"
        :active-id="activeId"
        @open-commit-file="(input) => tabsStore.openCommitFileDiffTab(input)"
        @change-ref="handleHistoryRefChange"
      />
    </div>

    <div
      v-if="activeTab && activeTab.kind === 'editor'"
      class="absolute inset-0 flex min-h-0 flex-col bg-background"
      :class="isActiveKind('editor') ? '' : 'pointer-events-none invisible'"
      :aria-hidden="!isActiveKind('editor')"
    >
      <EditorPane
        ref="activeEditorPane"
        :path="activeTab.path"
        :fs-event="workspaceFsEvent"
        @dirty-change="(dirty) => tabsStore.updateTab(activeTab!.id, { dirty })"
      />
    </div>

    <!-- ── 玻璃浮层:覆盖画布,不改变其布局 ────────────────────────── -->
    <OverlayPanel
      v-show="explorerOpen"
      :title="t('app.rail.tool.explorer')"
      placement="left"
      :width="explorerWidth"
      @close="emit('update:explorerOpen', false)"
      @resize-width="(w) => emit('resize-explorer-width', w)"
    >
      <FileExplorer
        ref="fileExplorerRef"
        :root-path="workspaceRoot"
        :fs-event="workspaceFsEvent"
        :git-decorations="gitDecorations"
        @open-file="(path, pin) => emit('open-file', path, pin)"
        @open-markdown-preview="(path) => emit('open-markdown-preview', path)"
        @open-in-terminal="(path) => emit('open-in-terminal', path)"
        @open-search-result="(path, line) => emit('open-search-result', path, line)"
      />
    </OverlayPanel>

    <OverlayPanel
      v-show="sourceControlOpen"
      :title="t('app.rail.tool.sourceControl')"
      placement="left"
      :width="sourceControlWidth"
      @close="emit('update:sourceControlOpen', false)"
      @resize-width="(w) => emit('resize-source-control-width', w)"
    >
      <SourceControlPanel
        :root-path="workspaceRoot"
        :workspace-scope="workspaceScope"
        :active-repo-root="activeRepoRoot"
        :fs-event="workspaceFsEvent"
        :show-branches-modal="showBranchesModal"
        :workspace-id="workspaceId"
        @open-diff="(input) => emit('open-source-diff', input)"
        @open-history="(input) => emit('open-source-history', input)"
        @repo-selected="(repoRoot) => emit('repo-selected', repoRoot)"
        @decorations-change="(d) => emit('decorations-change', d)"
        @branch-change="(branch) => emit('branch-change', branch)"
        @committed="(result) => emit('committed', result)"
      />
    </OverlayPanel>

    <OverlayPanel
      v-show="taskConsole.taskConsoleOpen.value"
      :title="t('app.rail.tool.tasks')"
      placement="bottom"
      :show-header="false"
      :height="300"
    >
      <TaskConsole
        class="h-full"
        :root-path="workspaceRoot"
        :view="taskConsole.taskConsoleView.value"
        :tasks="taskConsole.workspaceTasks.value"
        :runs="taskConsole.taskRunList.value"
        :active-run="taskConsole.activeTaskRun.value"
        :loading-tasks="taskConsole.workspaceTasksLoading.value"
        :task-error="taskConsole.workspaceTasksError.value"
        @close="taskConsole.closeTaskConsole"
        @update-view="taskConsole.setTaskConsoleView"
        @refresh-tasks="taskConsole.refreshWorkspaceTasks"
        @run-task="taskConsole.runWorkspaceTask"
        @run-command="taskConsole.runWorkspaceCommand"
        @select-run="taskConsole.taskRuns.setActiveRun"
        @stop-run="(id) => void taskConsole.taskRuns.stopRun(id)"
        @rerun="(id) => void taskConsole.taskRuns.rerun(id)"
        @run-in-terminal="taskConsole.runTaskInTerminal"
      />
    </OverlayPanel>
  </div>
</template>
