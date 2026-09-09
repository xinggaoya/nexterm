<script setup lang="ts">
import { GitBranchOutline } from "@vicons/ionicons5";
import { NIcon } from "naive-ui";
import { computed, onBeforeUnmount, ref, type ComputedRef, type Ref } from "vue";
import type { GitCommitResult, WorkspaceFsChangedEvent } from "@/lib/native";
import { t } from "@/modules/i18n/translate";
import FileExplorer from "@/modules/explorer/FileExplorer.vue";
import type { GitDecorationMap } from "@/modules/source-control";
import SourceControlPanel from "@/modules/source-control/SourceControlPanel.vue";
import type { TaskRun, TaskRunGroup } from "@/modules/tasks";
import TaskConsole from "@/modules/tasks/TaskConsole.vue";
import type { TaskConsoleView } from "@/modules/tasks/taskConsoleTypes";
import type { WorkspaceTask } from "@/modules/tasks/taskTypes";
import type { WorkspacePanelTab } from "@/modules/settings/store";

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

const SIDE_PANEL_MIN = 240;
const SIDE_PANEL_MAX = 520;

const props = defineProps<{
  tab: WorkspacePanelTab;
  width: number;
  workspaceId: string;
  workspaceRoot: string | null;
  workspaceScope: string;
  activeRepoRoot: string | null;
  gitDecorations: GitDecorationMap;
  gitBranch: string | null;
  showBranchesModal: Ref<boolean>;
  fsEvent: WorkspaceFsChangedEvent | null;
  taskConsole: TaskConsoleBinding;
}>();

const emit = defineEmits<{
  "update:tab": [tab: WorkspacePanelTab];
  "resize-width": [width: number];
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
      refName?: string | null;
      allRefs?: boolean;
    },
  ];
  "repo-selected": [repoRoot: string | null];
  "decorations-change": [decorations: GitDecorationMap];
  "branch-change": [branch: string | null];
  "committed": [result: GitCommitResult];
}>();

const fileExplorerRef = ref<InstanceType<typeof FileExplorer> | null>(null);

const tabs = computed(() => [
  { key: "explorer" as const, label: t("app.rail.tool.explorer") },
  { key: "changes" as const, label: t("app.rail.tool.changes") },
  { key: "tasks" as const, label: t("app.rail.tool.tasks") },
]);

const runningTaskCount = computed(
  () => props.taskConsole.taskRunList.value.filter((run) => run.status === "running").length,
);

function selectTab(key: WorkspacePanelTab): void {
  if (key !== props.tab) emit("update:tab", key);
}

// ── 左缘拖宽(面板位于画布右侧;持久化由宿主负责) ─────────────────────
let detachMove: (() => void) | null = null;
let detachUp: (() => void) | null = null;

