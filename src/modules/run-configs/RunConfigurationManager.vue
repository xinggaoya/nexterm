<script setup lang="ts">
import {
  AddOutline,
  PlayOutline,
  SaveOutline,
  StopOutline,
  TrashOutline,
} from "@vicons/ionicons5";
import { NButton, NIcon, NInput, NTag } from "naive-ui";
import { computed, ref, watch } from "vue";
import { t } from "@/modules/i18n/translate";
import type { TaskRunGroup, WorkspaceTask } from "@/modules/tasks";
import type { RunConfiguration, RunConfigurationFile } from "./runConfigStore";

const props = withDefaults(
  defineProps<{
    rootPath: string | null;
    tasks: WorkspaceTask[];
    configurations: RunConfiguration[];
    selectedId: string | null;
    groups: TaskRunGroup[];
    saving?: boolean;
    error?: string | null;
  }>(),
  {
    saving: false,
    error: null,
  },
);

const emit = defineEmits<{
  save: [file: RunConfigurationFile];
  select: [id: string | null];
  run: [configuration: RunConfiguration];
  stopGroup: [id: number];
}>();

const draftConfigurations = ref<RunConfiguration[]>([]);
const activeId = ref<string | null>(props.selectedId);

function cloneConfigurations(configurations: RunConfiguration[]): RunConfiguration[] {
  return configurations.map((configuration) => ({
    ...configuration,
    commands: configuration.commands.map((command) => ({ ...command })),
  }));
}

function uniqueId(prefix: string, existing: Set<string>): string {
  let index = existing.size + 1;
  let id = `${prefix}-${index}`;
  while (existing.has(id)) {
    index += 1;
    id = `${prefix}-${index}`;
  }
  return id;
}

function ensureActiveId() {
  if (
    activeId.value &&
    draftConfigurations.value.some((configuration) => configuration.id === activeId.value)
  ) {
    return;
  }
  activeId.value = draftConfigurations.value[0]?.id ?? null;
}

watch(
  () => props.configurations,
  (configurations) => {
    draftConfigurations.value = cloneConfigurations(configurations);
    activeId.value = props.selectedId;
    ensureActiveId();
  },
  { immediate: true, deep: true },
);

watch(
  () => props.selectedId,
  (id) => {
    activeId.value = id;
    ensureActiveId();
  },
);

const activeConfiguration = computed(
  () =>
    draftConfigurations.value.find(
      (configuration) => configuration.id === activeId.value,
    ) ?? null,
);

const activeGroup = computed(() => {
  const active = activeConfiguration.value;
  if (!active) return null;
  return (
    props.groups.find(
      (group) => group.configurationId === active.id && group.status === "running",
    ) ?? null
  );
});

const canSave = computed(() => {
  if (!props.rootPath) return false;
  return draftConfigurations.value.every(
    (configuration) =>
      configuration.name.trim() &&
      configuration.commands.length > 0 &&
      configuration.commands.every((command) => command.command.trim()),
  );
});

function selectConfiguration(id: string | null) {
  activeId.value = id;
  emit("select", id);
}

function addConfiguration() {
  const ids = new Set(draftConfigurations.value.map((item) => item.id));
  const id = uniqueId("config", ids);
  draftConfigurations.value = [
    ...draftConfigurations.value,
    {
      id,
      name: t("runConfigs.newConfiguration"),
      commands: [
        {
          id: "command-1",
          name: t("runConfigs.command"),
          command: "",
          cwd: ".",
        },
      ],
    },
  ];
  selectConfiguration(id);
}

function deleteActiveConfiguration() {
  const id = activeConfiguration.value?.id;
  if (!id) return;
  draftConfigurations.value = draftConfigurations.value.filter(
    (configuration) => configuration.id !== id,
  );
  ensureActiveId();
  emit("select", activeId.value);
}

function addCommand() {
  const active = activeConfiguration.value;
  if (!active) return;
  const ids = new Set(active.commands.map((command) => command.id));
  active.commands.push({
    id: uniqueId("command", ids),
    name: t("runConfigs.command"),
    command: "",
    cwd: ".",
  });
}

function removeCommand(id: string) {
  const active = activeConfiguration.value;
  if (!active || active.commands.length <= 1) return;
  active.commands = active.commands.filter((command) => command.id !== id);
}

function addTask(task: WorkspaceTask) {
  const active = activeConfiguration.value;
  if (!active) return;
  const ids = new Set(active.commands.map((command) => command.id));
  active.commands.push({
    id: uniqueId(task.id.replace(/[^A-Za-z0-9_-]/g, "-"), ids),
    name: task.title,
    command: task.command,
    cwd: ".",
  });
}

function save() {
  if (!canSave.value) return;
  emit("save", {
    version: 1,
    selectedId: activeId.value,
    configurations: cloneConfigurations(draftConfigurations.value),
  });
}

function runActive() {
  const active = activeConfiguration.value;
  if (!active) return;
  emit("run", { ...active, commands: active.commands.map((command) => ({ ...command })) });
}
</script>

