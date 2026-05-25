import { computed, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { RunConfigurationFile } from "@/modules/run-configs";
import type { TaskRunGroup } from "@/modules/tasks";
import { useRunConfigController } from "./useRunConfigController";

function createFile(): RunConfigurationFile {
  return {
    version: 1,
    selectedId: "full-stack",
    configurations: [
      {
        id: "full-stack",
        name: "Full Stack",
        commands: [
          { id: "web", name: "Vue", command: "pnpm run dev", cwd: "." },
          { id: "api", name: "API", command: "go run ./cmd/api", cwd: "api" },
        ],
      },
      {
        id: "rust",
        name: "Rust",
        commands: [{ id: "run", name: "Run", command: "cargo run" }],
      },
    ],
  };
}

function createTaskRuns() {
  const group: TaskRunGroup = {
    id: 10,
    configurationId: "full-stack",
    title: "Full Stack",
    status: "running",
    runIds: [1, 2],
    startedAtMs: 1000,
  };
  return {
    runGroups: ref<TaskRunGroup[]>([]),
    startRunConfiguration: vi.fn(async () => group),
    stopRunGroup: vi.fn(async () => undefined),
  };
}

describe("useRunConfigController", () => {
  it("loads project run configurations and keeps the selected item", async () => {
    const root = ref("/repo");
    const loadFile = vi.fn(async () => createFile());
    const controller = useRunConfigController({
      workspaceRoot: computed(() => root.value),
      taskRuns: createTaskRuns(),
      loadFile,
      saveFile: vi.fn(),
    });

    await controller.reloadRunConfigurations();

    expect(loadFile).toHaveBeenCalledWith("/repo");
    expect(controller.runConfigurations.value).toHaveLength(2);
    expect(controller.selectedRunConfiguration.value?.name).toBe("Full Stack");
    expect(controller.runConfigurationError.value).toBeNull();
  });

  it("falls back to the first configuration when the saved selection is missing", async () => {
    const loadFile = vi.fn(async () => ({
      ...createFile(),
      selectedId: "missing",
    }));
    const controller = useRunConfigController({
      workspaceRoot: computed(() => "/repo"),
      taskRuns: createTaskRuns(),
      loadFile,
      saveFile: vi.fn(),
    });

    await controller.reloadRunConfigurations();

    expect(controller.selectedRunConfigurationId.value).toBe("full-stack");
  });

  it("saves configuration changes with the current selected id", async () => {
    const saveFile = vi.fn(async () => undefined);
    const controller = useRunConfigController({
      workspaceRoot: computed(() => "/repo"),
      taskRuns: createTaskRuns(),
      loadFile: vi.fn(async () => createFile()),
      saveFile,
    });
    await controller.reloadRunConfigurations();

    await controller.saveRunConfigurations({
      version: 1,
      selectedId: null,
      configurations: [
        {
          id: "rust",
          name: "Rust",
          commands: [{ id: "run", name: "Run", command: "cargo run" }],
        },
      ],
    });

    expect(saveFile).toHaveBeenCalledWith("/repo", {
      version: 1,
      selectedId: "rust",
      configurations: [
        {
          id: "rust",
          name: "Rust",
          commands: [{ id: "run", name: "Run", command: "cargo run" }],
        },
      ],
    });
    expect(controller.selectedRunConfiguration.value?.id).toBe("rust");
  });

  it("runs and stops the selected run configuration", async () => {
    const taskRuns = createTaskRuns();
    taskRuns.runGroups.value = [
      {
        id: 7,
        configurationId: "full-stack",
        title: "Full Stack",
        status: "running",
        runIds: [1, 2],
        startedAtMs: 1000,
      },
    ];
    const controller = useRunConfigController({
      workspaceRoot: computed(() => "/repo"),
      taskRuns,
      loadFile: vi.fn(async () => createFile()),
      saveFile: vi.fn(),
    });
    await controller.reloadRunConfigurations();

    await controller.runSelectedConfiguration();
    await controller.stopSelectedConfiguration();

    expect(taskRuns.startRunConfiguration).toHaveBeenCalledWith(
      controller.selectedRunConfiguration.value,
      "/repo",
    );
    expect(controller.activeRunConfigurationGroup.value?.id).toBe(7);
    expect(taskRuns.stopRunGroup).toHaveBeenCalledWith(7);
  });
});