function onResizeStart(e: PointerEvent) {
  e.preventDefault();
  const startX = e.clientX;
  const startWidth = props.width;

  function onMove(ev: PointerEvent) {
    const dx = ev.clientX - startX;
    // 向左拖(dx<0)加宽面板,与旧版右缘卡片拖拽手感一致。
    const next = Math.min(
      SIDE_PANEL_MAX,
      Math.max(SIDE_PANEL_MIN, Math.round(startWidth - dx)),
    );
    emit("resize-width", next);
  }

  function onUp() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    detachMove = null;
    detachUp = null;
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

// ── 宿主编排入口 ────────────────────────────────────────────────────────
defineExpose({
  /** workspace 切回时:立即重读根+展开节点。 */
  activate: () => fileExplorerRef.value?.activate(),
  /** workspace 切回时:取消防抖,立即执行 pending loadChildren。 */
  flushPendingTreeRefresh: () => fileExplorerRef.value?.flushPendingTreeRefresh(),
  /** Find in Files:进入内容搜索模式(先确保 explorer 标签激活)。 */
  openFindInFiles: () => {
    if (props.tab !== "explorer") selectTab("explorer");
    fileExplorerRef.value?.setMode("content");
  },
});
</script>

<template>
  <aside
    class="relative flex h-full min-h-0 shrink-0 flex-col border-r border-border bg-sidebar"
    :style="{ width: `${width}px` }"
    data-workspace-panel
    data-workspace-panel-right
  >
    <!-- 标签头 -->
    <header class="flex h-11 shrink-0 items-center gap-1 border-b border-border/70 px-2">
      <div class="flex min-w-0 flex-1 items-center gap-0.5 rounded-lg bg-surface-subtle p-0.5">
        <button
          v-for="item in tabs"
          :key="item.key"
          type="button"
          :data-panel-tab="item.key"
          :aria-pressed="tab === item.key"
          class="flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-2 text-[12px] transition-colors duration-[var(--dur-fast)]"
          :class="
            tab === item.key
              ? 'bg-background text-foreground shadow-[0_0_0_1px_var(--border)]'
              : 'text-muted-foreground hover:text-foreground'
          "
          @click="selectTab(item.key)"
        >
          <span class="truncate">{{ item.label }}</span>
          <span
            v-if="item.key === 'tasks' && runningTaskCount > 0"
            class="size-1.5 shrink-0 rounded-full bg-primary"
          />
        </button>
      </div>
      <span
        v-if="gitBranch"
        class="flex min-w-0 shrink-0 items-center gap-1 rounded-full bg-surface-subtle px-2 py-0.5 text-[11px] text-muted-foreground"
        :title="gitBranch"
        data-panel-branch
      >
        <NIcon :component="GitBranchOutline" :size="11" />
        <span class="max-w-20 truncate">{{ gitBranch }}</span>
      </span>
    </header>

    <!-- 内容层:v-show 保活,保持各模块状态 -->
    <div class="relative min-h-0 flex-1">
      <div
        v-show="tab === 'explorer'"
        class="absolute inset-0 overflow-hidden"
        data-panel-tab-explorer
      >
        <FileExplorer
          ref="fileExplorerRef"
          :root-path="workspaceRoot"
          :fs-event="fsEvent"
          :git-decorations="gitDecorations"
          @open-file="(path, pin) => emit('open-file', path, pin)"
          @open-markdown-preview="(path) => emit('open-markdown-preview', path)"
          @open-in-terminal="(path) => emit('open-in-terminal', path)"
          @open-search-result="(path, line) => emit('open-search-result', path, line)"
        />
      </div>

      <div
        v-show="tab === 'changes'"
        class="absolute inset-0 overflow-hidden"
        data-panel-tab-changes
      >
        <SourceControlPanel
          :root-path="workspaceRoot"
          :workspace-scope="workspaceScope"
          :active-repo-root="activeRepoRoot"
          :fs-event="fsEvent"
          :show-branches-modal="showBranchesModal"
          :workspace-id="workspaceId"
          @open-diff="(input) => emit('open-source-diff', input)"
          @open-history="(input) => emit('open-source-history', input)"
          @repo-selected="(repoRoot) => emit('repo-selected', repoRoot)"
          @decorations-change="(d) => emit('decorations-change', d)"
          @branch-change="(branch) => emit('branch-change', branch)"
          @committed="(result) => emit('committed', result)"
        />
      </div>

      <div
        v-show="tab === 'tasks'"
        class="absolute inset-0 overflow-hidden"
        data-panel-tab-tasks
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
          @close="selectTab('explorer')"
          @update-view="taskConsole.setTaskConsoleView"
          @refresh-tasks="taskConsole.refreshWorkspaceTasks"
          @run-task="taskConsole.runWorkspaceTask"
          @run-command="taskConsole.runWorkspaceCommand"
          @select-run="taskConsole.taskRuns.setActiveRun"
          @stop-run="(id) => void taskConsole.taskRuns.stopRun(id)"
          @rerun="(id) => void taskConsole.taskRuns.rerun(id)"
          @run-in-terminal="taskConsole.runTaskInTerminal"
        />
      </div>
    </div>

    <!-- 左缘拖宽手柄(面板在画布右侧,向左拖加宽) -->
    <div
      data-panel-resizer
      class="absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize bg-transparent transition-colors duration-[var(--dur-fast)] hover:bg-primary/30"
      @pointerdown="onResizeStart"
    />
  </aside>
</template>
