// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import { computed, nextTick, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { GitDecorationMap } from "@/modules/source-control";
import type { Tab } from "@/modules/tabs/tabsTypes";

vi.mock("@/lib/native", () => ({ native: {} }));

vi.mock("@/modules/terminal", () => ({
  TerminalWorkspace: {
    props: ["tab", "isActive"],
    template: "<div class='terminal-stub' :data-tab='tab.id' />",
  },
  getPtyIdForLeaf: vi.fn(() => null),
  disposeSession: vi.fn(),
}));

vi.mock("@/modules/explorer/FileExplorer.vue", () => ({
  default: {
    name: "FileExplorerStub",
    props: ["rootPath", "fsEvent", "gitDecorations"],
    emits: [
      "open-file",
      "open-markdown-preview",
      "open-in-terminal",
      "open-search-result",
    ],
    template: "<div class='explorer-stub' />",
  },
}));

// 注意：不能只按 AsyncComponentWrapper 名字桩化（test-utils 不匹配异步组件），
// 这里 mock 模块并显式提供 Vue 运行时会探测的特殊导出，否则 vitest 报未知导出。
vi.mock("@/modules/editor/EditorPane.vue", () => {
  const stub = {
    name: "EditorPaneStub",
    props: ["path", "fsEvent"],
    template: "<div class='editor-stub' />",
  };
  // Vue 组件标准选项键 + 运行时探测的内部标记；全部显式补进模块命名空间，
  // 否则 vitest 对 mock 模块的未知导出访问会抛错中断渲染。
  const optionKeys = [
    "name",
    "props",
    "emits",
    "inheritAttrs",
    "mixins",
    "extends",
    "methods",
    "data",
    "computed",
    "watch",
    "provide",
    "inject",
    "components",
    "directives",
    "slots",
    "expose",
    "render",
    "ssrRender",
    "beforeCreate",
    "created",
    "beforeMount",
    "mounted",
    "beforeUpdate",
    "updated",
    "beforeUnmount",
    "unmounted",
    "errorCaptured",
    "activated",
    "deactivated",
    "renderTracked",
    "renderTriggered",
    "serverPrefetch",
  ];
  const target: Record<string | symbol, unknown> = {
    __isTeleport: false,
    __isKeepAlive: false,
    __Suspense: false,
    __isSuspense: false,
    __v_isVNode: undefined,
    __v_raw: undefined,
    __v_skip: undefined,
    __v_isRef: undefined,
    __v_isReadonly: undefined,
    __name: "EditorPaneStub",
    __file: "EditorPane.vue",
    __scopeId: undefined,
    __cssModules: undefined,
    __hasSFCStyle: undefined,
    __functional: undefined,
    __hmrId: "editor-pane-stub-hmr",
    compilerOptions: undefined,
    __asyncLoader: undefined,
    __asyncResolved: undefined,
    setup: undefined,
    render: undefined,
    ssrRender: undefined,
    template: undefined,
    default: stub,
  };
  for (const key of optionKeys) {
    if (!(key in target)) target[key] = undefined;
  }
  // Vue 运行时与 test-utils 会探测大量特殊导出（__v_isVNode/extends/...），
  // get 恒兜底 undefined，避免 vitest 的未知导出报错中断组件更新。
  return new Proxy(target, {
    get(target_, key) {
      if (key in target_) return target_[key];
      // 未列出的选项键返回空函数：applyOptions 会对钩子做 .bind。
      return () => undefined;
    },
    ownKeys(target_) {
      // 把运行时可能探测的键并入 ownKeys 快照，避免命名空间缺键报错。
      return [
        ...new Set([
          ...Reflect.ownKeys(target_),
          "name",
          "props",
          "emits",
          "extends",
          "mixins",
          "__v_isVNode",
          "__v_raw",
          "__v_skip",
        ]),
      ];
    },
  });
});

vi.mock("@/modules/git-history/GitHistoryStack.vue", () => ({
  default: { template: "<div class='history-stub' />" },
}));
vi.mock("@/modules/markdown/MarkdownStack.vue", () => ({
  default: { template: "<div class='markdown-stub' />" },
}));
vi.mock("@/modules/preview/PreviewStack.vue", () => ({
  default: { template: "<div class='preview-stub' />" },
}));
vi.mock("@/modules/file-preview/FilePreviewStack.vue", () => ({
  default: { template: "<div class='file-preview-stub' />" },
}));
vi.mock("@/modules/editor/GitDiffStack.vue", () => ({
  default: { template: "<div class='gitdiff-stub' />" },
}));
vi.mock("@/modules/tasks/TaskConsole.vue", () => ({
  default: { template: "<div class='taskconsole-stub' />" },
}));

import Workbench from "./Workbench.vue";

function buildLayout(rightOpen: boolean) {
  return {
    explorerPaneClass: computed(() => ""),
    explorerPanelWidth: ref(320),
    explorerSplitMax: computed(() => "100%"),
    explorerSplitMin: computed(() => "240px"),
    explorerSplitSize: computed(() => "320px"),
    flushExplorerWidthSave: vi.fn(),
    panelResizeTriggerSize: 4,
    rightPanelOpen: ref(rightOpen),
    rightSplitHost: ref<HTMLElement | null>(null),
    setExplorerPanelWidth: vi.fn(),
    updateExplorerSplitSize: vi.fn(),
  };
}

