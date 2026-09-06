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

const layout = {
  leftSidebar: ref({ activity: "sourceControl", open: true, width: 320 }),
  leftSidebarWidthMin: 240,
  leftSidebarWidthMax: 520,
  setLeftSidebarActivity: vi.fn(),
  toggleLeftSidebar: vi.fn(),
  setLeftSidebarWidth: vi.fn(),
  leftPanelOpenRef: ref(false),
  rightPanelOpenRef: ref(false),
  panelVisibility: ref({
    workspace: true,
    sourceControl: true,
    explorer: true,
    taskConsole: false,
  }),
  startLayoutObservers: vi.fn(),
  stopLayoutObservers: vi.fn(),
};

vi.mock("@/app/useWorkbenchLayout", () => ({
  useWorkbenchLayout: () => layout,
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

vi.mock("./LeftSidebar.vue", () => ({
  default: {
    name: "LeftSidebarStub",
    props: ["gitDecorations"],
    emits: ["branch-change", "decoration-change"],
    template: "<div class='leftsidebar-stub' />",
  },
}));
vi.mock("./Workbench.vue", () => ({
  default: {
    name: "WorkbenchStub",
    props: ["gitDecorations", "workspaceRoot"],
    template: "<div class='workbench-stub'><slot name='tab-bar' /></div>",
  },
}));
vi.mock("./TabBar.vue", () => ({
  default: {
    name: "TabBarStub",
    emits: ["request-rename", "select-tab", "close-tab"],
    template: "<div class='tabbar-stub' />",
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

  it("卸载时按序回收：生命周期、任务控制台、tabs、布局观察器", async () => {
    const wrapper = mountHost();
    await nextTick();
    wrapper.unmount();
    // onBeforeUnmount 是异步函数：await 之后的清理在微任务里完成。
    await Promise.resolve();
    await Promise.resolve();
    expect(lifecycle.stopWorkspaceLifecycle).toHaveBeenCalledTimes(1);
    expect(taskConsole.disposeTaskConsole).toHaveBeenCalledTimes(1);
    expect(tabsStore.disposeWorkspaceTabs).toHaveBeenCalledWith("w1");
    expect(layout.stopLayoutObservers).toHaveBeenCalledTimes(1);
  });

  it("LeftSidebar 的 branch-change 转发为带 workspaceId 的顶层事件", async () => {
    const wrapper = mountHost();
    await nextTick();
    const sidebar = wrapper.findComponent({ name: "LeftSidebarStub" });
    await sidebar.vm.$emit("branch-change", "main");
    expect(wrapper.emitted("branch-change")).toEqual([["w1", "main"]]);
    wrapper.unmount();
  });

  it("decoration-change 更新传给 Workbench 的角标", async () => {
    const wrapper = mountHost();
    await nextTick();
    const sidebar = wrapper.findComponent({ name: "LeftSidebarStub" });
    const decorations: GitDecorationMap = new Map([
      ["/repo/a.ts", { status: "modified" } as never],
    ]);
    await sidebar.vm.$emit("decoration-change", decorations);
    await nextTick();
    const workbench = wrapper.findComponent({ name: "WorkbenchStub" });
    const received = workbench.props("gitDecorations") as GitDecorationMap;
    expect(received.size).toBe(1);
    expect(received.get("/repo/a.ts")).toEqual({ status: "modified" });
    wrapper.unmount();
  });

  it("TabBar 的 request-rename 解析出终端 leaf 后向上抛对话框请求", async () => {
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
    const bar = wrapper.findComponent({ name: "TabBarStub" });
    await bar.vm.$emit("request-rename", 7);
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
    const bar = wrapper.findComponent({ name: "TabBarStub" });
    await bar.vm.$emit("request-rename", 8);
    expect(wrapper.emitted("request-rename")).toBeUndefined();
    wrapper.unmount();
  });
});
