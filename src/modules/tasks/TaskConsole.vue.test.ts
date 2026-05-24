// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { i18n } from "@/modules/i18n";
import TaskConsole from "./TaskConsole.vue";
import type { TaskRun } from "./taskRunStore";
import type { WorkspaceTask } from "./taskTypes";

const tasks: WorkspaceTask[] = [
  {
    id: "package:dev",
    title: "pnpm run dev",
    command: "pnpm run dev",
    source: "package",
    detail: "package.json",
  },
  {
    id: "cargo:test",
    title: "cargo test",
    command: "cargo test",
    source: "cargo",
    detail: "Cargo.toml",
  },
];

const runningRun: TaskRun = {
  id: 1,
  handle: 7,
  task: tasks[0],
  title: "pnpm run dev",
  command: "pnpm run dev",
  cwd: "/repo",
  status: "running",
  exitCode: null,
  startedAtMs: 1000,
  log: "VITE ready\n",
  logOffset: 11,
  droppedBytes: 0,
  error: null,
};

describe("TaskConsole", () => {
  it("shows discovered tasks and emits run events", async () => {
    const wrapper = mount(TaskConsole, {
      props: {
        rootPath: "/repo",
        tasks,
        runs: [],
        activeRun: null,
        loadingTasks: false,
        taskError: null,
      },
      global: { plugins: [i18n] },
    });

    expect(wrapper.text()).toContain("Task Console");
    expect(wrapper.findAll("[data-task-row]")).toHaveLength(2);
    expect(wrapper.text()).toContain("pnpm run dev");
    expect(wrapper.text()).toContain("Cargo.toml");

    await wrapper.find("[data-run-task='package:dev']").trigger("click");
    await wrapper.find("[data-task-command-input] input").setValue("cargo check");
    await wrapper.find("[data-run-command]").trigger("click");

    expect(wrapper.emitted("runTask")?.[0]).toEqual([tasks[0]]);
    expect(wrapper.emitted("runCommand")?.[0]).toEqual(["cargo check"]);
  });

  it("emits close from the panel chrome", async () => {
    const wrapper = mount(TaskConsole, {
      props: {
        rootPath: "/repo",
        tasks,
        runs: [],
        activeRun: null,
        loadingTasks: false,
        taskError: null,
      },
      global: { plugins: [i18n] },
    });

    await wrapper.find("[data-close-task-console]").trigger("click");

    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("shows the active run log and emits lifecycle actions", async () => {
    const wrapper = mount(TaskConsole, {
      props: {
        rootPath: "/repo",
        tasks,
        runs: [runningRun],
        activeRun: runningRun,
        loadingTasks: false,
        taskError: null,
      },
      global: { plugins: [i18n] },
    });

    expect(wrapper.find("[data-task-log]").text()).toContain("VITE ready");
    expect(wrapper.find("[data-task-run-status]").text()).toContain("running");

    await wrapper.find("[data-task-run-row='1']").trigger("click");
    await wrapper.find("[data-stop-task='1']").trigger("click");
    await wrapper.find("[data-rerun-task='1']").trigger("click");
    await wrapper.find("[data-run-task-terminal='1']").trigger("click");

    expect(wrapper.emitted("selectRun")?.[0]).toEqual([1]);
    expect(wrapper.emitted("stopRun")?.[0]).toEqual([1]);
    expect(wrapper.emitted("rerun")?.[0]).toEqual([1]);
    expect(wrapper.emitted("runInTerminal")?.[0]).toEqual([
      { command: "pnpm run dev", cwd: "/repo" },
    ]);
  });
});
