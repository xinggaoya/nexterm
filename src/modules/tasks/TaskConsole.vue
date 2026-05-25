<script setup lang="ts">
import {
  CloseOutline,
  PlayOutline,
  RefreshOutline,
  StopOutline,
  TerminalOutline,
} from "@vicons/ionicons5";
import { NButton, NIcon, NInput, NSpin, NTag } from "naive-ui";
import { computed, ref } from "vue";
import RunConfigurationManager from "@/modules/run-configs/RunConfigurationManager.vue";
import type {
  RunConfiguration,
  RunConfigurationFile,
} from "@/modules/run-configs";
import { t } from "@/modules/i18n/translate";
import type { TaskRun, TaskRunGroup, TaskRunStatus } from "./taskRunStore";
import type { TaskConsoleView } from "./taskConsoleTypes";
import type { WorkspaceTask } from "./taskTypes";

const props = withDefaults(
  defineProps<{
    rootPath: string | null;
    tasks: WorkspaceTask[];
    runs: TaskRun[];
    activeRun: TaskRun | null;
    loadingTasks?: boolean;
    taskError?: string | null;
    view?: TaskConsoleView;
    runConfigurations?: RunConfiguration[];
    selectedRunConfigurationId?: string | null;
    runConfigurationGroups?: TaskRunGroup[];
    runConfigurationSaving?: boolean;
    runConfigurationError?: string | null;
  }>(),
  {
    loadingTasks: false,
    taskError: null,
    view: "tasks",
    runConfigurations: () => [],
    selectedRunConfigurationId: null,
    runConfigurationGroups: () => [],
    runConfigurationSaving: false,
    runConfigurationError: null,
  },
);

const emit = defineEmits<{
  refreshTasks: [];
  close: [];
  updateView: [view: TaskConsoleView];
  runTask: [task: WorkspaceTask];
  runCommand: [command: string];
  selectRun: [id: number];
  stopRun: [id: number];
  rerun: [id: number];
  runInTerminal: [input: { command: string; cwd: string }];
  saveRunConfigurations: [file: RunConfigurationFile];
  selectRunConfiguration: [id: string | null];
  runConfiguration: [configuration: RunConfiguration];
  stopRunConfigurationGroup: [id: number];
}>();

const commandInput = ref("");

const canRunCommand = computed(
  () => !!props.rootPath && commandInput.value.trim().length > 0,
);

function statusTone(status: TaskRunStatus): "default" | "success" | "warning" | "error" {
  if (status === "succeeded") return "success";
  if (status === "running") return "warning";
  if (status === "failed" || status === "error") return "error";
  return "default";
}

function runCommand() {
  const command = commandInput.value.trim();
  if (!command) return;
  emit("runCommand", command);
  commandInput.value = "";
}

function runInTerminal(run: TaskRun) {
  emit("runInTerminal", { command: run.command, cwd: run.cwd });
}
</script>

