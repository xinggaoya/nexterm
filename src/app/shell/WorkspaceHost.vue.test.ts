// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import { createPinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitDecorationMap } from "@/modules/source-control";
import type { WorkspaceEnv, WorkspaceInstance } from "@/modules/workspace";

// ── 重依赖 composable / store / 子组件全部桩化 ────────────────────────────

const lifecycle = {
  startWorkspaceLifecycle: vi.fn(),
  stopWorkspaceLifecycle: vi.fn(),
  workspaceFsEvent: ref(null),
  forceFlushNow: vi.fn(),
};

vi.mock("@/app/useWorkspaceLifecycle", () => ({
  useWorkspaceLifecycle: () => lifecycle,
}));

const taskConsole = {
  openTaskConsole: vi.fn(),
  closeTaskConsole: vi.fn(),
  disposeTaskConsole: vi.fn().mockResolvedValue(undefined),
  taskConsoleOpen: ref(false),
  taskConsoleView: ref("tasks" as const),
  taskRunList: ref([]),
  activeTaskRun: ref(null),
  workspaceTasks: ref([]),
  workspaceTasksError: ref(null),
  workspaceTasksLoading: ref(false),
  taskRuns: {
    rerun: vi.fn(),
    runGroups: ref([]),
    setActiveRun: vi.fn(),
    stopRun: vi.fn(),
    stopRunGroup: vi.fn(),
  },
  setTaskConsoleView: vi.fn(),
  refreshWorkspaceTasks: vi.fn(),
  runWorkspaceTask: vi.fn(),
  runWorkspaceCommand: vi.fn(),
  runTaskInTerminal: vi.fn(),
};

vi.mock("@/app/useTaskConsoleController", () => ({
  useTaskConsoleController: () => taskConsole,
}));

vi.mock("@/app/useWorkbenchCommands", () => ({
  useWorkbenchCommands: () => ({ commandApi: { stub: true } }),
}));

vi.mock("@/lib/native", () => ({
  createNativeForEnv: vi.fn(() => ({ __nativeStub: true })),
}));

vi.mock("naive-ui", async (importOriginal) => {
  const mod = await importOriginal<typeof import("naive-ui")>();
  return {
    ...mod,
    useDialog: () => ({
      info: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
      success: vi.fn(),
    }),
  };
});

const tabsStore = {
  // 返回类型放宽为 any[]：模拟数据携带签名之外的模拟字段。
  workspaceTabs: vi.fn((): Array<Record<string, unknown>> => []),
  activeIdByWorkspace: {} as Record<string, number>,
  initWorkspace: vi.fn(),
  disposeWorkspaceTabs: vi.fn(),
  setLeafTitle: vi.fn(),
  updateTab: vi.fn(),
  newPreviewTab: vi.fn(),
};

vi.mock("@/modules/tabs/tabsPinia", () => ({
  useTabsPiniaStore: () => tabsStore,
}));

vi.mock("@/modules/workspace/workspacesPinia", () => ({
  useWorkspacesPiniaStore: () => ({
    workspaces: [],
    activeWorkspaceId: "w1",
    setActive: vi.fn(),
    removeWorkspace: vi.fn(),
  }),
}));

vi.mock("./Rail.vue", () => ({
  default: {
    name: "RailStub",
    props: ["explorerOpen", "sourceControlOpen", "tasksOpen"],
    emits: ["toggle-tool", "close-workspace", "add-workspace", "select-workspace"],
    template: "<nav class='rail-stub' />",
  },
}));
vi.mock("./TopBar.vue", () => ({
  default: {
    name: "TopBarStub",
    template: "<header class='topbar-stub'><slot name='center' /></header>",
  },
}));
vi.mock("./SessionStrip.vue", () => ({
  default: {
    name: "SessionStripStub",
    emits: ["request-rename", "select-tab", "close-tab"],
    template: "<div class='sessionstrip-stub' />",
  },
}));
vi.mock("./Canvas.vue", () => ({
  default: {
    name: "CanvasStub",
    props: ["gitDecorations", "workspaceRoot", "explorerOpen", "sourceControlOpen"],
    emits: ["branch-change", "decorations-change", "update:explorerOpen"],
    template: "<div class='canvas-stub' />",
  },
}));
vi.mock("./StatusDock.vue", () => ({
  default: {
    name: "StatusDockStub",
    props: ["gitBranch", "workspaceName"],
    template: "<footer class='statusdock-stub' />",
  },
}));

import WorkspaceHost from "./WorkspaceHost.vue";

const env: WorkspaceEnv = { kind: "local" };
const workspace = {
  id: "w1",
  rootPath: "/repo",
  env,
  name: "repo",
  openedAt: 1,
} as WorkspaceInstance;

