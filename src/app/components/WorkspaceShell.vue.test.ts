// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { computed, ref, type Ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { TaskRunGroup, WorkspaceTask } from "@/modules/tasks";
import type { TaskConsoleView } from "@/modules/tasks/taskConsoleTypes";
import type { Tab } from "@/modules/tabs/tabsTypes";
import WorkspaceShell from "./WorkspaceShell.vue";

vi.mock("@/modules/terminal/TerminalStack.vue", () => ({
  default: {
    props: ["tabs", "activeId"],
    emits: ["focusLeaf", "cwd", "title"],
    template:
      '<section data-terminal-stack><button data-focus @click="$emit(\'focusLeaf\', 1, 2)" /><button data-cwd @click="$emit(\'cwd\', 2, \'/tmp\')" /><button data-title @click="$emit(\'title\', 2, \'shell\')" /></section>',
  },
}));

vi.mock("@/modules/preview/PreviewStack.vue", () => ({
  default: {
    props: ["tabs", "activeId"],
    emits: ["urlChange"],
    template: '<section data-preview-stack />',
  },
}));

vi.mock("@/modules/markdown/MarkdownStack.vue", () => ({
  default: {
    props: ["tabs", "activeId"],
    template: '<section data-markdown-stack />',
  },
}));

vi.mock("@/modules/editor/GitDiffStack.vue", () => ({
  default: {
    props: ["tabs", "activeId"],
    template: '<section data-git-diff-stack />',
  },
}));

vi.mock("@/modules/git-history/GitHistoryStack.vue", () => ({
  default: {
    props: ["tabs", "activeId"],
    emits: ["openCommitFile"],
    template: '<section data-git-history-stack />',
  },
}));

vi.mock("@/modules/editor/EditorPane.vue", () => ({
  default: {
    props: ["path"],
    emits: ["dirtyChange"],
    setup(_props: unknown, { expose }: { expose: (api: unknown) => void }) {
      expose({ save: vi.fn(async () => undefined) });
      return {};
    },
    template: '<section data-editor-pane>{{ path }}</section>',
  },
}));

vi.mock("@/modules/source-control/SourceControlPanel.vue", () => ({
  default: {
    props: ["rootPath", "fsEvent"],
    emits: ["openDiff", "openHistory"],
    template:
      '<aside data-source-control><button data-open-diff @click="$emit(\'openDiff\', { repoRoot: \'/repo\', path: \'src/main.ts\', mode: \'-\', originalPath: null, title: \'main.ts\' })" /><button data-open-history @click="$emit(\'openHistory\', { repoRoot: \'/repo\', branch: \'main\' })" /></aside>',
  },
}));

vi.mock("@/modules/explorer/FileExplorer.vue", () => ({
  default: {
    props: ["rootPath", "fsEvent"],
    emits: ["openFile", "openMarkdownPreview"],
    template:
      '<aside data-file-explorer><button data-open-file @click="$emit(\'openFile\', \'/repo/src/main.ts\', false)" /><button data-open-markdown @click="$emit(\'openMarkdownPreview\', \'/repo/README.md\')" /></aside>',
  },
}));

vi.mock("@/modules/tasks/TaskConsole.vue", () => ({
  default: {
    props: [
      "rootPath",
      "view",
      "tasks",
      "runs",
      "activeRun",
      "loadingTasks",
      "taskError",
      "runConfigurations",
      "selectedRunConfigurationId",
      "runConfigurationGroups",
      "runConfigurationSaving",
      "runConfigurationError",
    ],
    emits: [
      "close",
      "updateView",
      "refreshTasks",
      "runTask",
      "runCommand",
      "selectRun",
      "stopRun",
      "rerun",
      "runInTerminal",
      "saveRunConfigurations",
      "selectRunConfiguration",
      "runConfiguration",
      "stopRunConfigurationGroup",
    ],
    template:
      '<section data-task-console><button data-close-task-console @click="$emit(\'close\')" /><button data-refresh-tasks @click="$emit(\'refreshTasks\')" /><button data-run-task @click="$emit(\'runTask\', tasks[0])" /><button data-run-command @click="$emit(\'runCommand\', \'pnpm test\')" /></section>',
  },
}));

function createLayout() {
  return {
    leftPanelOpen: ref(true),
    rightPanelOpen: ref(true),
    sourceControlSplitSize: computed(() => "256px"),
    sourceControlSplitMin: computed(() => "180px"),
    sourceControlSplitMax: computed(() => "520px"),
    sourceControlPaneClass: computed(() => "source"),
    explorerSplitSize: computed(() => "600px"),
    explorerSplitMin: computed(() => "380px"),
    explorerSplitMax: computed(() => "720px"),
    explorerPaneClass: computed(() => "explorer"),
    panelResizeTriggerSize: 6,
    rightSplitHost: ref<HTMLElement | null>(null),
    updateSourceControlSplitSize: vi.fn(),
    flushSourceControlWidthSave: vi.fn(),
    updateExplorerSplitSize: vi.fn(),
    flushExplorerWidthSave: vi.fn(),
  };
}

