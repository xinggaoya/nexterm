<script setup lang="ts">
import { ref, computed, type ComputedRef, type Ref } from "vue";
import { NSplit } from "naive-ui";
import { native, type WorkspaceFsChangedEvent } from "@/lib/native";
import { getPtyIdForLeaf, TerminalWorkspace, disposeSession } from "@/modules/terminal";
import EditorPane from "@/modules/editor/EditorPane.vue";
import GitDiffStack from "@/modules/editor/GitDiffStack.vue";
import FileExplorer from "@/modules/explorer/FileExplorer.vue";
import GitHistoryStack from "@/modules/git-history/GitHistoryStack.vue";
import MarkdownStack from "@/modules/markdown/MarkdownStack.vue";
import PreviewStack from "@/modules/preview/PreviewStack.vue";
import SourceControlPanel from "@/modules/source-control/SourceControlPanel.vue";
import type { GitDecorationMap } from "@/modules/source-control";
import type { TaskRun, TaskRunGroup } from "@/modules/tasks";
import TaskConsole from "@/modules/tasks/TaskConsole.vue";
import type { TaskConsoleView } from "@/modules/tasks/taskConsoleTypes";
import type { WorkspaceTask } from "@/modules/tasks/taskTypes";
import type { Tab, TerminalTab } from "@/modules/tabs/tabsTypes";

type WorkbenchLayoutBinding = {
  explorerPaneClass: ComputedRef<string>;
  explorerSplitMax: ComputedRef<string>;
  explorerSplitMin: ComputedRef<string>;
  explorerSplitSize: ComputedRef<string>;
  flushExplorerWidthSave: () => void;
  flushSourceControlWidthSave: () => void;
  leftPanelOpen: Ref<boolean>;
  panelResizeTriggerSize: number;
  rightPanelOpen: Ref<boolean>;
  rightSplitHost: Ref<HTMLElement | null>;
  sourceControlPaneClass: ComputedRef<string>;
  sourceControlSplitMax: ComputedRef<string>;
  sourceControlSplitMin: ComputedRef<string>;
  sourceControlSplitSize: ComputedRef<string>;
  updateExplorerSplitSize: (size: string | number) => void;
  updateSourceControlSplitSize: (size: string | number) => void;
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
const gitDecorations = ref<GitDecorationMap>(new Map());

function isActiveKind(kind: Tab["kind"]): boolean {
  return props.activeTab?.kind === kind;
}

function isActiveGitDiff(): boolean {
  return (
    props.activeTab?.kind === "git-diff" ||
    props.activeTab?.kind === "git-commit-file"
  );
}

function setGitDecorations(decorations: GitDecorationMap) {
  gitDecorations.value = decorations;
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
  const ptyId = getPtyIdForLeaf(leafId);
  if (ptyId === null) {
    disposeSession(leafId.toString());
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

defineExpose({ saveActiveEditor, openGotoLine, openFindInFiles, killTerminal });
</script>

<template>
  <NSplit
    class="nexterm-canvas h-full min-h-0 min-w-0 p-2"
    direction="horizontal"
    :size="layout.sourceControlSplitSize.value"
    :min="layout.sourceControlSplitMin.value"
    :max="layout.sourceControlSplitMax.value"
    :disabled="!layout.leftPanelOpen.value"
    :resize-trigger-size="layout.panelResizeTriggerSize"
    :pane1-class="layout.sourceControlPaneClass.value"
    pane2-class="h-full min-h-0 min-w-0"
    @update:size="layout.updateSourceControlSplitSize"
    @drag-end="layout.flushSourceControlWidthSave"
  >
    <template #1>
      <SourceControlPanel
        v-show="layout.leftPanelOpen.value"
        :root-path="workspaceRoot"
        :workspace-scope="workspaceScope"
        :active-repo-root="activeRepoRoot"
        :fs-event="workspaceFsEvent"
        @decorations-change="setGitDecorations"
        @open-diff="(input) => emit('open-source-diff', input)"
        @open-history="(input) => emit('open-source-history', input)"
        @repo-selected="(repoRoot) => emit('repo-selected', repoRoot)"
      />
    </template>
    <template #resize-trigger>
      <div
        v-if="layout.leftPanelOpen.value"
        class="h-full w-full bg-transparent transition-colors hover:bg-pane-handle-active"
      />
    </template>
    <template #2>
      <div class="h-full min-h-0 min-w-0">
        <NSplit
          class="nexterm-canvas h-full min-h-0 min-w-0"
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
            <section class="nexterm-card-elevated flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
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
            <div
              v-if="layout.rightPanelOpen.value"
              class="h-full w-full bg-transparent transition-colors hover:bg-pane-handle-active"
            />
          </template>
          <template #2>
            <FileExplorer
              ref="fileExplorerRef"
              v-show="layout.rightPanelOpen.value"
              :root-path="workspaceRoot"
              :fs-event="workspaceFsEvent"
              :git-decorations="gitDecorations"
              @open-file="(path, pin) => emit('open-file', path, pin)"
              @open-markdown-preview="(path) => emit('open-markdown-preview', path)"
              @open-in-terminal="(path) => emit('open-in-terminal', path)"
              @open-search-result="(path, line) => emit('open-search-result', path, line)"
            />
          </template>
        </NSplit>
      </div>
    </template>
  </NSplit>
</template>
