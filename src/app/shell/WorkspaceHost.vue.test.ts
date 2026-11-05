// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import { createPinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitDecorationMap } from "@/modules/source-control";
import type { WorkspaceEnv, WorkspaceInstance } from "@/modules/workspace";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import { t } from "@/modules/i18n/translate";

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

vi.mock("@/app/useWorkbenchCommands", () => ({
  useWorkbenchCommands: () => ({ commandApi: { stub: true } }),
}));

vi.mock("@/lib/native", () => ({
  createNativeForEnv: vi.fn(() => ({ __nativeStub: true })),
}));

const notifications = vi.hoisted(() => ({
  notifyInfo: vi.fn(),
  notifyError: vi.fn(),
}));
vi.mock("@/modules/notifications/notificationCenter", () => notifications);

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
  newMarkdownTab: vi.fn(),
  newFilePreviewTab: vi.fn(),
  openFileTab: vi.fn(),
  followPath: vi.fn(),
  dropPath: vi.fn((): { closed: number; keptDirty: number } => ({
    closed: 0,
    keptDirty: 0,
  })),
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

vi.mock("./TopBar.vue", () => ({
  default: {
    name: "TopBarStub",
    props: [
      "workspaceName",
      "workspacePath",
      "env",
      "gitBranch",
      "showWindowControls",
      "canSplit",
      "compact",
      "dense",
      "workspaces",
      "activeWorkspaceId",
      "panelTab",
      "panelVisible",
    ],
    emits: [
      "new-terminal",
      "split-pane",
      "open-command-palette",
      "open-settings",
      "select-workspace",
      "close-workspace",
      "add-workspace",
      "open-workspace-in-new-window",
      "reorder-workspace",
      "update:panel-tab",
      "toggle-panel",
    ],
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
vi.mock("./WorkspacePanel.vue", () => ({
  default: {
    name: "WorkspacePanelStub",
    props: ["tab", "width", "gitDecorations", "workspaceRoot"],
    emits: [
      "resize-width",
      "branch-change",
      "decorations-change",
      "open-file",
      "open-file-preview",
      "open-markdown-preview",
      "open-in-terminal",
      "open-search-result",
      "path-renamed",
      "path-deleted",
    ],
    template: "<aside class='panel-stub' />",
  },
}));
vi.mock("./Canvas.vue", () => ({
  default: {
    name: "CanvasStub",
    props: ["tabs"],
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

  it("卸载时按序回收：生命周期、tabs", async () => {
    const wrapper = mountHost();
    await nextTick();
    wrapper.unmount();
    // onBeforeUnmount 是异步函数：await 之后的清理在微任务里完成。
    await Promise.resolve();
    await Promise.resolve();
    expect(lifecycle.stopWorkspaceLifecycle).toHaveBeenCalledTimes(1);
    expect(tabsStore.disposeWorkspaceTabs).toHaveBeenCalledWith("w1");
  });

  it("侧栏下线后:窄窗口下面板不再被侧栏宽度二次收窄", async () => {
    const original = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 680,
    });
    try {
      const wrapper = mountHost();
      await nextTick();
      const panel = wrapper.findComponent({ name: "WorkspacePanelStub" });
      // 旧口径：可用宽度 = 容器 680 - 侧栏轨道 52 = 628，面板上限 628×45% = 282。
      // 新口径：侧栏已下线，可用宽度就是容器宽 680，上限 680×45% = 306。
      expect(panel.props("width")).toBe(306);
      wrapper.unmount();
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        writable: true,
        value: original,
      });
    }
  });

  it("停靠面板标签写入偏好并回传面板(默认文件树)", async () => {    const pinia = createPinia();
    const prefs = usePreferencesPiniaStore(pinia);
    const wrapper = mount(WorkspaceHost, {
      props: { workspace },
      global: { plugins: [pinia] },
    });
    await nextTick();
    const panel = wrapper.findComponent({ name: "WorkspacePanelStub" });
    expect(panel.props("tab")).toBe("explorer");

    // 标签切换已上移到顶栏：面板自身不再有头部。
    await wrapper
      .findComponent({ name: "TopBarStub" })
      .vm.$emit("update:panel-tab", "changes");
    await nextTick();
    expect(prefs.workspacePanelTab).toBe("changes");
    expect(wrapper.findComponent({ name: "WorkspacePanelStub" }).props("tab")).toBe("changes");
    wrapper.unmount();
  });

  it("面板折叠时切标签会把面板唤出来(动作不能看不见)", async () => {
    const pinia = createPinia();
    const prefs = usePreferencesPiniaStore(pinia);
    prefs.workspacePanelVisible = false;
    const wrapper = mount(WorkspaceHost, {
      props: { workspace },
      global: { plugins: [pinia] },
    });
    await nextTick();
    expect(wrapper.findComponent({ name: "TopBarStub" }).props("panelVisible")).toBe(
      false,
    );

    await wrapper
      .findComponent({ name: "TopBarStub" })
      .vm.$emit("update:panel-tab", "changes");
    await nextTick();
    expect(prefs.workspacePanelVisible).toBe(true);
    expect(wrapper.findComponent({ name: "TopBarStub" }).props("panelVisible")).toBe(
      true,
    );
    wrapper.unmount();
  });

  it("顶栏折叠按钮切换面板显隐并持久化偏好", async () => {
    const pinia = createPinia();
    const prefs = usePreferencesPiniaStore(pinia);
    const wrapper = mount(WorkspaceHost, {
      props: { workspace },
      global: { plugins: [pinia] },
    });
    await nextTick();
    expect(prefs.workspacePanelVisible).toBe(true);

    await wrapper.findComponent({ name: "TopBarStub" }).vm.$emit("toggle-panel");
    await nextTick();
    expect(prefs.workspacePanelVisible).toBe(false);
    expect(wrapper.findComponent({ name: "TopBarStub" }).props("panelVisible")).toBe(
      false,
    );
    wrapper.unmount();
  });

  it("面板的 branch-change 就地驱动面板头部与状态坞,不再上抛顶层", async () => {
    const wrapper = mountHost();
    await nextTick();
    const panel = wrapper.findComponent({ name: "WorkspacePanelStub" });
    await panel.vm.$emit("branch-change", "main");
    await nextTick();
    expect(wrapper.findComponent({ name: "StatusDockStub" }).props("gitBranch")).toBe("main");
    expect(wrapper.emitted("branch-change")).toBeUndefined();
    wrapper.unmount();
  });

  it("decoration-change 更新传给 WorkspacePanel 的角标", async () => {
    const wrapper = mountHost();
    await nextTick();
    const panel = wrapper.findComponent({ name: "WorkspacePanelStub" });
    const decorations: GitDecorationMap = new Map([
      ["/repo/a.ts", { status: "modified" } as never],
    ]);
    await panel.vm.$emit("decorations-change", decorations);
    await nextTick();
    const received = wrapper
      .findComponent({ name: "WorkspacePanelStub" })
      .props("gitDecorations") as GitDecorationMap;
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

  it("顶栏切换器的 close-workspace 上抛为 request-remove-workspace(由 MainApp 二次确认)", async () => {
    const wrapper = mountHost();
    await nextTick();
    const topbar = wrapper.findComponent({ name: "TopBarStub" });
    await topbar.vm.$emit("close-workspace", "w1");
    expect(wrapper.emitted("request-remove-workspace")).toEqual([["w1"]]);
    wrapper.unmount();
  });

  // 回归：这三类事件曾经只声明不转发 —— 重命名后已打开的标签指向失效路径，
  // 保存会把改动写到磁盘上不存在的文件；图片预览从文件树完全打不开。
  it("文件重命名后让已打开的 tab 跟随新路径", async () => {
    const wrapper = mountHost();
    await nextTick();
    await wrapper
      .findComponent({ name: "WorkspacePanelStub" })
      .vm.$emit("path-renamed", "/repo/a.ts", "/repo/lib/a.ts");
    expect(tabsStore.followPath).toHaveBeenCalledWith(
      "/repo/a.ts",
      "/repo/lib/a.ts",
      "w1",
    );
    wrapper.unmount();
  });

  it("文件删除后关掉对应 tab，并提示保留的未保存改动", async () => {
    const wrapper = mountHost();
    await nextTick();
    const panel = wrapper.findComponent({ name: "WorkspacePanelStub" });
    tabsStore.dropPath.mockReturnValueOnce({ closed: 1, keptDirty: 0 });
    await panel.vm.$emit("path-deleted", "/repo/a.ts");
    expect(tabsStore.dropPath).toHaveBeenCalledWith("/repo/a.ts", "w1");

    tabsStore.dropPath.mockReturnValueOnce({ closed: 0, keptDirty: 1 });
    await panel.vm.$emit("path-deleted", "/repo/dirty.ts");
    const calls = notifications.notifyInfo.mock.calls;
    const infoTitle = calls[calls.length - 1]?.[0];
    expect(infoTitle).toBe(t("explorer.deletedWithUnsaved"));
    wrapper.unmount();
  });

  it("图片预览走专用预览 tab，不进编辑器", async () => {
    const wrapper = mountHost();
    await nextTick();
    await wrapper
      .findComponent({ name: "WorkspacePanelStub" })
      .vm.$emit("open-file-preview", "/repo/logo.png");
    expect(tabsStore.newFilePreviewTab).toHaveBeenCalledWith("/repo/logo.png", "w1");
    expect(tabsStore.openFileTab).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