function buildTaskConsole(open: boolean) {
  return {
    activeTaskRun: ref(null),
    closeTaskConsole: vi.fn(),
    refreshWorkspaceTasks: vi.fn(),
    runTaskInTerminal: vi.fn(),
    runWorkspaceCommand: vi.fn(),
    runWorkspaceTask: vi.fn(),
    taskConsoleOpen: ref(open),
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
}

function baseProps(overrides: Record<string, unknown> = {}) {
  const decorations: GitDecorationMap = new Map();
  return {
    activeId: 1,
    activeRepoRoot: "/repo",
    activeTab: null,
    gitDecorations: decorations,
    layout: buildLayout(true),
    showBranchesModal: ref(false),
    tabs: [] as Tab[],
    tabsStore: {
      focusPane: vi.fn(),
      openCommitFileDiffTab: vi.fn(),
      setLeafCwd: vi.fn(),
      setLeafTitle: vi.fn(),
      updateTab: vi.fn(),
    },
    taskConsole: buildTaskConsole(false),
    workspaceFsEvent: null,
    workspaceRoot: "/repo",
    workspaceScope: "local",
    ...overrides,
  };
}

async function mountWorkbench(overrides: Record<string, unknown> = {}) {
  const wrapper = mount(Workbench, {
    props: baseProps(overrides),
    slots: { "tab-bar": "<div class='tabbar-stub' />" },
  });
  // defineAsyncComponent 的 loader 解析需要多轮微任务。
  await flushPromises();
  await nextTick();
  await flushPromises();
  await nextTick();
  return wrapper;
}

describe("Workbench.vue", () => {
  it("渲染 tab-bar 插槽与文件树面板，并透传 git 角标", async () => {
    const wrapper = await mountWorkbench();
    expect(wrapper.find(".tabbar-stub").exists()).toBe(true);
    expect(wrapper.find(".explorer-stub").exists()).toBe(true);
    const explorer = wrapper.findComponent({ name: "FileExplorerStub" });
    const props = explorer.props() as Record<string, unknown>;
    expect(props.gitDecorations).toBe(
      wrapper.props("gitDecorations") as GitDecorationMap,
    );
    expect(props.rootPath).toBe("/repo");
  });

  it("rightPanelOpen 关闭时文件树 v-show 隐藏", async () => {
    const layout = buildLayout(true);
    const wrapper = await mountWorkbench({ layout });
    const el = () => wrapper.find(".explorer-stub").element as HTMLElement;
    expect(el().style.display).toBe("");

    layout.rightPanelOpen.value = false;
    await nextTick();
    // v-show 的契约是内联 display:none（isVisible 在 jsdom 下不可靠）。
    expect(el().style.display).toBe("none");
  });

  it("活动终端 tab 渲染 TerminalWorkspace，非活动隐藏", async () => {
    const terminalTab = {
      id: 1,
      workspaceId: "w1",
      kind: "terminal" as const,
      title: "sh",
      paneTree: 1,
      activeLeafId: 1,
    };
    const wrapper = await mountWorkbench({
      tabs: [terminalTab],
      activeTab: terminalTab,
    });
    const stub = wrapper.find(".terminal-stub");
    expect(stub.exists()).toBe(true);
    expect(stub.attributes("data-tab")).toBe("1");

    // 活动切换到非终端 tab 后终端隐藏（保持挂载，外层容器 class 级隐藏）
    await wrapper.setProps({ activeTab: null });
    const container = wrapper
      .find(".terminal-stub")
      .element.parentElement!.parentElement as HTMLElement;
    expect(container.className).toContain("invisible");
  });

  it("活动编辑器 tab 渲染编辑器面板", async () => {
    const editorTab = {
      id: 2,
      workspaceId: "w1",
      kind: "editor" as const,
      title: "a.ts",
      path: "/repo/a.ts",
    };
    const wrapper = await mountWorkbench({
      tabs: [editorTab],
      activeTab: editorTab,
    });
    // 编辑器容器由 v-if 门控（非活动时连容器都不渲染）；
    // EditorPane 本体是异步组件，这里只断言容器级切换。
    const container = wrapper.find("div.absolute.inset-0.flex");
    expect(container.exists()).toBe(true);
    expect(container.classes()).not.toContain("invisible");

    await wrapper.setProps({ activeTab: null });
    expect(wrapper.find("div.absolute.inset-0.flex").exists()).toBe(false);
  });

  it("TaskConsole 仅在 taskConsoleOpen 时渲染", async () => {
    const closed = await mountWorkbench();
    expect(closed.find(".taskconsole-stub").exists()).toBe(false);

    const open = await mountWorkbench({
      taskConsole: buildTaskConsole(true),
    });
    expect(open.find(".taskconsole-stub").exists()).toBe(true);
  });

  it("FileExplorer 的 open-file 冒泡为顶层 open-file 事件", async () => {
    const wrapper = await mountWorkbench();
    const explorer = wrapper.findComponent({ name: "FileExplorerStub" });
    await explorer.vm.$emit("open-file", "/repo/a.ts", true);
    expect(wrapper.emitted("open-file")).toEqual([["/repo/a.ts", true]]);
  });

  it("revealEditorLine：活动 tab 不是编辑器时返回 false", async () => {
    const wrapper = await mountWorkbench();
    const vm = wrapper.vm as unknown as {
      revealEditorLine: (path: string, line: number) => boolean;
    };
    expect(vm.revealEditorLine("/repo/a.ts", 3)).toBe(false);
  });
});
