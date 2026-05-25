import { describe, expect, it, vi } from "vitest";
import { createTaskRunStore } from "./taskRunStore";
import type { WorkspaceTask } from "./taskTypes";
import type { RunConfiguration } from "@/modules/run-configs";

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

  it("starts and stops all commands in a run configuration as one group", async () => {
    let nextHandle = 30;
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
    const config: RunConfiguration = {
      id: "full-stack",
      name: "Full Stack",
      commands: [
        { id: "web", name: "Vue", command: "pnpm run dev", cwd: "." },
        {
          id: "api",
          name: "Spring Boot",
          command: "./mvnw spring-boot:run",
          cwd: "backend",
        },
      ],
    };
    const store = createTaskRunStore({ api, autoPoll: false, now: () => 3000 });

    const group = await store.startRunConfiguration(config, "/repo");

    expect(api.shellBgSpawn).toHaveBeenNthCalledWith(1, "pnpm run dev", "/repo");
    expect(api.shellBgSpawn).toHaveBeenNthCalledWith(
      2,
      "./mvnw spring-boot:run",
      "/repo/backend",
    );
    expect(group).toMatchObject({
      configurationId: "full-stack",
      title: "Full Stack",
      status: "running",
      runIds: [1, 2],
    });
    expect(store.runGroups.value).toHaveLength(1);

    await store.stopRunGroup(group.id);

    expect(api.shellBgKill).toHaveBeenCalledWith(30);
    expect(api.shellBgKill).toHaveBeenCalledWith(31);
    expect(store.runGroups.value[0]).toMatchObject({ status: "stopped" });
  });

  it("aggregates run configuration group status from child runs", async () => {
    const logResults = [
      {
        bytes: "web ready\n",
        nextOffset: 10,
        dropped: 0,
        exited: true,
        exitCode: 0,
      },
      {
        bytes: "api failed\n",
        nextOffset: 11,
        dropped: 0,
        exited: true,
        exitCode: 1,
      },
    ];
    const api = {
      shellBgSpawn: vi.fn(async () => api.shellBgSpawn.mock.calls.length + 40),
      shellBgLogs: vi.fn(async () => logResults.shift()!),
      shellBgKill: vi.fn(async () => {}),
    };
    const store = createTaskRunStore({ api, autoPoll: false });
    const group = await store.startRunConfiguration(
      {
        id: "full-stack",
        name: "Full Stack",
        commands: [
          { id: "web", name: "Vue", command: "pnpm run dev" },
          { id: "api", name: "API", command: "go run ./cmd/api" },
        ],
      },
      "/repo",
    );

    await store.pollRun(group.runIds[0]);
    expect(store.runGroups.value[0]).toMatchObject({ status: "running" });

    await store.pollRun(group.runIds[1]);
    expect(store.runGroups.value[0]).toMatchObject({ status: "failed" });
  });

  it("reruns configuration groups without corrupting resolved Windows cwd paths", async () => {
    const api = {
      shellBgSpawn: vi.fn(async () => api.shellBgSpawn.mock.calls.length + 50),
      shellBgLogs: vi.fn(),
      shellBgKill: vi.fn(async () => {}),
    };
    const store = createTaskRunStore({ api, autoPoll: false });
    const group = await store.startRunConfiguration(
      {
        id: "windows-stack",
        name: "Windows Stack",
        commands: [
          { id: "api", name: "API", command: "go run ./cmd/api", cwd: "api" },
        ],
      },
      "D:/repo",
    );

    await store.rerunGroup(group.id);

    expect(api.shellBgSpawn).toHaveBeenNthCalledWith(
      2,
      "go run ./cmd/api",
      "D:/repo/api",
    );
  });
});