<template>
  <section
    class="grid h-full min-h-0 grid-cols-[240px_minmax(0,1fr)]"
    data-run-config-manager
  >
    <aside class="min-h-0 border-r border-border/60 p-2">
      <div class="mb-2 flex items-center justify-between gap-2">
        <div class="text-[11px] font-medium uppercase text-muted-foreground">
          {{ t("runConfigs.configurations") }}
        </div>
        <NButton
          size="tiny"
          quaternary
          :disabled="!rootPath"
          data-add-run-config
          @click="addConfiguration"
        >
          <template #icon>
            <NIcon :component="AddOutline" />
          </template>
        </NButton>
      </div>

      <div class="min-h-0 space-y-1 overflow-y-auto">
        <div v-if="draftConfigurations.length === 0" class="py-3 text-xs text-muted-foreground">
          {{ t("runConfigs.noConfigurations") }}
        </div>
        <button
          v-for="configuration in draftConfigurations"
          v-else
          :key="configuration.id"
          type="button"
          data-run-config-row
          :class="[
            'flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
            activeId === configuration.id
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground',
          ]"
          @click="selectConfiguration(configuration.id)"
        >
          <span class="min-w-0 flex-1 truncate text-xs font-medium">
            {{ configuration.name }}
          </span>
          <NTag
            v-if="groups.some((group) => group.configurationId === configuration.id && group.status === 'running')"
            size="small"
            :bordered="false"
            type="warning"
          >
            {{ t("common.running") }}
          </NTag>
        </button>
      </div>
    </aside>

    <div class="flex min-h-0 min-w-0 flex-col">
      <header class="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <div class="min-w-0 flex-1">
          <div class="truncate text-xs font-medium">
            {{ activeConfiguration?.name ?? t("runConfigs.noSelection") }}
          </div>
        </div>
        <NButton
          size="tiny"
          quaternary
          :disabled="!activeConfiguration"
          data-delete-run-config
          @click="deleteActiveConfiguration"
        >
          <template #icon>
            <NIcon :component="TrashOutline" />
          </template>
        </NButton>
        <NButton
          v-if="activeGroup"
          size="tiny"
          quaternary
          :data-stop-run-config-group="activeGroup.id"
          @click="emit('stopGroup', activeGroup.id)"
        >
          <template #icon>
            <NIcon :component="StopOutline" />
          </template>
        </NButton>
        <NButton
          v-else
          size="tiny"
          quaternary
          :disabled="!activeConfiguration || !canSave"
          :data-run-config="activeConfiguration?.id"
          @click="runActive"
        >
          <template #icon>
            <NIcon :component="PlayOutline" />
          </template>
        </NButton>
        <NButton
          size="tiny"
          type="primary"
          :disabled="!canSave || saving"
          data-save-run-configs
          @click="save"
        >
          <template #icon>
            <NIcon :component="SaveOutline" />
          </template>
        </NButton>
      </header>

      <div v-if="error" class="border-b border-border/60 px-3 py-2 text-xs text-destructive">
        {{ error }}
      </div>

      <div v-if="activeConfiguration" class="min-h-0 flex-1 overflow-y-auto p-3">
        <div class="mb-3 max-w-lg" data-run-config-name-input>
          <NInput
            v-model:value="activeConfiguration.name"
            size="small"
            :placeholder="t('runConfigs.namePlaceholder')"
          />
        </div>

        <div class="space-y-2">
          <div
            v-for="command in activeConfiguration.commands"
            :key="command.id"
            class="grid grid-cols-[minmax(7rem,0.35fr)_minmax(12rem,1fr)_minmax(5rem,0.25fr)_1.75rem] gap-2"
            data-run-config-command-row
          >
            <NInput
              v-model:value="command.name"
              size="small"
              :placeholder="t('runConfigs.commandNamePlaceholder')"
            />
            <div data-run-config-command-input>
              <NInput
                v-model:value="command.command"
                size="small"
                :placeholder="t('runConfigs.commandPlaceholder')"
              />
            </div>
            <NInput
              v-model:value="command.cwd"
              size="small"
              :placeholder="t('runConfigs.cwdPlaceholder')"
            />
            <NButton
              size="tiny"
              quaternary
              :disabled="activeConfiguration.commands.length <= 1"
              @click="removeCommand(command.id)"
            >
              <template #icon>
                <NIcon :component="TrashOutline" />
              </template>
            </NButton>
          </div>
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-2">
          <NButton size="tiny" secondary data-add-run-config-command @click="addCommand">
            <template #icon>
              <NIcon :component="AddOutline" />
            </template>
            {{ t("runConfigs.addCommand") }}
          </NButton>
          <NButton
            v-for="task in tasks"
            :key="task.id"
            size="tiny"
            quaternary
            :data-add-task-to-run-config="task.id"
            @click="addTask(task)"
          >
            <template #icon>
              <NIcon :component="AddOutline" />
            </template>
            {{ task.title }}
          </NButton>
        </div>
      </div>

      <div
        v-else
        class="flex min-h-0 flex-1 items-center justify-center text-xs text-muted-foreground"
      >
        {{ t("runConfigs.noConfigurations") }}
      </div>
    </div>
  </section>
</template>
