// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type { GitDecorationMap } from "@/modules/source-control";
import type { Tab, TerminalTab } from "@/modules/tabs/tabsTypes";

// ── 重依赖子组件全部桩化,画布自身只负责分层与转发 ──────────────────────

vi.mock("@/modules/terminal", () => ({
  TerminalWorkspace: {
    name: "TerminalWorkspaceStub",
    props: ["tab", "isActive"],
    template: "<div class='terminal-workspace-stub' />",
  },
  getPtyIdForLeaf: vi.fn(() => null),
  disposeSession: vi.fn(),
}));

vi.mock("@/modules/preview/PreviewStack.vue", () => ({
  default: {
    name: "PreviewStackStub",
    props: ["tabs", "activeId"],
    template: "<div class='preview-stack-stub' />",
  },
}));
vi.mock("@/modules/markdown/MarkdownStack.vue", () => ({
  default: {
    name: "MarkdownStackStub",
    props: ["tabs", "activeId"],
    template: "<div class='markdown-stack-stub' />",
  },
}));
vi.mock("@/modules/file-preview/FilePreviewStack.vue", () => ({
  default: {
    name: "FilePreviewStackStub",
    props: ["tabs", "activeId"],
    template: "<div class='file-preview-stack-stub' />",
  },
}));
vi.mock("@/modules/editor/GitDiffStack.vue", () => ({
  default: {
    name: "GitDiffStackStub",
    props: ["tabs", "activeId"],
    template: "<div class='git-diff-stack-stub' />",
  },
}));
vi.mock("@/modules/git-history/GitHistoryStack.vue", () => ({
  default: {
    name: "GitHistoryStackStub",
    props: ["tabs", "activeId"],
    emits: ["open-commit-file", "change-ref"],
    template: "<div class='git-history-stack-stub' />",
  },
}));
vi.mock("@/modules/editor/EditorPane.vue", () => ({
  default: {
    name: "EditorPaneStub",
    props: ["path", "fsEvent"],
    emits: ["dirty-change"],
    template: "<div class='editor-pane-stub' />",
  },
}));
vi.mock("@/modules/explorer/FileExplorer.vue", () => ({
  default: {
    name: "FileExplorerStub",
    props: ["rootPath", "fsEvent", "gitDecorations"],
    emits: ["open-file", "open-markdown-preview", "open-in-terminal", "open-search-result"],
    template: "<div class='file-explorer-stub' />",
  },
}));
vi.mock("@/modules/source-control/SourceControlPanel.vue", () => ({
  default: {
    name: "SourceControlPanelStub",
    props: ["rootPath", "workspaceId", "activeRepoRoot"],
    emits: ["open-diff", "open-history", "repo-selected", "decorations-change", "branch-change", "committed"],
    template: "<div class='source-control-stub' />",
  },
}));
vi.mock("@/modules/tasks/TaskConsole.vue", () => ({
  default: {
    name: "TaskConsoleStub",
    props: ["rootPath", "view", "tasks", "runs"],
    emits: ["close", "run-task"],
    template: "<div class='task-console-stub' />",
  },
}));
vi.mock("./OverlayPanel.vue", () => ({
  default: {
    name: "OverlayPanelStub",
    props: ["title", "placement", "width", "showHeader"],
    emits: ["close", "resize-width"],
    template: "<div class='overlay-panel-stub'><slot /></div>",
  },
}));

import Canvas from "./Canvas.vue";

function terminalTab(id: number): TerminalTab {
  return {
    id,
    workspaceId: "w1",
    kind: "terminal",
    title: `sh-${id}`,
    paneTree: { kind: "leaf", id: `leaf-${id}` },
    activeLeafId: id,
    cwd: "/repo",
  } as unknown as TerminalTab;
}

const taskConsole = {
  activeTaskRun: ref(null),
  closeTaskConsole: vi.fn(),
  refreshWorkspaceTasks: vi.fn(),
  runTaskInTerminal: vi.fn(),
  runWorkspaceCommand: vi.fn(),
  runWorkspaceTask: vi.fn(),
  taskConsoleOpen: ref(false),
  taskConsoleView: ref("tasks" as const),
  taskRunList: ref([]),
  taskRuns: {
    rerun: vi.fn(),
    runGroups: ref([]),
    setActiveRun: vi.fn(),
    stopRun: vi.fn(),
    stopRunGroup: vi.fn(),
  },
  setTaskConsoleView: vi.fn(),
  workspaceTasks: ref([]),
  workspaceTasksError: ref(null),
  workspaceTasksLoading: ref(false),
};

