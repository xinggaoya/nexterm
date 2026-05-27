import { computed, ref, type Ref } from "vue";
import { native, type ShellBgLogResponse } from "@/lib/native";
import type { WorkspaceTask } from "./taskTypes";

export type TaskRunStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "stopped"
  | "error";

export type TaskRun = {
  id: number;
  handle: number | null;
  groupId: number | null;
  task: WorkspaceTask | null;
  title: string;
  command: string;
  cwd: string;
  status: TaskRunStatus;
  exitCode: number | null;
  startedAtMs: number;
  log: string;
  logOffset: number;
  droppedBytes: number;
  error: string | null;
};

export type TaskRunGroup = {
  id: number;
  title: string;
  status: TaskRunStatus;
  runIds: number[];
  startedAtMs: number;
};

export type TaskRunApi = {
  shellBgSpawn: (command: string, cwd?: string | null) => Promise<number>;
  shellBgLogs: (
    handle: number,
    sinceOffset: number,
  ) => Promise<ShellBgLogResponse>;
  shellBgKill: (handle: number) => Promise<void>;
};

export type TaskRunStoreOptions = {
  api?: TaskRunApi;
  autoPoll?: boolean;
  pollIntervalMs?: number;
  now?: () => number;
};

export type TaskRunStore = ReturnType<typeof createTaskRunStore>;

const DEFAULT_POLL_INTERVAL_MS = 800;

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function trimCommand(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) throw new Error("empty command");
  return trimmed;
}

export function createTaskRunStore(options: TaskRunStoreOptions = {}) {
  const api = options.api ?? native;
  const autoPoll = options.autoPoll ?? true;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const now = options.now ?? Date.now;
  const runs: Ref<TaskRun[]> = ref([]);
  const runGroups: Ref<TaskRunGroup[]> = ref([]);
  const activeRunId = ref<number | null>(null);
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  let nextRunId = 1;

  const activeRun = computed(
    () => runs.value.find((run) => run.id === activeRunId.value) ?? null,
  );

  function setActiveRun(id: number) {
    activeRunId.value = id;
  }

  function clearPollTimer(id: number) {
    const timer = timers.get(id);
    if (!timer) return;
    clearTimeout(timer);
    timers.delete(id);
  }

  function findRun(id: number): TaskRun | null {
    return runs.value.find((run) => run.id === id) ?? null;
  }

  function findRunGroup(id: number): TaskRunGroup | null {
    return runGroups.value.find((group) => group.id === id) ?? null;
  }

  function aggregateGroupStatus(group: TaskRunGroup): TaskRunStatus {
    const childRuns = group.runIds
      .map((id) => findRun(id))
      .filter((run): run is TaskRun => !!run);
    if (childRuns.length === 0) return "error";
    if (childRuns.some((run) => run.status === "running")) return "running";
    if (childRuns.some((run) => run.status === "error")) return "error";
    if (childRuns.some((run) => run.status === "failed")) return "failed";
    if (childRuns.some((run) => run.status === "stopped")) return "stopped";
    return "succeeded";
  }

  function updateRunGroupStatus(groupId: number | null) {
    if (groupId === null) return;
    const group = findRunGroup(groupId);
    if (!group) return;
    group.status = aggregateGroupStatus(group);
  }

  function schedulePoll(id: number) {
    if (!autoPoll || timers.has(id)) return;
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        void pollRun(id);
      }, pollIntervalMs),
    );
  }

  async function startRun(input: {
    groupId?: number | null;
    task: WorkspaceTask | null;
    title: string;
    command: string;
    cwd: string;
  }): Promise<TaskRun> {
    const command = trimCommand(input.command);
    const run: TaskRun = {
      id: nextRunId++,
      handle: null,
      groupId: input.groupId ?? null,
      task: input.task,
      title: input.title,
      command,
      cwd: input.cwd,
      status: "running",
      exitCode: null,
      startedAtMs: now(),
      log: "",
      logOffset: 0,
      droppedBytes: 0,
      error: null,
    };
    runs.value = [run, ...runs.value];
    setActiveRun(run.id);

    try {
      const handle = await api.shellBgSpawn(command, input.cwd);
      const stored = findRun(run.id);
      if (stored) stored.handle = handle;
      schedulePoll(run.id);
    } catch (error) {
      const stored = findRun(run.id);
      if (stored) {
        stored.status = "error";
        stored.error = normalizeError(error);
        updateRunGroupStatus(stored.groupId);
      }
    }

    return findRun(run.id) ?? run;
  }

  async function startTask(task: WorkspaceTask, cwd: string): Promise<TaskRun> {
    return startRun({
      task,
      title: task.title,
      command: task.command,
      cwd,
    });
  }

  async function runCommand(command: string, cwd: string): Promise<TaskRun> {
    const trimmed = trimCommand(command);
    return startRun({
      task: null,
      title: trimmed,
      command: trimmed,
      cwd,
    });
  }

  async function pollRun(id: number): Promise<void> {
    clearPollTimer(id);
    const run = findRun(id);
    if (!run || run.handle === null || run.status !== "running") return;

    try {
      const result = await api.shellBgLogs(run.handle, run.logOffset);
      run.log += result.bytes;
      run.logOffset = result.nextOffset;
      run.droppedBytes = result.dropped;
      if (result.exited) {
        run.exitCode = result.exitCode;
        run.status = result.exitCode === 0 ? "succeeded" : "failed";
        updateRunGroupStatus(run.groupId);
        return;
      }
      schedulePoll(id);
    } catch (error) {
      run.status = "error";
      run.error = normalizeError(error);
      updateRunGroupStatus(run.groupId);
    }
  }

  async function stopRun(id: number): Promise<void> {
    clearPollTimer(id);
    const run = findRun(id);
    if (!run || run.handle === null || run.status !== "running") return;
    await api.shellBgKill(run.handle);
    run.status = "stopped";
    updateRunGroupStatus(run.groupId);
  }

  async function stopRunGroup(id: number): Promise<void> {
    const group = findRunGroup(id);
    if (!group) return;
    await Promise.all(group.runIds.map((runId) => stopRun(runId)));
    group.status = "stopped";
  }

  async function rerun(id: number): Promise<TaskRun> {
    const run = findRun(id);
    if (!run) throw new Error("task run not found");
    if (run.task) return startTask(run.task, run.cwd);
    return runCommand(run.command, run.cwd);
  }

  function dispose() {
    for (const id of timers.keys()) clearPollTimer(id);
  }

  return {
    runs,
    activeRunId,
    activeRun,
    runGroups,
    setActiveRun,
    startTask,
    runCommand,
    pollRun,
    stopRun,
    stopRunGroup,
    rerun,
    dispose,
  };
}
