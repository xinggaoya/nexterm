import {
  computed,
  ref,
  watch,
  type ComputedRef,
  type Ref,
} from "vue";
import {
  createTaskRunStore,
  discoverWorkspaceTasks,
  type TaskRun,
  type WorkspaceTask,
} from "@/modules/tasks";

type TaskRunStoreLike = {
  activeRun: ComputedRef<TaskRun | null> | Ref<TaskRun | null>;
  dispose: () => void;
  rerun: (id: number) => Promise<unknown>;
  runCommand: (command: string, cwd: string) => Promise<unknown>;
  runs: Ref<TaskRun[]>;
  setActiveRun: (id: number) => void;
  startTask: (task: WorkspaceTask, cwd: string) => Promise<unknown>;
  stopRun: (id: number) => Promise<unknown>;
};

export type TaskConsoleControllerOptions = {
  workspaceRoot: ComputedRef<string | null>;
  readTextFile: (path: string) => Promise<string | null>;
  discoverTasks?: typeof discoverWorkspaceTasks;
  taskRuns?: TaskRunStoreLike;
  openTaskTerminal: (input: { command: string; cwd: string }) => void;
};

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function useTaskConsoleController(options: TaskConsoleControllerOptions) {
  const discoverTasks = options.discoverTasks ?? discoverWorkspaceTasks;
  const taskRuns = options.taskRuns ?? createTaskRunStore();
  const taskConsoleOpen = ref(false);
  const workspaceTasks = ref<WorkspaceTask[]>([]);
  const workspaceTasksLoading = ref(false);
  const workspaceTasksError = ref<string | null>(null);
  const taskRunList = computed(() => taskRuns.runs.value);
  const activeTaskRun = computed(() => taskRuns.activeRun.value);

  async function refreshWorkspaceTasks() {
    const root = options.workspaceRoot.value;
    if (!root) {
      workspaceTasks.value = [];
      workspaceTasksError.value = null;
      return;
    }
    workspaceTasksLoading.value = true;
    workspaceTasksError.value = null;
    try {
      workspaceTasks.value = await discoverTasks(root, options.readTextFile);
    } catch (error) {
      workspaceTasks.value = [];
      workspaceTasksError.value = normalizeError(error);
    } finally {
      workspaceTasksLoading.value = false;
    }
  }

  async function openTaskConsole() {
    taskConsoleOpen.value = true;
    if (workspaceTasks.value.length === 0 && !workspaceTasksLoading.value) {
      await refreshWorkspaceTasks();
    }
  }

  function closeTaskConsole() {
    taskConsoleOpen.value = false;
  }

  async function runWorkspaceTask(task: WorkspaceTask) {
    const root = options.workspaceRoot.value;
    if (!root) return;
    taskConsoleOpen.value = true;
    await taskRuns.startTask(task, root);
  }

  async function runWorkspaceCommand(command: string) {
    const root = options.workspaceRoot.value;
    if (!root) return;
    taskConsoleOpen.value = true;
    await taskRuns.runCommand(command, root);
  }

  function runTaskInTerminal(input: { command: string; cwd: string }) {
    options.openTaskTerminal(input);
  }

  function disposeTaskConsole() {
    taskRuns.dispose();
  }

  watch(options.workspaceRoot, () => {
    workspaceTasks.value = [];
    workspaceTasksError.value = null;
    if (taskConsoleOpen.value) void refreshWorkspaceTasks();
  });

  return {
    activeTaskRun,
    closeTaskConsole,
    disposeTaskConsole,
    openTaskConsole,
    refreshWorkspaceTasks,
    runTaskInTerminal,
    runWorkspaceCommand,
    runWorkspaceTask,
    taskConsoleOpen,
    taskRunList,
    taskRuns,
    workspaceTasks,
    workspaceTasksError,
    workspaceTasksLoading,
  };
}