function mountCanvas(options: {
  tabs: Tab[];
  activeId: number;
  explorerOpen?: boolean;
  sourceControlOpen?: boolean;
}) {
  const activeTab = options.tabs.find((tab) => tab.id === options.activeId) ?? null;
  return mount(Canvas, {
    props: {
      activeId: options.activeId,
      activeRepoRoot: null,
      activeTab,
      gitDecorations: new Map() as GitDecorationMap,
      showBranchesModal: ref(false),
      tabs: options.tabs,
      tabsStore: {
        focusPane: vi.fn(),
        openCommitFileDiffTab: vi.fn(),
        setLeafCwd: vi.fn(),
        setLeafTitle: vi.fn(),
        updateTab: vi.fn(),
      },
      taskConsole,
      workspaceFsEvent: null,
      workspaceId: "w1",
      workspaceRoot: "/repo",
      workspaceScope: "local",
      explorerOpen: options.explorerOpen ?? false,
      sourceControlOpen: options.sourceControlOpen ?? false,
      explorerWidth: 340,
      sourceControlWidth: 340,
    },
  });
}

describe("Canvas.vue", () => {
  it("每个终端 tab 渲染一个常驻 TerminalWorkspace 实例", () => {
    const wrapper = mountCanvas({
      tabs: [terminalTab(1), terminalTab(2)],
      activeId: 1,
    });
    const terminals = wrapper.findAllComponents({ name: "TerminalWorkspaceStub" });
    expect(terminals).toHaveLength(2);
    expect(terminals[0]?.props("isActive")).toBe(true);
    expect(terminals[1]?.props("isActive")).toBe(false);
  });

  it("文件树浮层开启时渲染,FileExplorer 接收根路径并转发 open-file", async () => {
    const wrapper = mountCanvas({
      tabs: [terminalTab(1)],
      activeId: 1,
      explorerOpen: true,
    });
    const explorer = wrapper.findComponent({ name: "FileExplorerStub" });
    expect(explorer.props("rootPath")).toBe("/repo");

    await explorer.vm.$emit("open-file", "/repo/a.ts", false);
    expect(wrapper.emitted("open-file")).toEqual([["/repo/a.ts", false]]);
  });

  it("浮层用 v-show 保活:关闭后组件仍挂载但整层不可见", () => {
    const wrapper = mountCanvas({
      tabs: [terminalTab(1)],
      activeId: 1,
      explorerOpen: false,
    });
    // 浮层保持挂载以保留模块状态(与旧右面板行为一致)。
    expect(wrapper.findComponent({ name: "FileExplorerStub" }).exists()).toBe(true);
    // OverlayPanel 根节点被 v-show 隐藏。
    const overlayRoot = wrapper.findComponent({ name: "OverlayPanelStub" }).element;
    expect((overlayRoot as HTMLElement).style.display).toBe("none");
  });

  it("源控面板的 branch-change / decorations-change 逐层上抛", async () => {
    const wrapper = mountCanvas({
      tabs: [terminalTab(1)],
      activeId: 1,
      sourceControlOpen: true,
    });
    const panel = wrapper.findComponent({ name: "SourceControlPanelStub" });
    expect(panel.props("workspaceId")).toBe("w1");

    await panel.vm.$emit("branch-change", "main");
    expect(wrapper.emitted("branch-change")).toEqual([["main"]]);

    const decorations = new Map() as GitDecorationMap;
    await panel.vm.$emit("decorations-change", decorations);
    expect(wrapper.emitted("decorations-change")).toEqual([[decorations]]);
  });

  it("关闭浮层的 update 事件逐层上抛", async () => {
    const wrapper = mountCanvas({
      tabs: [terminalTab(1)],
      activeId: 1,
      explorerOpen: true,
    });
    const overlay = wrapper.findComponent({ name: "OverlayPanelStub" });
    await overlay.vm.$emit("close");
    expect(wrapper.emitted("update:explorerOpen")).toEqual([[false]]);
  });
});
