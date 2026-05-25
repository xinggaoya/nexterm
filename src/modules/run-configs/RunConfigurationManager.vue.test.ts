// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { i18n } from "@/modules/i18n";
import type { TaskRunGroup, WorkspaceTask } from "@/modules/tasks";
import RunConfigurationManager from "./RunConfigurationManager.vue";
import type { RunConfiguration } from "./runConfigStore";

const tasks: WorkspaceTask[] = [
  {
    id: "package:dev",
    title: "pnpm run dev",
    command: "pnpm run dev",
    source: "package",
    detail: "package.json",
  },
  {
    id: "cargo:run",
    title: "cargo run",
    command: "cargo run",
    source: "cargo",
    detail: "Cargo.toml",
  },
];

const configurations: RunConfiguration[] = [
  {
    id: "full-stack",
    name: "Full Stack",
    commands: [
      { id: "web", name: "Vue", command: "pnpm run dev", cwd: "." },
      { id: "api", name: "API", command: "go run ./cmd/api", cwd: "api" },
    ],
  },
];

const groups: TaskRunGroup[] = [
  {
    id: 7,
    configurationId: "full-stack",
    title: "Full Stack",
    status: "running",
    runIds: [1, 2],
    startedAtMs: 1000,
  },
];

describe("RunConfigurationManager", () => {
  it("edits, saves, runs, and stops project run configurations", async () => {
    const wrapper = mount(RunConfigurationManager, {
      props: {
        rootPath: "/repo",
        tasks,
        configurations,
        selectedId: "full-stack",
        groups: [],
      },
      global: { plugins: [i18n] },
    });

    expect(wrapper.find("[data-run-config-manager]").exists()).toBe(true);
    expect(wrapper.findAll("[data-run-config-row]")).toHaveLength(1);
    expect(wrapper.text()).toContain("Full Stack");
    expect(wrapper.findAll("[data-run-config-command-row]")).toHaveLength(2);

    await wrapper.find("[data-run-config-name-input] input").setValue("Dev Stack");
    await wrapper.find("[data-add-task-to-run-config='cargo:run']").trigger("click");
    await wrapper.find("[data-save-run-configs]").trigger("click");
    await wrapper.find("[data-run-config='full-stack']").trigger("click");
    await wrapper.setProps({ groups });
    await wrapper.find("[data-stop-run-config-group='7']").trigger("click");

    expect(wrapper.emitted("save")?.[0][0]).toMatchObject({
      version: 1,
      selectedId: "full-stack",
      configurations: [
        {
          id: "full-stack",
          name: "Dev Stack",
          commands: expect.arrayContaining([
            expect.objectContaining({ command: "cargo run", cwd: "." }),
          ]),
        },
      ],
    });
    expect(wrapper.emitted("run")?.[0][0]).toMatchObject({
      id: "full-stack",
      name: "Dev Stack",
    });
    expect(wrapper.emitted("stopGroup")?.[0]).toEqual([7]);
  });

  it("creates and deletes configurations without leaving an invalid selection", async () => {
    const wrapper = mount(RunConfigurationManager, {
      props: {
        rootPath: "/repo",
        tasks: [],
        configurations: [],
        selectedId: null,
        groups: [],
      },
      global: { plugins: [i18n] },
    });

    await wrapper.find("[data-add-run-config]").trigger("click");
    expect(wrapper.findAll("[data-run-config-row]")).toHaveLength(1);

    await wrapper.find("[data-delete-run-config]").trigger("click");
    await wrapper.find("[data-save-run-configs]").trigger("click");

    expect(wrapper.emitted("save")?.[0][0]).toEqual({
      version: 1,
      selectedId: null,
      configurations: [],
    });
  });
});
