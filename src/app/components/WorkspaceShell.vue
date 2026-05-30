<script setup lang="ts">
import { ref, type ComponentPublicInstance, type ComputedRef, type Ref } from "vue";
import { NSplit } from "naive-ui";
import type { GitChangedFile, WorkspaceFsChangedEvent } from "@/lib/native";
import EditorPane from "@/modules/editor/EditorPane.vue";
import GitDiffStack from "@/modules/editor/GitDiffStack.vue";
import FileExplorer from "@/modules/explorer/FileExplorer.vue";
import GitHistoryStack from "@/modules/git-history/GitHistoryStack.vue";
import MarkdownStack from "@/modules/markdown/MarkdownStack.vue";
import PreviewStack from "@/modules/preview/PreviewStack.vue";
import SourceControlPanel from "@/modules/source-control/SourceControlPanel.vue";
import type { TaskRun, TaskRunGroup } from "@/modules/tasks";
import TaskConsole from "@/modules/tasks/TaskConsole.vue";
import type { TaskConsoleView } from "@/modules/tasks/taskConsoleTypes";
import type { WorkspaceTask } from "@/modules/tasks/taskTypes";
import type { Tab } from "@/modules/tabs/tabsTypes";
import TerminalStack from "@/modules/terminal/TerminalStack.vue";

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
  activeTab: Tab | null;
  layout: WorkbenchLayoutBinding;
  tabs: Tab[];
  tabsStore: TabsStoreBinding;
  taskConsole: TaskConsoleBinding;
  workspaceFsEvent: WorkspaceFsChangedEvent | null;
  workspaceRoot: string | null;
}>();

const emit = defineEmits<{
  "open-file": [path: string, pin: boolean];
  "open-markdown-preview": [path: string];
  "open-source-diff": [
    input: {
      repoRoot: string;
      path: string;
      mode: "-" | "+";
      originalPath: string | null;
      title?: string;
    },
  ];
  "open-source-history": [input: { repoRoot: string; branch?: string | null }];
}>();

const activeEditorPane = ref<InstanceType<typeof EditorPane> | null>(null);
const gitChangedFiles = ref<GitChangedFile[]>([]);

function isActiveKind(kind: Tab["kind"]): boolean {
  return props.activeTab?.kind === kind;
}

function isActiveGitDiff(): boolean {
  return (
    props.activeTab?.kind === "git-diff" ||
    props.activeTab?.kind === "git-commit-file"
  );
}

function setRightSplitHost(element: Element | ComponentPublicInstance | null) {
  props.layout.rightSplitHost.value =
    element instanceof HTMLElement ? element : null;
}

async function saveActiveEditor() {
  await activeEditorPane.value?.save();
}

defineExpose({
  saveActiveEditor,
});
</script>

<template>
  <NSplit
    class="h-full min-w-0"
    direction="horizontal"
    :size="layout.sourceControlSplitSize.value"
    :min="layout.sourceControlSplitMin.value"
    :max="layout.sourceControlSplitMax.value"
    :disabled="!layout.leftPanelOpen.value"
    :resize-trigger-size="layout.panelResizeTriggerSize"
    :pane1-class="layout.sourceControlPaneClass.value"
    pane2-class="h-full min-w-0"
    @update:size="layout.updateSourceControlSplitSize"
    @drag-end="layout.flushSourceControlWidthSave"
  >
    <template #1>
      <SourceControlPanel
        v-show="layout.leftPanelOpen.value"
        :root-path="workspaceRoot"
        :fs-event="workspaceFsEvent"
        @open-diff="(input) => emit('open-source-diff', input)"
        @open-history="(input) => emit('open-source-history', input)"
        @git-status-changed="(files) => (gitChangedFiles = files)"
      />
    </template>
    <template #resize-trigger>
      <div
        v-if="layout.leftPanelOpen.value"
        class="h-full w-full bg-border/30 transition-colors hover:bg-primary/25"
      />
    </template>
    <template #2>
      <div :ref="setRightSplitHost" class="h-full min-w-0">
        <NSplit
          class="h-full min-w-0"
          direction="horizontal"
          :size="layout.explorerSplitSize.value"
          :min="layout.explorerSplitMin.value"
          :max="layout.explorerSplitMax.value"
          :disabled="!layout.rightPanelOpen.value"
          :resize-trigger-size="layout.panelResizeTriggerSize"
          pane1-class="h-full min-w-0"
          :pane2-class="layout.explorerPaneClass.value"
          @update:size="layout.updateExplorerSplitSize"
          @drag-end="layout.flushExplorerWidthSave"
        >
          <template #1>
            <section class="flex h-full min-w-0 flex-col bg-background">
              <div class="relative min-h-0 flex-1">
                <div
                  :class="[
                    'absolute inset-0 px-3 pt-2 pb-2',
                    isActiveKind('terminal') ? '' : 'pointer-events-none invisible',
                  ]"
                  :aria-hidden="!isActiveKind('terminal')"
                >
                  <TerminalStack
                    :tabs="tabs"
                    :active-id="activeId"
                    @focus-leaf="(tabId, leafId) => tabsStore.focusPane(tabId, leafId)"
                    @cwd="(leafId, cwd) => tabsStore.setLeafCwd(leafId, cwd)"
                    @title="(leafId, title) => tabsStore.setLeafTitle(leafId, title)"
                  />
                </div>

                <div
                  :class="[
                    'absolute inset-0 px-3 pt-2 pb-2',
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
                    'absolute inset-0 px-3 pt-2 pb-2',
                    isActiveKind('markdown') ? '' : 'pointer-events-none invisible',
                  ]"
                  :aria-hidden="!isActiveKind('markdown')"
                >
                  <MarkdownStack :tabs="tabs" :active-id="activeId" />
                </div>

                <div
                  :class="[
                    'absolute inset-0 px-3 pt-2 pb-2',
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
                  />
                </div>

                <div
                  v-if="activeTab && activeTab.kind === 'editor'"
                  class="absolute inset-0 flex min-h-0 flex-col bg-background px-3 pt-2 pb-2"
                  :class="isActiveKind('editor') ? '' : 'pointer-events-none invisible'"
                  :aria-hidden="!isActiveKind('editor')"
                >
                  <EditorPane
                    ref="activeEditorPane"
                    :path="activeTab.path"
                    :fs-event="workspaceFsEvent"
                    @dirty-change="
                      (dirty) => tabsStore.updateTab(activeTab!.id, { dirty })
                    "
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
              class="h-full w-full bg-border/30 transition-colors hover:bg-primary/25"
            />
          </template>
          <template #2>
            <FileExplorer
              v-show="layout.rightPanelOpen.value"
              :root-path="workspaceRoot"
              :fs-event="workspaceFsEvent"
              :git-changed-files="gitChangedFiles"
              @open-file="(path, pin) => emit('open-file', path, pin)"
              @open-markdown-preview="(path) => emit('open-markdown-preview', path)"
            />
          </template>
        </NSplit>
      </div>
    </template>
  </NSplit>
</template>
