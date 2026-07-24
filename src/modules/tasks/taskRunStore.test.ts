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

  it("dispose() kills every running task and marks them stopped", async () => {
    const api = {
      shellBgSpawn: vi.fn(async () => 21),
      shellBgLogs: vi.fn(async () => ({
        bytes: "",
        nextOffset: 0,
        dropped: 0,
        exited: false,
        exitCode: null,
      })),
      shellBgKill: vi.fn(async () => {}),
    };
    const store = createTaskRunStore({ api, autoPoll: false, now: () => 3000 });

    await store.startTask(task, "/repo");
    await store.runCommand("pnpm test", "/repo");

    await store.dispose();

    expect(api.shellBgKill).toHaveBeenCalledTimes(2);
    expect(api.shellBgKill).toHaveBeenNthCalledWith(1, 21);
    expect(api.shellBgKill).toHaveBeenNthCalledWith(2, 21);
    for (const run of store.runs.value) {
      expect(run.status).toBe("stopped");
    }
  });

  it("dispose() leaves already-finished runs untouched and never rejects", async () => {
    const api = {
      shellBgSpawn: vi.fn(async () => 22),
      shellBgLogs: vi.fn(async () => ({
        bytes: "ok\n",
        nextOffset: 3,
        dropped: 0,
        exited: true,
        exitCode: 0,
      })),
      shellBgKill: vi.fn(async () => {}),
    };
    const store = createTaskRunStore({ api, autoPoll: false });

    const run = await store.startTask(task, "/repo");
    await store.pollRun(run.id); // 标记为 succeeded

    await expect(store.dispose()).resolves.toBeUndefined();
    expect(api.shellBgKill).not.toHaveBeenCalled();
    expect(store.runs.value[0].status).toBe("succeeded");
  });

  it("dispose() tolerates a failing kill without rejecting", async () => {
    const api = {
      shellBgSpawn: vi.fn(async () => 23),
      shellBgLogs: vi.fn(async () => ({
        bytes: "",
        nextOffset: 0,
        dropped: 0,
        exited: false,
        exitCode: null,
      })),
      // 后端已退出 / handle 失效时应被吞掉，不影响其余清理。
      shellBgKill: vi.fn(async () => {
        throw new Error("no background handle");
      }),
    };
    const store = createTaskRunStore({ api, autoPoll: false });

    await store.startTask(task, "/repo");
    await expect(store.dispose()).resolves.toBeUndefined();
    expect(api.shellBgKill).toHaveBeenCalledWith(23);
    // 即便 kill 抛错，run 仍被标记为 stopped 以反映已停止意图。
    expect(store.runs.value[0].status).toBe("stopped");
  });
});
