import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import {
  emptyRunConfigurationFile,
  loadRunConfigurationFile,
  saveRunConfigurationFile,
  type RunConfiguration,
  type RunConfigurationFile,
} from "@/modules/run-configs";
import type { TaskRunGroup } from "@/modules/tasks";

type RunConfigTaskRuns = {
  runGroups: Ref<TaskRunGroup[]>;
  startRunConfiguration: (
    configuration: RunConfiguration,
    workspaceRoot: string,
  ) => Promise<TaskRunGroup>;
  stopRunGroup: (id: number) => Promise<unknown>;
};

export type RunConfigControllerOptions = {
  workspaceRoot: ComputedRef<string | null>;
  taskRuns: RunConfigTaskRuns;
  loadFile?: typeof loadRunConfigurationFile;
  saveFile?: typeof saveRunConfigurationFile;
};

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function selectedIdForFile(file: RunConfigurationFile): string | null {
  if (file.configurations.length === 0) return null;
  if (
    file.selectedId &&
    file.configurations.some((configuration) => configuration.id === file.selectedId)
  ) {
    return file.selectedId;
  }
  return file.configurations[0].id;
}

export function useRunConfigController(options: RunConfigControllerOptions) {
  const loadFile = options.loadFile ?? loadRunConfigurationFile;
  const saveFile = options.saveFile ?? saveRunConfigurationFile;
  const runConfigurationFile = ref<RunConfigurationFile>(
    emptyRunConfigurationFile(),
  );
  const selectedRunConfigurationId = ref<string | null>(null);
  const runConfigurationLoading = ref(false);
  const runConfigurationSaving = ref(false);
  const runConfigurationError = ref<string | null>(null);

  const runConfigurations = computed(
    () => runConfigurationFile.value.configurations,
  );

  const selectedRunConfiguration = computed<RunConfiguration | null>(
    () =>
      runConfigurations.value.find(
        (configuration) => configuration.id === selectedRunConfigurationId.value,
      ) ?? null,
  );

  const activeRunConfigurationGroup = computed<TaskRunGroup | null>(() => {
    const selected = selectedRunConfiguration.value;
    if (!selected) return null;
    return (
      options.taskRuns.runGroups.value.find(
        (group) =>
          group.configurationId === selected.id && group.status === "running",
      ) ?? null
    );
  });

  function setRunConfigurationFile(file: RunConfigurationFile) {
    runConfigurationFile.value = {
      version: 1,
      configurations: file.configurations,
      selectedId: selectedIdForFile(file),
    };
    selectedRunConfigurationId.value = runConfigurationFile.value.selectedId;
  }

  async function reloadRunConfigurations() {
    const root = options.workspaceRoot.value;
    if (!root) {
      setRunConfigurationFile(emptyRunConfigurationFile());
      runConfigurationError.value = null;
      return;
    }
    runConfigurationLoading.value = true;
    runConfigurationError.value = null;
    try {
      setRunConfigurationFile(await loadFile(root));
    } catch (error) {
      setRunConfigurationFile(emptyRunConfigurationFile());
      runConfigurationError.value = normalizeError(error);
    } finally {
      runConfigurationLoading.value = false;
    }
  }

  function selectRunConfiguration(id: string | null) {
    selectedRunConfigurationId.value = id;
    runConfigurationFile.value = {
      ...runConfigurationFile.value,
      selectedId: id,
    };
  }

  async function saveRunConfigurations(file: RunConfigurationFile) {
    const root = options.workspaceRoot.value;
    if (!root) return;
    runConfigurationSaving.value = true;
    runConfigurationError.value = null;
    const selectedId = selectedIdForFile({
      ...file,
      selectedId: file.selectedId ?? selectedRunConfigurationId.value,
    });
    const nextFile: RunConfigurationFile = { ...file, selectedId };
    try {
      await saveFile(root, nextFile);
      setRunConfigurationFile(nextFile);
    } catch (error) {
      runConfigurationError.value = normalizeError(error);
      throw error;
    } finally {
      runConfigurationSaving.value = false;
    }
  }

  async function runSelectedConfiguration() {
    const root = options.workspaceRoot.value;
    const configuration = selectedRunConfiguration.value;
    if (!root || !configuration) return null;
    return options.taskRuns.startRunConfiguration(configuration, root);
  }

  async function stopSelectedConfiguration() {
    const group = activeRunConfigurationGroup.value;
    if (!group) return;
    await options.taskRuns.stopRunGroup(group.id);
  }

  watch(options.workspaceRoot, () => {
    void reloadRunConfigurations();
  });

  return {
    activeRunConfigurationGroup,
    reloadRunConfigurations,
    runConfigurationError,
    runConfigurationFile,
    runConfigurationLoading,
    runConfigurationSaving,
    runConfigurations,
    runSelectedConfiguration,
    saveRunConfigurations,
    selectRunConfiguration,
    selectedRunConfiguration,
    selectedRunConfigurationId,
    stopSelectedConfiguration,
  };
}