<template>
  <section
    class="flex h-full min-h-0 flex-col border-t border-border/60 bg-card text-foreground"
    data-task-console
  >
    <header class="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 px-3">
      <div class="min-w-0 flex-1">
        <div class="text-xs font-medium text-foreground">
          {{ t("tasks.consoleTitle") }}
        </div>
      </div>
      <div class="flex items-center rounded-md bg-muted p-0.5">
        <button
          type="button"
          :class="[
            'h-6 rounded px-2 text-[11px] transition-colors',
            view === 'tasks'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          ]"
          data-task-console-view-tasks
          @click="emit('updateView', 'tasks')"
        >
          {{ t("runConfigs.tasksTab") }}
        </button>
        <button
          type="button"
          :class="[
            'h-6 rounded px-2 text-[11px] transition-colors',
            view === 'run-configs'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          ]"
          data-task-console-view-run-configs
          @click="emit('updateView', 'run-configs')"
        >
          {{ t("runConfigs.configurations") }}
        </button>
      </div>
      <NButton
        size="tiny"
        quaternary
        :disabled="!rootPath || loadingTasks"
        data-refresh-tasks
        @click="emit('refreshTasks')"
      >
        <template #icon>
          <NIcon :component="RefreshOutline" />
        </template>
      </NButton>
      <NButton
        size="tiny"
        quaternary
        :aria-label="t('common.close')"
        data-close-task-console
        @click="emit('close')"
      >
        <template #icon>
          <NIcon :component="CloseOutline" />
        </template>
      </NButton>
    </header>

    <RunConfigurationManager
      v-if="view === 'run-configs'"
      class="min-h-0 flex-1"
      :root-path="rootPath"
      :tasks="tasks"
      :configurations="runConfigurations"
      :selected-id="selectedRunConfigurationId"
      :groups="runConfigurationGroups"
      :saving="runConfigurationSaving"
      :error="runConfigurationError"
      @save="(file) => emit('saveRunConfigurations', file)"
      @select="(id) => emit('selectRunConfiguration', id)"
      @run="(configuration) => emit('runConfiguration', configuration)"
      @stop-group="(id) => emit('stopRunConfigurationGroup', id)"
    />

    <div
      v-else
      class="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)]"
    >
      <aside class="min-h-0 border-r border-border/60">
        <div class="border-b border-border/60 p-2">
          <div class="flex items-center gap-2">
            <NInput
              v-model:value="commandInput"
              size="small"
              :disabled="!rootPath"
              :placeholder="t('tasks.commandPlaceholder')"
              data-task-command-input
              @keyup.enter="runCommand"
            />
            <NButton
              size="small"
              type="primary"
              :disabled="!canRunCommand"
              data-run-command
              @click="runCommand"
            >
              <template #icon>
                <NIcon :component="PlayOutline" />
              </template>
            </NButton>
          </div>
        </div>

        <div class="min-h-0 overflow-y-auto p-2">
          <div
            v-if="loadingTasks"
            class="flex items-center gap-2 py-3 text-xs text-muted-foreground"
          >
            <NSpin size="small" />
            <span>{{ t("tasks.loading") }}</span>
          </div>
          <div v-else-if="taskError" class="py-3 text-xs text-destructive">
            {{ taskError }}
          </div>
          <div v-else-if="tasks.length === 0" class="py-3 text-xs text-muted-foreground">
            {{ t("tasks.noTasks") }}
          </div>
          <div
            v-for="task in tasks"
            v-else
            :key="task.id"
            class="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
            data-task-row
          >
            <div class="min-w-0 flex-1">
              <div class="truncate text-xs font-medium text-foreground">
                {{ task.title }}
              </div>
              <div class="truncate text-[11px] text-muted-foreground">
                {{ task.detail }}
              </div>
            </div>
            <NButton
              size="tiny"
              quaternary
              :aria-label="t('tasks.runTask')"
              :data-run-task="task.id"
              @click="emit('runTask', task)"
            >
              <template #icon>
                <NIcon :component="PlayOutline" />
              </template>
            </NButton>
          </div>
        </div>
      </aside>

      <div class="grid min-h-0 grid-cols-[220px_minmax(0,1fr)]">
        <aside class="min-h-0 border-r border-border/60">
          <div class="border-b border-border/60 px-3 py-2 text-[11px] uppercase text-muted-foreground">
            {{ t("tasks.runs") }}
          </div>
          <div class="min-h-0 overflow-y-auto p-2">
            <div v-if="runs.length === 0" class="py-3 text-xs text-muted-foreground">
              {{ t("tasks.noRuns") }}
            </div>
            <button
              v-for="run in runs"
              v-else
              :key="run.id"
              type="button"
              :data-task-run-row="run.id"
              :class="[
                'mb-1 flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                activeRun?.id === run.id ? 'bg-accent text-foreground' : 'hover:bg-accent/70',
              ]"
              @click="emit('selectRun', run.id)"
            >
              <div class="min-w-0 flex-1">
                <div class="truncate text-xs font-medium">
                  {{ run.title }}
                </div>
                <div class="truncate text-[11px] text-muted-foreground">
                  {{ run.cwd }}
                </div>
              </div>
              <NTag
                size="small"
                :bordered="false"
                :type="statusTone(run.status)"
                data-task-run-status
              >
                {{ t(`tasks.status.${run.status}`) }}
              </NTag>
            </button>
          </div>
        </aside>

        <section class="flex min-h-0 min-w-0 flex-col">
          <header
            class="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 px-3"
          >
            <div class="min-w-0 flex-1">
              <div class="truncate text-xs font-medium">
                {{ activeRun?.title ?? t("tasks.noActiveRun") }}
              </div>
            </div>
            <template v-if="activeRun">
              <NButton
                size="tiny"
                quaternary
                :disabled="activeRun.status !== 'running'"
                :data-stop-task="activeRun.id"
                @click="emit('stopRun', activeRun.id)"
              >
                <template #icon>
                  <NIcon :component="StopOutline" />
                </template>
              </NButton>
              <NButton
                size="tiny"
                quaternary
                :data-rerun-task="activeRun.id"
                @click="emit('rerun', activeRun.id)"
              >
                <template #icon>
                  <NIcon :component="RefreshOutline" />
                </template>
              </NButton>
              <NButton
                size="tiny"
                quaternary
                :data-run-task-terminal="activeRun.id"
                @click="runInTerminal(activeRun)"
              >
                <template #icon>
                  <NIcon :component="TerminalOutline" />
                </template>
              </NButton>
            </template>
          </header>

          <pre
            v-if="activeRun"
            class="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-5 text-foreground"
            data-task-log
          >{{ activeRun.log || t("tasks.noLog") }}</pre>
          <div
            v-else
            class="flex min-h-0 flex-1 items-center justify-center text-xs text-muted-foreground"
          >
            {{ t("tasks.selectRun") }}
          </div>
        </section>
      </div>
    </div>
  </section>
</template>
