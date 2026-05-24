import { computed, nextTick, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceTask } from "@/modules/tasks";
import { useTaskConsoleController } from "./useTaskConsoleController";

describe("useTaskConsoleController", () => {
  const task: WorkspaceTask = {
    id: "package:dev",
    title: "pnpm run dev",
    command: "pnpm run dev",
    source: "package",
    detail: "package.json",
  };

  function createTaskRuns() {
    return {
      runs: ref([]),
      activeRun: ref(null),
      setActiveRun: vi.fn(),
      startTask: vi.fn(async () => null),
      runCommand: vi.fn(async () => null),
      stopRun: vi.fn(async () => undefined),
      rerun: vi.fn(async () => null),
      dispose: vi.fn(),
    };
  }

  it("opens the task console and discovers workspace tasks", async () => {
    const root = ref("/repo");
    const discoverTasks = vi.fn(async () => [task]);
    const controller = useTaskConsoleController({
      workspaceRoot: computed(() => root.value),
      readTextFile: vi.fn(),
      discoverTasks,
      taskRuns: createTaskRuns(),
      openTaskTerminal: vi.fn(),
    });

    await controller.openTaskConsole();

    expect(controller.taskConsoleOpen.value).toBe(true);
    expect(discoverTasks).toHaveBeenCalledWith("/repo", expect.any(Function));
    expect(controller.workspaceTasks.value).toEqual([task]);
    expect(controller.workspaceTasksError.value).toBeNull();
  });

  it("runs discovered tasks and ad-hoc commands in the workspace root", async () => {
    const root = ref("/repo");
    const taskRuns = createTaskRuns();
    const controller = useTaskConsoleController({
      workspaceRoot: computed(() => root.value),
      readTextFile: vi.fn(),
      discoverTasks: vi.fn(async () => []),
      taskRuns,
      openTaskTerminal: vi.fn(),
    });

    await controller.runWorkspaceTask(task);
    await controller.runWorkspaceCommand("pnpm test");

    expect(controller.taskConsoleOpen.value).toBe(true);
    expect(taskRuns.startTask).toHaveBeenCalledWith(task, "/repo");
    expect(taskRuns.runCommand).toHaveBeenCalledWith("pnpm test", "/repo");
  });

  it("clears tasks on workspace changes and refreshes again when open", async () => {
    const root = ref("/repo");
    const discoverTasks = vi.fn(async () => [task]);
    const controller = useTaskConsoleController({
      workspaceRoot: computed(() => root.value),
      readTextFile: vi.fn(),
      discoverTasks,
      taskRuns: createTaskRuns(),
      openTaskTerminal: vi.fn(),
    });
    await controller.openTaskConsole();

    discoverTasks.mockResolvedValueOnce([]);
    root.value = "/other";
    await nextTick();
    await nextTick();

    expect(controller.workspaceTasks.value).toEqual([]);
    expect(discoverTasks).toHaveBeenLastCalledWith("/other", expect.any(Function));
  });

  it("opens task runs in a terminal and disposes the run store", () => {
    const taskRuns = createTaskRuns();
    const openTaskTerminal = vi.fn();
    const controller = useTaskConsoleController({
      workspaceRoot: computed(() => "/repo"),
      readTextFile: vi.fn(),
      taskRuns,
      openTaskTerminal,
    });

    controller.runTaskInTerminal({ command: "pnpm test", cwd: "/repo" });
    controller.disposeTaskConsole();

    expect(openTaskTerminal).toHaveBeenCalledWith({
      command: "pnpm test",
      cwd: "/repo",
    });
    expect(taskRuns.dispose).toHaveBeenCalled();
  });
});