function createTaskConsole(task: WorkspaceTask) {
  return {
    taskConsoleOpen: ref(true),
    taskConsoleView: ref<TaskConsoleView>("tasks"),
    workspaceTasks: ref([task]),
    taskRunList: ref([]),
    activeTaskRun: ref(null),
    workspaceTasksLoading: ref(false),
    workspaceTasksError: ref(null),
    closeTaskConsole: vi.fn(),
    refreshWorkspaceTasks: vi.fn(),
    runWorkspaceTask: vi.fn(),
    runWorkspaceCommand: vi.fn(),
    runTaskInTerminal: vi.fn(),
    setTaskConsoleView: vi.fn(),
    taskRuns: {
      runGroups: ref<TaskRunGroup[]>([]),
      setActiveRun: vi.fn(),
      stopRun: vi.fn(),
      rerun: vi.fn(),
      startRunConfiguration: vi.fn(),
      stopRunGroup: vi.fn(),
    },
  };
}

function createRunConfigs() {
  return {
    runConfigurations: ref([]),
    selectedRunConfigurationId: ref(null),
    runConfigurationSaving: ref(false),
    runConfigurationError: ref(null),
    activeRunConfigurationGroup: ref(null) as Ref<TaskRunGroup | null>,
    saveRunConfigurations: vi.fn(),
    selectRunConfiguration: vi.fn(),
    runSelectedConfiguration: vi.fn(),
    stopSelectedConfiguration: vi.fn(),
  };
}

describe("WorkspaceShell", () => {
  const terminalTab: Tab = {
    id: 1,
    kind: "terminal",
    title: "shell",
    cwd: "/repo",
    paneTree: { kind: "leaf", id: 2, cwd: "/repo" },
    activeLeafId: 2,
  };
  const task: WorkspaceTask = {
    id: "package:test",
    title: "pnpm test",
    command: "pnpm test",
    source: "package",
    detail: "package.json",
  };

  function mountShell() {
    const tabsStore = {
      tabs: [terminalTab],
      activeId: 1,
      focusPane: vi.fn(),
      setLeafCwd: vi.fn(),
      setLeafTitle: vi.fn(),
      updateTab: vi.fn(),
      openCommitFileDiffTab: vi.fn(),
    };
    const taskConsole = createTaskConsole(task);
    const wrapper = mount(WorkspaceShell, {
      props: {
        activeTab: terminalTab,
        activeId: 1,
        layout: createLayout(),
        tabs: [terminalTab],
        tabsStore,
        taskConsole,
        runConfigs: createRunConfigs(),
        workspaceFsEvent: null,
        workspaceRoot: "/repo",
      },
    });
    return { tabsStore, taskConsole, wrapper };
  }

  it("renders workspace panels and forwards terminal stack events to the tabs store", async () => {
    const { tabsStore, wrapper } = mountShell();

    expect(wrapper.find("[data-source-control]").exists()).toBe(true);
    expect(wrapper.find("[data-terminal-stack]").exists()).toBe(true);
    expect(wrapper.find("[data-file-explorer]").exists()).toBe(true);

    await wrapper.find("[data-focus]").trigger("click");
    await wrapper.find("[data-cwd]").trigger("click");
    await wrapper.find("[data-title]").trigger("click");

    expect(tabsStore.focusPane).toHaveBeenCalledWith(1, 2);
    expect(tabsStore.setLeafCwd).toHaveBeenCalledWith(2, "/tmp");
    expect(tabsStore.setLeafTitle).toHaveBeenCalledWith(2, "shell");
  });

  it("emits panel navigation events and delegates task console actions", async () => {
    const { taskConsole, wrapper } = mountShell();

    await wrapper.find("[data-open-diff]").trigger("click");
    await wrapper.find("[data-open-history]").trigger("click");
    await wrapper.find("[data-open-file]").trigger("click");
    await wrapper.find("[data-open-markdown]").trigger("click");
    await wrapper.find("[data-close-task-console]").trigger("click");
    await wrapper.find("[data-refresh-tasks]").trigger("click");
    await wrapper.find("[data-run-task]").trigger("click");
    await wrapper.find("[data-run-command]").trigger("click");

    expect(wrapper.emitted("open-source-diff")).toHaveLength(1);
    expect(wrapper.emitted("open-source-history")).toHaveLength(1);
    expect(wrapper.emitted("open-file")).toEqual([[ "/repo/src/main.ts", false ]]);
    expect(wrapper.emitted("open-markdown-preview")).toEqual([["/repo/README.md"]]);
    expect(taskConsole.closeTaskConsole).toHaveBeenCalled();
    expect(taskConsole.refreshWorkspaceTasks).toHaveBeenCalled();
    expect(taskConsole.runWorkspaceTask).toHaveBeenCalledWith(task);
    expect(taskConsole.runWorkspaceCommand).toHaveBeenCalledWith("pnpm test");
  });
});
