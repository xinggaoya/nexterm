import { describe, expect, it, vi } from "vitest";
import { createTaskRunStore } from "./taskRunStore";
import type { WorkspaceTask } from "./taskTypes";

const task: WorkspaceTask = {
  id: "package:dev",
  title: "pnpm run dev",
  command: "pnpm run dev",
  source: "package",
  detail: "package.json",
};

describe("task run store", () => {
  it("starts a background task and folds incremental logs into the active run", async () => {
    const api = {
      shellBgSpawn: vi.fn(async () => 7),
      shellBgLogs: vi.fn(async () => ({
        bytes: "ready\n",
        nextOffset: 6,
        dropped: 0,
        exited: true,
        exitCode: 0,
      })),
      shellBgKill: vi.fn(async () => {}),
    };
    const store = createTaskRunStore({ api, autoPoll: false, now: () => 1000 });

    const run = await store.startTask(task, "/repo");
    await store.pollRun(run.id);

    expect(api.shellBgSpawn).toHaveBeenCalledWith("pnpm run dev", "/repo");
    expect(api.shellBgLogs).toHaveBeenCalledWith(7, 0);
    expect(store.activeRun.value).toMatchObject({
      id: run.id,
      handle: 7,
      title: "pnpm run dev",
      command: "pnpm run dev",
      cwd: "/repo",
      status: "succeeded",
      exitCode: 0,
      log: "ready\n",
      logOffset: 6,
      startedAtMs: 1000,
    });
  });

  it("stops running tasks and reruns them with the same command context", async () => {
    let nextHandle = 10;
    const api = {
      shellBgSpawn: vi.fn(async () => nextHandle++),
      shellBgLogs: vi.fn(async () => ({
        bytes: "",
        nextOffset: 0,
        dropped: 0,
        exited: false,
        exitCode: null,
      })),
      shellBgKill: vi.fn(async () => {}),
    };
    const store = createTaskRunStore({ api, autoPoll: false, now: () => 2000 });

    const first = await store.startTask(task, "/repo");
    await store.stopRun(first.id);
    const second = await store.rerun(first.id);

    expect(api.shellBgKill).toHaveBeenCalledWith(10);
    expect(store.runs.value.find((run) => run.id === first.id)).toMatchObject({
      status: "stopped",
    });
    expect(second).toMatchObject({
      handle: 11,
      command: "pnpm run dev",
      cwd: "/repo",
      status: "running",
    });
    expect(store.activeRun.value?.id).toBe(second.id);
  });

  it("runs one-off commands as temporary tasks", async () => {
    const api = {
      shellBgSpawn: vi.fn(async () => 15),
      shellBgLogs: vi.fn(),
      shellBgKill: vi.fn(async () => {}),
    };
    const store = createTaskRunStore({ api, autoPoll: false });

    const run = await store.runCommand("cargo test", "/repo");

    expect(run).toMatchObject({
      title: "cargo test",
      command: "cargo test",
      cwd: "/repo",
      task: null,
      status: "running",
    });
    expect(api.shellBgSpawn).toHaveBeenCalledWith("cargo test", "/repo");
  });
});
