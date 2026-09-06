import { normalizeErrorMessage } from "@/lib/error";
import {
  computed,
  ref,
  watch,
  type ComputedRef,
  type Ref,
} from "vue";
import type { WorkspaceNative } from "@/lib/native";
import {
  createTaskRunStore,
  discoverWorkspaceTasks,
  type TaskRun,
  type TaskRunGroup,
  type WorkspaceTask,
} from "@/modules/tasks";
import type { TaskConsoleView } from "@/modules/tasks/taskConsoleTypes";

type TaskRunStoreLike = {
  activeRun: ComputedRef<TaskRun | null> | Ref<TaskRun | null>;
  dispose: () => Promise<void>;
  rerun: (id: number) => Promise<unknown>;
  runCommand: (command: string, cwd: string) => Promise<unknown>;
  runGroups: Ref<TaskRunGroup[]>;
  runs: Ref<TaskRun[]>;
  setActiveRun: (id: number) => void;
  startTask: (task: WorkspaceTask, cwd: string) => Promise<unknown>;
  stopRun: (id: number) => Promise<unknown>;
  stopRunGroup: (id: number) => Promise<unknown>;
};

export type TaskConsoleControllerOptions = {
  workspaceRoot: ComputedRef<string | null>;
  readTextFile: (path: string) => Promise<string | null>;
  discoverTasks?: typeof discoverWorkspaceTasks;
  taskRuns?: TaskRunStoreLike;
  /** Env-bound native surface for spawning tasks in this workspace's env. */
  wsNative: WorkspaceNative;
  openTaskTerminal: (input: { command: string; cwd: string }) => void;
};


export function useTaskConsoleController(options: TaskConsoleControllerOptions) {
  const discoverTasks = options.discoverTasks ?? discoverWorkspaceTasks;
  const taskRuns =
    options.taskRuns ?? createTaskRunStore({ wsNative: options.wsNative });
  const taskConsoleOpen = ref(false);
  const taskConsoleView = ref<TaskConsoleView>("tasks");
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
      workspaceTasksError.value = normalizeErrorMessage(error);
    } finally {
      workspaceTasksLoading.value = false;
    }
  }

  async function openTaskConsole(view: TaskConsoleView = "tasks") {
    taskConsoleOpen.value = true;
    taskConsoleView.value = view;
    if (workspaceTasks.value.length === 0 && !workspaceTasksLoading.value) {
      await refreshWorkspaceTasks();
    }
  }

  function setTaskConsoleView(view: TaskConsoleView) {
    taskConsoleView.value = view;
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

  function disposeTaskConsole(): Promise<void> {
    return taskRuns.dispose();
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
    setTaskConsoleView,
    taskConsoleOpen,
    taskConsoleView,
    taskRunList,
    taskRuns,
    workspaceTasks,
    workspaceTasksError,
    workspaceTasksLoading,
  };
}