function mountHost() {
  return mount(WorkspaceHost, {
    props: { workspace },
    global: { plugins: [createPinia()] },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("WorkspaceHost.vue", () => {
  it("挂载时启动工作区生命周期并初始化 tabs", async () => {
    const wrapper = mountHost();
    await nextTick();
    expect(wrapper.find("[data-workspace-id='w1']").exists()).toBe(true);
    expect(lifecycle.startWorkspaceLifecycle).toHaveBeenCalledTimes(1);
    expect(tabsStore.initWorkspace).toHaveBeenCalledWith("w1", "/repo");
    wrapper.unmount();
  });

  it("卸载时按序回收：生命周期、任务控制台、tabs", async () => {
    const wrapper = mountHost();
    await nextTick();
    wrapper.unmount();
    // onBeforeUnmount 是异步函数：await 之后的清理在微任务里完成。
    await Promise.resolve();
    await Promise.resolve();
    expect(lifecycle.stopWorkspaceLifecycle).toHaveBeenCalledTimes(1);
    expect(taskConsole.disposeTaskConsole).toHaveBeenCalledTimes(1);
    expect(tabsStore.disposeWorkspaceTabs).toHaveBeenCalledWith("w1");
  });

  it("终端优先:浮层默认全关,打开文件树浮层时互斥关闭源控浮层", async () => {
    const wrapper = mountHost();
    await nextTick();
    const rail = wrapper.findComponent({ name: "RailStub" });
    const canvas = wrapper.findComponent({ name: "CanvasStub" });
    expect(canvas.props("explorerOpen")).toBe(false);
    expect(canvas.props("sourceControlOpen")).toBe(false);

    await rail.vm.$emit("toggle-tool", "explorer");
    await nextTick();
    expect(canvas.props("explorerOpen")).toBe(true);

    // 源控与文件树互斥(左列浮层单选)。
    await rail.vm.$emit("toggle-tool", "sourceControl");
    await nextTick();
    expect(canvas.props("sourceControlOpen")).toBe(true);
    expect(canvas.props("explorerOpen")).toBe(false);

    // 再切一次源控 → 关闭。
    await rail.vm.$emit("toggle-tool", "sourceControl");
    await nextTick();
    expect(canvas.props("sourceControlOpen")).toBe(false);
    wrapper.unmount();
  });

  it("Canvas 的 branch-change 就地驱动状态坞,不再上抛顶层", async () => {
    const wrapper = mountHost();
    await nextTick();
    const canvas = wrapper.findComponent({ name: "CanvasStub" });
    await canvas.vm.$emit("branch-change", "main");
    await nextTick();
    const dock = wrapper.findComponent({ name: "StatusDockStub" });
    expect(dock.props("gitBranch")).toBe("main");
    expect(wrapper.emitted("branch-change")).toBeUndefined();
    wrapper.unmount();
  });

  it("decoration-change 更新传给 Canvas 的角标", async () => {
    const wrapper = mountHost();
    await nextTick();
    const canvas = wrapper.findComponent({ name: "CanvasStub" });
    const decorations: GitDecorationMap = new Map([
      ["/repo/a.ts", { status: "modified" } as never],
    ]);
    await canvas.vm.$emit("decorations-change", decorations);
    await nextTick();
    const received = wrapper.findComponent({ name: "CanvasStub" }).props("gitDecorations") as GitDecorationMap;
    expect(received.size).toBe(1);
    expect(received.get("/repo/a.ts")).toEqual({ status: "modified" });
    wrapper.unmount();
  });

  it("SessionStrip 的 request-rename 解析出终端 leaf 后向上抛对话框请求", async () => {
    tabsStore.workspaceTabs.mockReturnValue([
      {
        id: 7,
        workspaceId: "w1",
        kind: "terminal",
        title: "sh",
        paneTree: 7,
        activeLeafId: 7,
        terminalTitle: "zsh",
      },
    ] as Array<Record<string, unknown>>);
    const wrapper = mountHost();
    await nextTick();
    const strip = wrapper.findComponent({ name: "SessionStripStub" });
    await strip.vm.$emit("request-rename", 7);
    expect(wrapper.emitted("request-rename")).toEqual([
      [{ leafId: 7, currentTitle: "zsh" }],
    ]);
    wrapper.unmount();
  });

  it("非终端 tab 的 request-rename 不向上抛", async () => {
    tabsStore.workspaceTabs.mockReturnValue([
      {
        id: 8,
        workspaceId: "w1",
        kind: "markdown",
        title: "readme",
        path: "/repo/readme.md",
      },
    ] as Array<Record<string, unknown>>);
    const wrapper = mountHost();
    await nextTick();
    const strip = wrapper.findComponent({ name: "SessionStripStub" });
    await strip.vm.$emit("request-rename", 8);
    expect(wrapper.emitted("request-rename")).toBeUndefined();
    wrapper.unmount();
  });

  it("Rail 的 close-workspace 上抛为 request-remove-workspace(由 MainApp 二次确认)", async () => {
    const wrapper = mountHost();
    await nextTick();
    const rail = wrapper.findComponent({ name: "RailStub" });
    await rail.vm.$emit("close-workspace", "w1");
    expect(wrapper.emitted("request-remove-workspace")).toEqual([["w1"]]);
    wrapper.unmount();
  });
});
