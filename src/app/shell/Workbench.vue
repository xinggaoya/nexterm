<script setup lang="ts">
import { ref, computed, onBeforeUnmount, type ComputedRef, type Ref } from "vue";
import { NSplit } from "naive-ui";
import { native, type WorkspaceFsChangedEvent } from "@/lib/native";
import { getPtyIdForLeaf, TerminalWorkspace, disposeSession } from "@/modules/terminal";
import { tryWorkspaceContext } from "@/app/workspaceContext";
import EditorPane from "@/modules/editor/EditorPane.vue";
import GitDiffStack from "@/modules/editor/GitDiffStack.vue";
import FileExplorer from "@/modules/explorer/FileExplorer.vue";
import GitHistoryStack from "@/modules/git-history/GitHistoryStack.vue";
import MarkdownStack from "@/modules/markdown/MarkdownStack.vue";
import PreviewStack from "@/modules/preview/PreviewStack.vue";
import type { GitDecorationMap } from "@/modules/source-control";
import type { TaskRun, TaskRunGroup } from "@/modules/tasks";
import TaskConsole from "@/modules/tasks/TaskConsole.vue";
import type { TaskConsoleView } from "@/modules/tasks/taskConsoleTypes";
import type { WorkspaceTask } from "@/modules/tasks/taskTypes";
import type { Tab, TerminalTab } from "@/modules/tabs/tabsTypes";

type WorkbenchLayoutBinding = {
  explorerPaneClass: ComputedRef<string>;
  explorerPanelWidth: Ref<number>;
  explorerSplitMax: ComputedRef<string>;
  explorerSplitMin: ComputedRef<string>;
  explorerSplitSize: ComputedRef<string>;
  flushExplorerWidthSave: () => void;
  panelResizeTriggerSize: number;
  rightPanelOpen: ComputedRef<boolean> | Ref<boolean>;
  rightSplitHost: Ref<HTMLElement | null>;
  setExplorerPanelWidth: (width: number) => void;
  updateExplorerSplitSize: (size: string | number) => void;
};

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

const TASK_CONSOLE_HEIGHT = 280;

const props = defineProps<{
  activeId: number;
  activeRepoRoot: string | null;
  activeTab: Tab | null;
  layout: WorkbenchLayoutBinding;
  showBranchesModal: Ref<boolean>;
  tabs: Tab[];
  tabsStore: TabsStoreBinding;
  taskConsole: TaskConsoleBinding;
  workspaceFsEvent: WorkspaceFsChangedEvent | null;
  workspaceRoot: string | null;
  workspaceScope: string;
}>();

const emit = defineEmits<{
  "open-file": [path: string, pin: boolean];
  "open-markdown-preview": [path: string];
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
      /** @deprecated forwarded for backward compatibility. */
      branch?: string | null;
      refName?: string | null;
      allRefs?: boolean;
    },
  ];
  "history-ref-change": [
    input: { tabId: number; refName: string | null; allRefs: boolean },
  ];
  "repo-selected": [repoRoot: string | null];
}>();

const activeEditorPane = ref<InstanceType<typeof EditorPane> | null>(null);
const fileExplorerRef = ref<InstanceType<typeof import("@/modules/explorer/FileExplorer.vue").default> | null>(null);
const emptyGitDecorations: GitDecorationMap = new Map();

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

// ── Explorer card-edge resizer ──────────────────────────────────────────
// Mirrors the left sidebar resizer (LeftSidebar.vue): a w-1 strip pinned to
// the explorer card's left edge, transparent by default and highlighted on
// hover. Dragging it calls layout.setExplorerPanelWidth so the card grows
// toward the left — same feel as resizing the left sidebar, only reversed.
// NSplit's built-in trigger is rendered transparent and inert (see template),
// so this card-edge handle is the single resize affordance on the right side.
let detachMove: (() => void) | null = null;
let detachUp: (() => void) | null = null;

function onExplorerResizeStart(e: PointerEvent) {
  if (!props.layout.rightPanelOpen.value) return;
  e.preventDefault();
  const startX = e.clientX;
  const startWidth = props.layout.explorerPanelWidth.value;

  function onMove(ev: PointerEvent) {
    const dx = ev.clientX - startX;
    // Dragging left (dx < 0) widens the explorer panel.
    props.layout.setExplorerPanelWidth(startWidth - dx);
  }

  function onUp() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    detachMove = null;
    detachUp = null;
    props.layout.flushExplorerWidthSave();
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  detachMove = () => window.removeEventListener("pointermove", onMove);
  detachUp = () => window.removeEventListener("pointerup", onUp);
}

onBeforeUnmount(() => {
  detachMove?.();
  detachUp?.();
});

defineExpose({ saveActiveEditor, openGotoLine, openFindInFiles, killTerminal });
</script>

<template>
  <div
    :ref="(el) => (layout.rightSplitHost.value = el as HTMLElement | null)"
    class="h-full min-h-0 min-w-0"
  >
    <NSplit
      class="h-full min-h-0 min-w-0"
      direction="horizontal"
      :size="layout.explorerSplitSize.value"
      :min="layout.explorerSplitMin.value"
      :max="layout.explorerSplitMax.value"
      :resize-trigger-size="layout.panelResizeTriggerSize"
      pane1-class="h-full min-h-0 min-w-0"
      :pane2-class="layout.explorerPaneClass.value"
      @update:size="layout.updateExplorerSplitSize"
      @drag-end="layout.flushExplorerWidthSave"
    >
      <template #1>
        <section
          class="nexterm-surface flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[6px] border border-border"
        >
          <slot name="tab-bar" />
          <div class="relative min-h-0 flex-1">
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
          </div>

          <TaskConsole
            v-if="taskConsole.taskConsoleOpen.value"
            class="shrink-0"
            :style="{ height: `${TASK_CONSOLE_HEIGHT}px` }"
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
        </section>
      </template>
      <template #resize-trigger>
        <!-- NSplit 的内置 trigger 不可见也不承担交互：右侧拖拽由下方贴在 explorer
             卡片左边缘的自定义 resizer 接管，与左侧栏卡片边缘拖拽体验完全一致。 -->
        <span class="pointer-events-none block h-full w-full" />
      </template>
      <template #2>
        <FileExplorer
          ref="fileExplorerRef"
          v-show="layout.rightPanelOpen.value"
          :root-path="workspaceRoot"
          :fs-event="workspaceFsEvent"
          :git-decorations="emptyGitDecorations"
          @open-file="(path, pin) => emit('open-file', path, pin)"
          @open-markdown-preview="(path) => emit('open-markdown-preview', path)"
          @open-in-terminal="(path) => emit('open-in-terminal', path)"
          @open-search-result="(path, line) => emit('open-search-result', path, line)"
        />
        <!-- 卡片左边缘拖拽手柄：样式与 LeftSidebar 的 resizer 一致（默认透明，
             hover 高亮主色），骑在卡片左边框上并覆盖 NSplit 的内置 trigger 热区，
             因此只在卡片边缘可拖、且 hover 时显形。 -->
        <div
          v-if="layout.rightPanelOpen.value"
          data-explorer-resizer
          class="absolute inset-y-0 left-0 z-20 w-1 cursor-col-resize bg-transparent transition-colors duration-[var(--dur-fast)] hover:bg-primary/30"
          @pointerdown="onExplorerResizeStart"
        />
      </template>
    </NSplit>
  </div>
</template>
