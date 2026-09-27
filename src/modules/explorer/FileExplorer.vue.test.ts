// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { nextTick, type VNode } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FileExplorer from "./FileExplorer.vue";
import {
  createFileTreeEntry,
  deleteFileTreePath,
  readFileTreeDir,
  renameFileTreePath,
  searchFileTree,
  type DirEntry,
} from "./lib/fileTreeService";

// 多工作区重构后，FileExplorer 通过 useWorkspaceContext() 获取 wsNative。
// 测试不挂载 WorkspaceHost，因此直接 mock 该 composable 返回固定值，
// 让组件拿到一个占位的 wsNative（文件树服务函数本身已被单独 mock，不会真正调用 wsNative 的方法）。
const mockWsNative = {
  fsMoveMany: vi.fn(),
  fsCopyMany: vi.fn(),
  fsCancelTransfer: vi.fn(),
};
vi.mock("@/app/workspaceContext", () => ({
  useWorkspaceContext: () => ({
    workspace: {
      id: "local:/repo",
      rootPath: "/repo",
      env: { kind: "local" },
      name: "repo",
      openedAt: 0,
    },
    wsNative: mockWsNative,
  }),
}));

vi.mock("./lib/fileTreeService", async () => {
  const actual =
    await vi.importActual<typeof import("./lib/fileTreeService")>(
      "./lib/fileTreeService",
    );
  return {
    ...actual,
    readFileTreeDir: vi.fn(),
    createFileTreeEntry: vi.fn(),
    deleteFileTreePath: vi.fn(),
    renameFileTreePath: vi.fn(),
    searchFileTree: vi.fn(),
  };
});

// 搬运进度事件通道。
const progressHandlers: Array<(event: unknown) => void> = [];
vi.mock("@tauri-apps/api/event", async () => {
  const actual = await vi.importActual<typeof import("@tauri-apps/api/event")>("@tauri-apps/api/event");
  return {
    ...actual,
    listen: async (_event: string, handler: (e: unknown) => void) => {
      progressHandlers.push(handler);
      return () => {
        const index = progressHandlers.indexOf(handler);
        if (index >= 0) progressHandlers.splice(index, 1);
      };
    },
  };
});

function fireProgress(payload: Record<string, unknown>): void {
  for (const handler of [...progressHandlers]) handler({ payload });
}

// OS 拖入走 webview 事件通道（getCurrentWebview().onDragDropEvent）。
// 组件在 mount 时订阅，这里用可手动触发的 handler 替身。
const osDragHandlers: Array<(event: OsDragPayload) => void> = [];
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (handler: (event: OsDragPayload) => void) => {
      osDragHandlers.push(handler);
      return () => {
        const index = osDragHandlers.indexOf(handler);
        if (index >= 0) osDragHandlers.splice(index, 1);
      };
    },
  }),
}));
vi.mock("@/lib/tauriRuntime", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tauriRuntime")>("@/lib/tauriRuntime");
  return { ...actual, hasTauriInternals: () => true };
});

type OsDragPayload =
  | { type: "enter"; paths: string[]; position: { x: number; y: number } }
  | { type: "over"; position: { x: number; y: number } }
  | { type: "drop"; paths: string[]; position: { x: number; y: number } }
  | { type: "leave" };

function fireOsDrag(event: OsDragPayload): void {
  for (const handler of [...osDragHandlers]) handler({ payload: event } as never);
}

vi.mock("./lib/iconResolver", () => ({
  fileIconUrl: (name: string) => `file-icon:${name}`,
  folderIconUrl: (name: string, expanded: boolean) =>
    `folder-icon:${name}:${expanded ? "open" : "closed"}`,
}));

vi.mock("./lib/contextActions", () => ({
  copyToClipboard: vi.fn(),
  relativePath: (rootPath: string, path: string) =>
    path.startsWith(`${rootPath}/`) ? path.slice(rootPath.length + 1) : path,
  revealInFinder: vi.fn(),
}));

// jsdom 下 NDropdown 的 popper 面板不会渲染（floating-ui 缺真实布局），
// 因此把 NDropdown mock 成简单渲染 trigger slot + 把 options 摊成可见的
// div（带 data-menu-action）。同时模拟 NDropdown 的 clickoutside 行为：
// 在 window 上监听 pointerdown，触发 emit('clickoutside')，让外部点击
// 关闭菜单的旧测试继续通过。
const naiveDropdownMock = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const vue = require("vue") as typeof import("vue");
  const { defineComponent, h, onBeforeUnmount, onMounted } = vue;
  return {
    NDropdown: defineComponent({
      props: ["options", "show"],
      emits: ["select", "clickoutside"],
      setup(
        _props: {
          options?: Array<{
            key: string | number;
            label?: unknown;
            type?: string;
            disabled?: boolean;
          }>;
          show?: boolean;
        },
        {
          emit,
          slots,
        }: {
          emit: (event: "select" | "clickoutside", ...args: unknown[]) => void;
          slots: { default?: () => unknown };
        },
      ) {
        let containerRef: HTMLElement | null = null;
        function onWindowPointerDown(event: Event) {
          // 真实 NDropdown 不会对来自自身内部的 pointerdown 触发 clickoutside。
          const target = event.target;
          if (target instanceof Node && containerRef?.contains(target)) return;
          emit("clickoutside");
        }
        onMounted(() => {
          window.addEventListener("pointerdown", onWindowPointerDown);
        });
        onBeforeUnmount(() => {
          window.removeEventListener("pointerdown", onWindowPointerDown);
        });
        return () => {
          const optionNodes = (_props.options ?? [])
            .filter((opt) => opt.type !== "divider")
            .map((opt) =>
              h(
                "div",
                {
                  class: "n-dropdown-option",
                  "data-menu-action": String(opt.key),
                  onClick: () => emit("select", opt.key),
                },
                { default: () => opt.label },
              ),
            );
          return h(
            "div",
            {
              "data-dropdown-mock": "",
              ref: ((el: Element | null) => {
                containerRef = el instanceof HTMLElement ? el : null;
              }) as unknown as string,
            },
            [
              (slots.default?.() ?? []) as VNode[][],
              _props.show !== false
                ? h("div", { class: "n-dropdown-options" }, optionNodes)
                : null,
            ],
          );
        };
      },
    }),
  };
});

vi.mock("naive-ui", async () => {
  const actual = await vi.importActual<typeof import("naive-ui")>("naive-ui");
  return {
    ...actual,
    NDropdown: naiveDropdownMock.NDropdown,
  };
});

import { buildGitDecorationMap } from "@/modules/source-control/gitDecorations";

async function flush() {
  await Promise.resolve();
  await nextTick();
}

/**
 * 直接在元素上派发 KeyboardEvent：vue-test-utils 的 trigger 会尝试给事件
 * 写 isTrusted（只读属性），传构造器实例会抛错。放在模块级供多个 describe
 * 复用。
 */
function pressKey(
  wrapper: ReturnType<typeof mount>,
  key: string,
  init: { ctrlKey?: boolean } = {},
): void {
  wrapper.find("[data-file-explorer]").element.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      ctrlKey: init.ctrlKey ?? true,
      bubbles: true,
      cancelable: true,
    }),
  );
}

/** 冲突对话框挂在 body 上（teleport），因此按 DOM 查询而不是 wrapper 作用域。 */
function clickInBody(selector: string): void {
  const el = document.body.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`dialog element not found: ${selector}`);
  el.click();
}


// 服务函数现在以 wsNative 为首参；断言时忽略该参数，只校验 path/showHidden。

// NModal 走 teleport 挂到 body 且退出时保留 DOM，所以每个用例后必须清场，
// 否则上一个用例的残留对话框会被下一个用例查到。
const transferWrappers: Array<ReturnType<typeof mount>> = [];

afterEach(() => {
  while (transferWrappers.length) transferWrappers.pop()?.unmount();
  document.body.innerHTML = "";
});

/** 挂载一个根为 /repo 的文件树，并登记到清场列表。 */
function mountExplorer() {
  const wrapper = mount(FileExplorer, {
    global: { plugins: [createPinia()] },
    props: { rootPath: "/repo" },
  });
  transferWrappers.push(wrapper);
  return wrapper;
}

const WS_NATIVE_MATCHER = expect.anything();

const EMPTY_TRANSFER_RESULT = {
  completed: [],
  skipped: [],
  failed: [],
  crossDevice: [],
  warnings: [],
};

/** 两个 describe 共用的默认夹具：清 mock + 默认目录内容 + 搬运结果形状。 */
function resetExplorerMocks(): void {
  vi.clearAllMocks();
  vi.mocked(readFileTreeDir).mockImplementation(async (_ws, path) => {
    if (path === "/repo") {
      return [
        { name: "src", kind: "dir", size: 0, mtime: 1 },
        { name: "README.md", kind: "file", size: 10, mtime: 2 },
        { name: "package.json", kind: "file", size: 20, mtime: 4 },
      ];
    }
    if (path === "/repo/src") {
      return [{ name: "main.ts", kind: "file", size: 100, mtime: 3 }];
    }
    return [];
  });
  vi.mocked(createFileTreeEntry).mockResolvedValue(undefined);
  vi.mocked(renameFileTreePath).mockResolvedValue(undefined);
  vi.mocked(deleteFileTreePath).mockResolvedValue(undefined);
  vi.mocked(searchFileTree).mockResolvedValue({
    hits: [
      {
        path: "/repo/src/main.ts",
        rel: "src/main.ts",
        name: "main.ts",
        is_dir: false,
      },
    ],
    truncated: false,
  });
  mockWsNative.fsMoveMany.mockResolvedValue(EMPTY_TRANSFER_RESULT);
  mockWsNative.fsCopyMany.mockResolvedValue(EMPTY_TRANSFER_RESULT);
}

describe("FileExplorer.vue", () => {
  beforeEach(() => {
    resetExplorerMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads the root directory with resolved file and folder icons", async () => {
    const wrapper = mount(FileExplorer, {
      global: { plugins: [createPinia()] },
      props: { rootPath: "/repo" },
    });
    await flush();

    expect(readFileTreeDir).toHaveBeenCalledWith(WS_NATIVE_MATCHER, "/repo", false);
    expect(wrapper.text()).toContain("repo");
    expect(wrapper.text()).toContain("src");
    expect(wrapper.text()).toContain("README.md");
    expect(
      wrapper.find("[data-explorer-root-icon]").attributes("src"),
    ).toBe("folder-icon:repo:closed");
    expect(
      wrapper
        .find("[data-explorer-row-path='/repo/src'] [data-explorer-entry-icon]")
        .attributes("src"),
    ).toBe("folder-icon:src:closed");
    expect(
      wrapper
        .find(
          "[data-explorer-row-path='/repo/README.md'] [data-explorer-entry-icon]",
        )
        .attributes("src"),
    ).toBe("file-icon:README.md");

    await wrapper.find("[data-explorer-row-path='/repo/README.md']").trigger("click");

    expect(wrapper.emitted("openFile")).toEqual([["/repo/README.md", false]]);
  });

  it("renders git tones for changed files and parent folders", async () => {
    // 多工作区重构后，FileExplorer 不再接收 gitChangedFiles 数组，
    // 而是接收预先构建好的 gitDecorations Map（由父级用 buildGitDecorationMap 生成）。
    const gitDecorations = buildGitDecorationMap("/repo", [
      {
        path: "src/main.ts",
        originalPath: null,
        indexStatus: " ",
        worktreeStatus: "M",
        staged: false,
        unstaged: true,
        untracked: false,
        statusLabel: "Modified",
      },
    ]);
    const wrapper = mount(FileExplorer, {
      global: { plugins: [createPinia()] },
      props: {
        rootPath: "/repo",
        gitDecorations,
      },
    });
    await flush();

    // 父目录 src 也会有后代变更标记（hasDescendantChanges）。
    expect(
      wrapper
        .find("[data-explorer-row-path='/repo/src'] [data-explorer-git-decoration]")
        .exists(),
    ).toBe(true);

    await wrapper.find("[data-explorer-row-path='/repo/src']").trigger("click");
    await flush();

    expect(
      wrapper
        .find(
          "[data-explorer-row-path='/repo/src/main.ts'] [data-explorer-git-decoration]",
        )
        .exists(),
    ).toBe(true);
  });

  it("expands folders and renders loaded children", async () => {
    const wrapper = mount(FileExplorer, {
      global: { plugins: [createPinia()] },
      props: { rootPath: "/repo" },
    });
    await flush();

    await wrapper.find("[data-explorer-row-path='/repo/src']").trigger("click");
    await flush();

    expect(readFileTreeDir).toHaveBeenCalledWith(
      WS_NATIVE_MATCHER,
      "/repo/src",
      false,
    );
    expect(wrapper.text()).toContain("main.ts");
    expect(
      wrapper
        .find("[data-explorer-row-path='/repo/src'] [data-explorer-entry-icon]")
        .attributes("src"),
    ).toBe("folder-icon:src:open");
  });

  it("renders an empty state without a root path", () => {
    const wrapper = mount(FileExplorer, {
      global: { plugins: [createPinia()] },
      props: { rootPath: null },
    });

    expect(wrapper.text()).toContain("No current directory");
  });

  it("creates files from the header inline input and refreshes the root", async () => {
    const wrapper = mount(FileExplorer, {
      global: { plugins: [createPinia()] },
      props: { rootPath: "/repo" },
    });
    await flush();

    await wrapper.find("[data-new-file]").trigger("click");
    await flush();
    await wrapper.find("[data-inline-tree-input]").setValue("notes.md");
    await wrapper.find("[data-inline-tree-input]").trigger("keydown", { key: "Enter" });
    await flush();

    expect(createFileTreeEntry).toHaveBeenCalledWith(
      WS_NATIVE_MATCHER,
      "/repo/notes.md",
      "file",
    );
    expect(readFileTreeDir).toHaveBeenLastCalledWith(
      WS_NATIVE_MATCHER,
      "/repo",
      false,
    );
  });

  it("renames files inline from a row double click", async () => {
    const wrapper = mount(FileExplorer, {
      global: { plugins: [createPinia()] },
      props: { rootPath: "/repo" },
    });
    await flush();

    await wrapper
      .find("[data-explorer-row-path='/repo/README.md']")
      .trigger("dblclick");
    await flush();
    await wrapper.find("[data-inline-tree-input]").setValue("README.old.md");
    await wrapper.find("[data-inline-tree-input]").trigger("keydown", { key: "Enter" });
    await flush();

    expect(renameFileTreePath).toHaveBeenCalledWith(
      WS_NATIVE_MATCHER,
      "/repo/README.md",
      "/repo/README.old.md",
    );
    expect(wrapper.emitted("pathRenamed")).toEqual([
      ["/repo/README.md", "/repo/README.old.md"],
    ]);
  });

  it("deletes files through the context menu after confirmation", async () => {
    const wrapper = mount(FileExplorer, {
      global: { plugins: [createPinia()] },
      props: { rootPath: "/repo" },
    });
    await flush();

    await wrapper
      .find("[data-explorer-row-path='/repo/README.md']")
      .trigger("contextmenu", { clientX: 10, clientY: 20 });
    await flush();

    await wrapper.find("[data-menu-action='delete']").trigger("click");
    await flush();
    expect(deleteFileTreePath).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Click again to confirm");

    await wrapper.find("[data-menu-action='delete']").trigger("click");
    await flush();

    expect(deleteFileTreePath).toHaveBeenCalledWith(
      WS_NATIVE_MATCHER,
      "/repo/README.md",
    );
    expect(wrapper.emitted("pathDeleted")).toEqual([["/repo/README.md"]]);
  });

  it("toggles multi-selection with ctrl-click and deletes the whole selection from the context menu", async () => {
    const wrapper = mount(FileExplorer, {
      global: { plugins: [createPinia()] },
      props: { rootPath: "/repo" },
    });
    await flush();

    const readme = () => wrapper.find("[data-explorer-row-path='/repo/README.md']");
    const pkg = () => wrapper.find("[data-explorer-row-path='/repo/package.json']");

    // Ctrl+点击只改变选择集，不打开文件。
    await readme().trigger("click", { ctrlKey: true });
    await pkg().trigger("click", { ctrlKey: true });
    await flush();
    expect(wrapper.emitted("openFile")).toBeUndefined();
    expect(readme().classes()).toContain("bg-accent");
    expect(pkg().classes()).toContain("bg-accent");

    // 右键已选中的行保留整批选择，菜单显示批量删除。
    await pkg().trigger("contextmenu", { clientX: 10, clientY: 20 });
    await flush();
    expect(wrapper.text()).toContain("Delete 2 items");
    expect(wrapper.find("[data-menu-action='rename']").exists()).toBe(false);

    await wrapper.find("[data-menu-action='delete']").trigger("click");
    await flush();
    expect(deleteFileTreePath).not.toHaveBeenCalled();
    await wrapper.find("[data-menu-action='delete']").trigger("click");
    await flush();

    expect(deleteFileTreePath).toHaveBeenCalledTimes(2);
    expect(deleteFileTreePath).toHaveBeenCalledWith(WS_NATIVE_MATCHER, "/repo/README.md");
    expect(deleteFileTreePath).toHaveBeenCalledWith(WS_NATIVE_MATCHER, "/repo/package.json");
    const deleted = (wrapper.emitted("pathDeleted") ?? []).map((args) => args[0]);
    expect(deleted.sort()).toEqual(["/repo/README.md", "/repo/package.json"]);
    // 两个文件同属根目录，只需刷新根目录一次。
    expect(readFileTreeDir).toHaveBeenLastCalledWith(WS_NATIVE_MATCHER, "/repo", false);
  });

  it("right-clicking an unselected row collapses the selection to that row", async () => {
    const wrapper = mount(FileExplorer, {
      global: { plugins: [createPinia()] },
      props: { rootPath: "/repo" },
    });
    await flush();

    await wrapper
      .find("[data-explorer-row-path='/repo/README.md']")
      .trigger("click", { ctrlKey: true });
    await wrapper
      .find("[data-explorer-row-path='/repo/package.json']")
      .trigger("click", { ctrlKey: true });
    await wrapper
      .find("[data-explorer-row-path='/repo/src']")
      .trigger("contextmenu", { clientX: 10, clientY: 20 });
    await flush();

    // 单选菜单：仍能看到重命名，且删除的是被右键的那一行。
    expect(wrapper.find("[data-menu-action='rename']").exists()).toBe(true);
    await wrapper.find("[data-menu-action='delete']").trigger("click");
    await wrapper.find("[data-menu-action='delete']").trigger("click");
    await flush();
    expect(deleteFileTreePath).toHaveBeenCalledTimes(1);
    expect(deleteFileTreePath).toHaveBeenCalledWith(WS_NATIVE_MATCHER, "/repo/src");
  });

  it("shift-click selects the visible range between the anchor and the clicked row", async () => {
    const wrapper = mount(FileExplorer, {
      global: { plugins: [createPinia()] },
      props: { rootPath: "/repo" },
    });
    await flush();

    // 先普通点击 src（锚点），再 Shift+点击 package.json → 三行全部选中。
    await wrapper.find("[data-explorer-row-path='/repo/src']").trigger("click");
    await flush();
    await wrapper
      .find("[data-explorer-row-path='/repo/package.json']")
      .trigger("click", { shiftKey: true });
    await flush();

    for (const path of ["/repo/src", "/repo/README.md", "/repo/package.json"]) {
      expect(
        wrapper.find(`[data-explorer-row-path='${path}']`).classes(),
      ).toContain("bg-accent");
    }
    // Shift 点击不打开文件。
    expect(wrapper.emitted("openFile")).toBeUndefined();
  });

  it("commits the inline rename when the input loses focus", async () => {
    const wrapper = mount(FileExplorer, {
      global: { plugins: [createPinia()] },
      props: { rootPath: "/repo" },
    });
    await flush();

    await wrapper
      .find("[data-explorer-row-path='/repo/README.md']")
      .trigger("dblclick");
    await flush();
    await wrapper.find("[data-inline-tree-input]").setValue("README.old.md");
    await wrapper.find("[data-inline-tree-input]").trigger("blur");
    await flush();

    expect(renameFileTreePath).toHaveBeenCalledWith(
      WS_NATIVE_MATCHER,
      "/repo/README.md",
      "/repo/README.old.md",
    );
    // 输入框在失焦提交后消失，不需要用户回到输入框回车。
    expect(wrapper.find("[data-inline-tree-input]").exists()).toBe(false);
  });

  it("renames files through the context menu", async () => {
    const wrapper = mount(FileExplorer, {
      global: { plugins: [createPinia()] },
      props: { rootPath: "/repo" },
    });
    await flush();

    await wrapper
      .find("[data-explorer-row-path='/repo/README.md']")
      .trigger("contextmenu", { clientX: 10, clientY: 20 });
    await flush();

    await wrapper.find("[data-menu-action='rename']").trigger("click");
    await flush();

    expect(renameFileTreePath).not.toHaveBeenCalled();
    expect(wrapper.find("[data-inline-tree-input]").exists()).toBe(true);

    await wrapper.find("[data-inline-tree-input]").setValue("README.old.md");
    await wrapper.find("[data-inline-tree-input]").trigger("keydown", { key: "Enter" });
    await flush();

    expect(renameFileTreePath).toHaveBeenCalledWith(
      WS_NATIVE_MATCHER,
      "/repo/README.md",
      "/repo/README.old.md",
    );
    expect(wrapper.emitted("pathRenamed")).toEqual([
      ["/repo/README.md", "/repo/README.old.md"],
    ]);
  });

  it("hides the rename action on the root context menu", async () => {
    const wrapper = mount(FileExplorer, {
      global: { plugins: [createPinia()] },
      props: { rootPath: "/repo" },
    });
    await flush();

    const tree = wrapper.find(".min-h-0.flex-1");
    await tree.trigger("contextmenu", { clientX: 10, clientY: 20 });
    await flush();

    expect(wrapper.find("[data-menu-action='rename']").exists()).toBe(false);
  });

  it("shows the open-in-terminal action only for directories", async () => {
    const wrapper = mount(FileExplorer, {
      global: { plugins: [createPinia()] },
      props: { rootPath: "/repo" },
    });
    await flush();

    // Directory row -> "Open Terminal" visible
    await wrapper
      .find("[data-explorer-row-path='/repo/src']")
      .trigger("contextmenu", { clientX: 10, clientY: 20 });
    await flush();
    expect(wrapper.find("[data-menu-action='open-in-terminal']").exists()).toBe(
      true,
    );

    // File row -> "Open Terminal" hidden
    await wrapper
      .find("[data-explorer-row-path='/repo/README.md']")
      .trigger("contextmenu", { clientX: 10, clientY: 20 });
    await flush();
    expect(wrapper.find("[data-menu-action='open-in-terminal']").exists()).toBe(
      false,
    );
  });

  it("emits openInTerminal with the directory path and closes the menu", async () => {
    const wrapper = mount(FileExplorer, {
      global: { plugins: [createPinia()] },
      props: { rootPath: "/repo" },
    });
    await flush();

    await wrapper
      .find("[data-explorer-row-path='/repo/src']")
      .trigger("contextmenu", { clientX: 10, clientY: 20 });
    await flush();

    await wrapper
      .find("[data-menu-action='open-in-terminal']")
      .trigger("click");
    await flush();

    expect(wrapper.emitted("openInTerminal")).toEqual([["/repo/src"]]);
    expect(wrapper.find("[data-menu-action='open-in-terminal']").exists()).toBe(
      false,
    );
  });

  it("closes the context menu when clicking outside it", async () => {
    const wrapper = mount(FileExplorer, {
      global: { plugins: [createPinia()] },
      props: { rootPath: "/repo" },
    });
    await flush();

    await wrapper
      .find("[data-explorer-row-path='/repo/README.md']")
      .trigger("contextmenu", { clientX: 10, clientY: 20 });
    await flush();

    expect(wrapper.find("[data-menu-action='delete']").exists()).toBe(true);

    window.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
    await flush();

    expect(wrapper.find("[data-menu-action='delete']").exists()).toBe(false);
  });

  it("closes the context menu on Escape", async () => {
    const wrapper = mount(FileExplorer, {
      global: { plugins: [createPinia()] },
      props: { rootPath: "/repo" },
    });
    await flush();

    await wrapper
      .find("[data-explorer-row-path='/repo/README.md']")
      .trigger("contextmenu", { clientX: 10, clientY: 20 });
    await flush();

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await flush();

    expect(wrapper.find("[data-menu-action='delete']").exists()).toBe(false);
  });

  it("keeps the context menu open for internal pointer interactions", async () => {
    const wrapper = mount(FileExplorer, {
      attachTo: document.body,
      global: { plugins: [createPinia()] },
      props: { rootPath: "/repo" },
    });
    await flush();

    await wrapper
      .find("[data-explorer-row-path='/repo/README.md']")
      .trigger("contextmenu", { clientX: 10, clientY: 20 });
    await flush();

    const deleteButton = wrapper.find("[data-menu-action='delete']");
    deleteButton.element.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
    await flush();

    expect(wrapper.find("[data-menu-action='delete']").exists()).toBe(true);
    wrapper.unmount();
  });

  it("searches files and opens the selected search result", async () => {
    vi.useFakeTimers();
    const wrapper = mount(FileExplorer, {
      global: { plugins: [createPinia()] },
      props: { rootPath: "/repo" },
    });
    await flush();

    await wrapper.find("[data-toggle-search]").trigger("click");
    await flush();
    await wrapper.find("[data-explorer-search-input]").setValue("main");
    await vi.advanceTimersByTimeAsync(300);
    await flush();

    expect(searchFileTree).toHaveBeenCalledWith(
      WS_NATIVE_MATCHER,
      "/repo",
      "main",
      false,
    );
    await wrapper.find("[data-search-result='/repo/src/main.ts']").trigger("click");

    const openFileEvents = wrapper.emitted("openFile") ?? [];
    expect(openFileEvents[openFileEvents.length - 1]).toEqual([
      "/repo/src/main.ts",
      false,
    ]);
    vi.useRealTimers();
  });

  it("supports keyboard navigation for rows", async () => {
    const wrapper = mount(FileExplorer, {
      attachTo: document.body,
      global: { plugins: [createPinia()] },
      props: { rootPath: "/repo" },
    });
    await flush();

    const explorer = wrapper.find("[data-file-explorer]");
    await explorer.trigger("keydown", { key: "ArrowDown" });
    await explorer.trigger("keydown", { key: "ArrowRight" });
    await flush();
    await explorer.trigger("keydown", { key: "ArrowDown" });
    await explorer.trigger("keydown", { key: "Enter" });

    expect(readFileTreeDir).toHaveBeenCalledWith(
      WS_NATIVE_MATCHER,
      "/repo/src",
      false,
    );
    const openFileEvents = wrapper.emitted("openFile") ?? [];
    expect(openFileEvents[openFileEvents.length - 1]).toEqual([
      "/repo/src/main.ts",
      false,
    ]);
    wrapper.unmount();
  });

  it("refreshes only the affected loaded directory for batched fs events", async () => {
    vi.useFakeTimers();
    vi.mocked(readFileTreeDir).mockImplementation(async (_ws, path) => {
      if (path === "/repo") {
        return [
          { name: "docs", kind: "dir", size: 0, mtime: 1 },
          { name: "src", kind: "dir", size: 0, mtime: 2 },
        ];
      }
      if (path === "/repo/docs") {
        return [{ name: "guide.md", kind: "file", size: 10, mtime: 3 }];
      }
      if (path === "/repo/src") {
        return [{ name: "main.ts", kind: "file", size: 20, mtime: 4 }];
      }
      return [];
    });

    const wrapper = mount(FileExplorer, {
      global: { plugins: [createPinia()] },
      props: { rootPath: "/repo", fsEvent: null },
    });
    await flush();

    await wrapper.find("[data-explorer-row-path='/repo/docs']").trigger("click");
    await flush();
    await wrapper.find("[data-explorer-row-path='/repo/src']").trigger("click");
    await flush();
    vi.mocked(readFileTreeDir).mockClear();

    await wrapper.setProps({
      fsEvent: {
        rootPath: "/repo",
        paths: ["/repo/src/a.ts", "/repo/src/b.ts"],
        gitRelated: false,
      },
    });
    await vi.advanceTimersByTimeAsync(240);
    await flush();

    expect(readFileTreeDir).toHaveBeenCalledTimes(1);
    expect(readFileTreeDir).toHaveBeenCalledWith(
      WS_NATIVE_MATCHER,
      "/repo/src",
      false,
    );
    vi.useRealTimers();
  });

  it("keeps loaded rows visible while auto-refreshing an expanded directory", async () => {
    vi.useFakeTimers();
    let srcReads = 0;
    const deferredRefresh: { resolve?: (entries: DirEntry[]) => void } = {};
    vi.mocked(readFileTreeDir).mockImplementation((_ws, path) => {
      if (path === "/repo") {
        return Promise.resolve([
          { name: "src", kind: "dir", size: 0, mtime: 1 },
        ]);
      }
      if (path === "/repo/src") {
        srcReads += 1;
        if (srcReads === 1) {
          return Promise.resolve([
            { name: "main.ts", kind: "file", size: 20, mtime: 2 },
          ]);
        }
        return new Promise((resolve) => {
          deferredRefresh.resolve = resolve;
        });
      }
      return Promise.resolve([]);
    });

    const wrapper = mount(FileExplorer, {
      global: { plugins: [createPinia()] },
      props: { rootPath: "/repo", fsEvent: null },
    });
    await flush();
    await wrapper.find("[data-explorer-row-path='/repo/src']").trigger("click");
    await flush();

    await wrapper.setProps({
      fsEvent: {
        rootPath: "/repo",
        paths: ["/repo/src/new.ts"],
        gitRelated: false,
      },
    });
    await vi.advanceTimersByTimeAsync(240);
    await flush();

    expect(wrapper.text()).toContain("main.ts");
    expect(wrapper.text()).not.toContain("Loading...");

    expect(deferredRefresh.resolve).toBeTypeOf("function");
    deferredRefresh.resolve!([
      { name: "main.ts", kind: "file", size: 20, mtime: 2 },
      { name: "new.ts", kind: "file", size: 30, mtime: 3 },
    ]);
    await flush();

    expect(wrapper.text()).toContain("new.ts");
    vi.useRealTimers();
  });

  it("surfaces a newly created file at the workspace root via fsEvent", async () => {
    // Regression for the silent-root-patch bug: pre-fix, `patchTreeSnapshot([root])`
    // was a no-op because root is not present in `entryIndexByPath`.
    // The fix adds a root-path branch in `updateFileTreeRows` that
    // rebuilds the entire visible tree, which is what we want whenever
    // the silent refresh's target *is* the workspace root.
    vi.useFakeTimers();
    let rootReads = 0;
    vi.mocked(readFileTreeDir).mockImplementation(async (_ws, path) => {
      if (path === "/repo") {
        rootReads += 1;
        // First read happens at mount; subsequent reads happen when the
        // fsEvent kicks off a silent refresh.
        const base: DirEntry[] = [
          { name: "src", kind: "dir", size: 0, mtime: 1 },
          { name: "README.md", kind: "file", size: 10, mtime: 2 },
        ];
        if (rootReads > 1) {
          base.push({ name: "fresh.md", kind: "file", size: 5, mtime: 9 });
        }
        return base;
      }
      if (path === "/repo/src") {
        return [{ name: "main.ts", kind: "file", size: 100, mtime: 3 }];
      }
      return [];
    });

    const wrapper = mount(FileExplorer, {
      global: { plugins: [createPinia()] },
      props: { rootPath: "/repo", fsEvent: null },
    });
    await flush();

    expect(wrapper.text()).not.toContain("fresh.md");

    await wrapper.setProps({
      fsEvent: {
        rootPath: "/repo",
        paths: ["/repo/fresh.md"],
        gitRelated: false,
      },
    });
    await vi.advanceTimersByTimeAsync(240);
    await flush();

    expect(wrapper.text()).toContain("fresh.md");
    expect(
      wrapper.find("[data-explorer-row-path='/repo/fresh.md']").exists(),
    ).toBe(true);
    vi.useRealTimers();
  });

  it("surfaces a newly created directory in an expanded subtree via fsEvent", async () => {
    vi.useFakeTimers();
    let srcReads = 0;
    vi.mocked(readFileTreeDir).mockImplementation(async (_ws, path) => {
      if (path === "/repo") {
        return [{ name: "src", kind: "dir", size: 0, mtime: 1 }];
      }
      if (path === "/repo/src") {
        srcReads += 1;
        const base: DirEntry[] = [
          { name: "main.ts", kind: "file", size: 100, mtime: 3 },
        ];
        if (srcReads > 1) {
          base.push({ name: "components", kind: "dir", size: 0, mtime: 5 });
        }
        return base;
      }
      return [];
    });

    const wrapper = mount(FileExplorer, {
      global: { plugins: [createPinia()] },
      props: { rootPath: "/repo", fsEvent: null },
    });
    await flush();
    await wrapper.find("[data-explorer-row-path='/repo/src']").trigger("click");
    await flush();
    expect(wrapper.text()).not.toContain("components");

    await wrapper.setProps({
      fsEvent: {
        rootPath: "/repo",
        paths: ["/repo/src/components"],
        gitRelated: false,
      },
    });
    await vi.advanceTimersByTimeAsync(240);
    await flush();

    expect(wrapper.text()).toContain("components");
    expect(
      wrapper.find("[data-explorer-row-path='/repo/src/components']").exists(),
    ).toBe(true);
    vi.useRealTimers();
  });

  it("manual refresh re-reads every loaded directory", async () => {
    // Regression for the manual refresh bug: pre-fix, the toolbar
    // refresh button only re-read root, so a file created deep in an
    // expanded subtree was invisible until the user collapsed and
    // re-expanded it.
    vi.useFakeTimers();
    let srcReads = 0;
    vi.mocked(readFileTreeDir).mockImplementation(async (_ws, path) => {
      if (path === "/repo") {
        return [{ name: "src", kind: "dir", size: 0, mtime: 1 }];
      }
      if (path === "/repo/src") {
        srcReads += 1;
        const base: DirEntry[] = [
          { name: "main.ts", kind: "file", size: 100, mtime: 3 },
        ];
        if (srcReads > 1) {
          base.push({
            name: "new-at-subtree.ts",
            kind: "file",
            size: 5,
            mtime: 9,
          });
        }
        return base;
      }
      return [];
    });

    const wrapper = mount(FileExplorer, {
      global: { plugins: [createPinia()] },
      props: { rootPath: "/repo", fsEvent: null },
    });
    await flush();
    await wrapper.find("[data-explorer-row-path='/repo/src']").trigger("click");
    await flush();
    expect(wrapper.text()).not.toContain("new-at-subtree.ts");
    vi.mocked(readFileTreeDir).mockClear();

    // Click the toolbar refresh button (the only entry that exercises
    // `refreshPath` with its default argument).
    const refreshButton = wrapper
      .find("[data-explorer-header]")
      .findAll("button")
      .find((b) => b.attributes("aria-label") === "Refresh");
    expect(refreshButton).toBeDefined();
    await refreshButton!.trigger("click");
    await vi.advanceTimersByTimeAsync(0);
    await flush();

    // Both root and the expanded subtree must be re-read.
    expect(readFileTreeDir).toHaveBeenCalledWith(WS_NATIVE_MATCHER, "/repo", false);
    expect(readFileTreeDir).toHaveBeenCalledWith(
      WS_NATIVE_MATCHER,
      "/repo/src",
      false,
    );
    expect(wrapper.text()).toContain("new-at-subtree.ts");
    vi.useRealTimers();
  });

  it("coalesces repeated fs refreshes while a directory read is in flight", async () => {
    vi.useFakeTimers();
    let srcReads = 0;
    const pendingRefreshes: Array<(entries: DirEntry[]) => void> = [];
    vi.mocked(readFileTreeDir).mockImplementation((_ws, path) => {
      if (path === "/repo") {
        return Promise.resolve([
          { name: "src", kind: "dir", size: 0, mtime: 1 },
        ]);
      }
      if (path === "/repo/src") {
        srcReads += 1;
        if (srcReads === 1) {
          return Promise.resolve([
            { name: "main.ts", kind: "file", size: 20, mtime: 2 },
          ]);
        }
        return new Promise((resolve) => pendingRefreshes.push(resolve));
      }
      return Promise.resolve([]);
    });

    const wrapper = mount(FileExplorer, {
      global: { plugins: [createPinia()] },
      props: { rootPath: "/repo", fsEvent: null },
    });
    await flush();
    await wrapper.find("[data-explorer-row-path='/repo/src']").trigger("click");
    await flush();
    vi.mocked(readFileTreeDir).mockClear();

    await wrapper.setProps({
      fsEvent: {
        rootPath: "/repo",
        paths: ["/repo/src/a.ts"],
        gitRelated: false,
      },
    });
    await vi.advanceTimersByTimeAsync(240);
    await flush();

    await wrapper.setProps({
      fsEvent: {
        rootPath: "/repo",
        paths: ["/repo/src/b.ts"],
        gitRelated: false,
      },
    });
    await vi.advanceTimersByTimeAsync(240);
    await flush();

    expect(readFileTreeDir).toHaveBeenCalledTimes(1);
    pendingRefreshes[0]?.([
      { name: "main.ts", kind: "file", size: 20, mtime: 2 },
      { name: "a.ts", kind: "file", size: 30, mtime: 3 },
    ]);
    await flush();

    expect(readFileTreeDir).toHaveBeenCalledTimes(2);
    pendingRefreshes[1]?.([
      { name: "main.ts", kind: "file", size: 20, mtime: 2 },
      { name: "a.ts", kind: "file", size: 30, mtime: 3 },
      { name: "b.ts", kind: "file", size: 40, mtime: 4 },
    ]);
    await flush();
    vi.useRealTimers();
  });

  // "复制副本"现在与拖拽 / 粘贴共用搬运链路：命名避让交给后端 fs-core，
  // 前端不再自己 try 100 次 catch "already exists"。
  it("复制副本走统一的搬运链路（fsCopyMany + 自动改名）", async () => {
    mockWsNative.fsCopyMany.mockResolvedValueOnce({
      completed: [{ from: "/repo/README.md", to: "/repo/README copy.md" }],
      skipped: [],
      failed: [],
      crossDevice: [],
      warnings: [],
    });
    const wrapper = mountExplorer();
    await flush();

    await wrapper
      .find("[data-explorer-row-path='/repo/README.md']")
      .trigger("contextmenu", { clientX: 10, clientY: 20 });
    await flush();
    await wrapper.find("[data-menu-action='duplicate']").trigger("click");
    await flush();

    expect(mockWsNative.fsCopyMany).toHaveBeenCalledWith(
      [{ from: "/repo/README.md", to: "/repo/README copy.md" }],
      "rename",
      1,
    );
    // 不再走单条 fs_copy —— 那条命令在 WSL/SSH 下的符号链接处理与新引擎不一致
    expect(mockWsNative.fsMoveMany).not.toHaveBeenCalled();
  });

  // ── 搬运（拖拽 / 粘贴共用入口）─────────────────────────────────────
  // /repo 根目录已加载：条目为 src(dir) / README.md / package.json，
  // 因此目标为 /repo 时 exists 探测是真实生效的。

  it("无冲突时直接搬运，并让已打开的 tab 跟随新路径", async () => {
    mockWsNative.fsMoveMany.mockResolvedValueOnce({
      completed: [{ from: "/repo/src/main.ts", to: "/repo/main.ts" }],
      skipped: [],
      failed: [],
      crossDevice: [],
      warnings: [],
    });
    const wrapper = mountExplorer();
    await flush();

    await wrapper.vm.runTransfer(["/repo/src/main.ts"], "/repo", "move");
    await flush();

    expect(mockWsNative.fsMoveMany).toHaveBeenCalledWith(
      [{ from: "/repo/src/main.ts", to: "/repo/main.ts" }],
      "rename",
      1,
    );
    expect(mockWsNative.fsCopyMany).not.toHaveBeenCalled();
    // 重命名后必须让编辑器标签跟着走，否则保存会写回不存在的旧路径。
    expect(wrapper.emitted("pathRenamed")).toEqual([
      ["/repo/src/main.ts", "/repo/main.ts"],
    ]);
  });

  it("复制模式走 fsCopyMany 且不发 pathRenamed", async () => {
    mockWsNative.fsCopyMany.mockResolvedValueOnce({
      completed: [{ from: "/repo/src/main.ts", to: "/repo/main.ts" }],
      skipped: [],
      failed: [],
      crossDevice: [],
      warnings: [],
    });
    const wrapper = mountExplorer();
    await flush();

    await wrapper.vm.runTransfer(["/repo/src/main.ts"], "/repo", "copy");
    await flush();

    expect(mockWsNative.fsCopyMany).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted("pathRenamed")).toBeUndefined();
  });

  it("目标已有同名项时先弹冲突对话框，确认前不发请求", async () => {
    const wrapper = mountExplorer();
    await flush();

    await wrapper.vm.runTransfer(["/repo/src/README.md"], "/repo", "move");
    await flush();

    expect(mockWsNative.fsMoveMany).not.toHaveBeenCalled();
    // NModal 走 teleport 挂到 body，wrapper.find 看不到。
    const dialog = document.body.querySelector("[data-transfer-conflict]");
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("1");
  });

  it("冲突对话框的“全部改名”以 rename 策略执行", async () => {
    const wrapper = mountExplorer();
    await flush();
    await wrapper.vm.runTransfer(["/repo/src/README.md"], "/repo", "move");
    await flush();

    clickInBody("[data-conflict-rename]");
    await flush();

    expect(mockWsNative.fsMoveMany).toHaveBeenCalledWith(
      [{ from: "/repo/src/README.md", to: "/repo/README copy.md" }],
      "rename",
      1,
    );
  });

  it("冲突对话框的“跳过”以 skip 策略执行", async () => {
    const wrapper = mountExplorer();
    await flush();
    await wrapper.vm.runTransfer(["/repo/src/README.md"], "/repo", "move");
    await flush();

    clickInBody("[data-conflict-skip]");
    await flush();

    expect(mockWsNative.fsMoveMany).toHaveBeenCalledWith(
      [{ from: "/repo/src/README.md", to: "/repo/README copy.md" }],
      "skip",
      1,
    );
  });

  it("冲突对话框的“覆盖”以 overwrite 策略执行", async () => {
    const wrapper = mountExplorer();
    await flush();
    await wrapper.vm.runTransfer(["/repo/src/README.md"], "/repo", "move");
    await flush();

    clickInBody("[data-conflict-overwrite]");
    await flush();

    expect(mockWsNative.fsMoveMany).toHaveBeenCalledWith(
      [{ from: "/repo/src/README.md", to: "/repo/README copy.md" }],
      "overwrite",
      1,
    );
  });

  it("同名项目标是目录时，覆盖必须先勾选确认才能点", async () => {
    // 局部覆写目录内容：造出 src/assets 与根下 assets 同名的场景。
    // （/repo/src 直接搬到 /repo 会被“同目录”守卫生拦下，不能用。）
    vi.mocked(readFileTreeDir).mockImplementation(async (_ws, path) => {
      if (path === "/repo") {
        return [
          { name: "src", kind: "dir", size: 0, mtime: 1 },
          { name: "assets", kind: "dir", size: 0, mtime: 5 },
        ];
      }
      if (path === "/repo/src") {
        return [{ name: "assets", kind: "dir", size: 0, mtime: 5 }];
      }
      return [];
    });
    const wrapper = mountExplorer();
    await flush();
    // 源目录要真实存在于树里（对话框要判断"覆盖的是不是文件夹"），
    // 所以先展开 src 让它被加载。
    await wrapper.find("[data-explorer-row-path='/repo/src']").trigger("click");
    await flush();

    await wrapper.vm.runTransfer(["/repo/src/assets"], "/repo", "move");
    await flush();

    const overwrite = document.body.querySelector("[data-conflict-overwrite]");
    expect(overwrite).not.toBeNull();
    // 不可逆操作默认禁用，必须显式确认。
    expect(overwrite?.hasAttribute("disabled")).toBe(true);

    // NCheckbox 把真实 input 藏在根节点下，点根节点才走它的 onUpdate。
    const checkbox = document.body.querySelector<HTMLElement>(
      "[data-confirm-overwrite-dirs]",
    );
    checkbox?.click();
    await flush();
    expect(
      document.body
        .querySelector("[data-conflict-overwrite]")
        ?.hasAttribute("disabled"),
    ).toBe(false);
    clickInBody("[data-conflict-overwrite]");
    await flush();

    expect(mockWsNative.fsMoveMany).toHaveBeenCalledWith(
      [{ from: "/repo/src/assets", to: "/repo/assets copy" }],
      "overwrite",
      1,
    );
  });

  it("拖进自身子目录被守卫生拦下，不发任何请求", async () => {
    const wrapper = mountExplorer();
    await flush();

    await wrapper.vm.runTransfer(["/repo/src"], "/repo/src/nested", "move");
    await flush();

    expect(mockWsNative.fsMoveMany).not.toHaveBeenCalled();
    expect(document.body.querySelector("[data-transfer-conflict]")).toBeNull();
  });

  it("搬运进行中拒绝重复提交", async () => {
    let release: (value: unknown) => void = () => undefined;
    mockWsNative.fsMoveMany.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }) as never,
    );
    const wrapper = mountExplorer();
    await flush();

    const first = wrapper.vm.runTransfer(["/repo/src/main.ts"], "/repo", "move");
    await flush();
    await wrapper.vm.runTransfer(["/repo/src/main.ts"], "/repo", "move");
    await flush();

    expect(mockWsNative.fsMoveMany).toHaveBeenCalledTimes(1);
    release({ completed: [], skipped: [], failed: [], crossDevice: [], warnings: [] });
    await first;
    await flush();
  });

  it("部分失败时按 failed 逐条汇报", async () => {
    mockWsNative.fsMoveMany.mockResolvedValueOnce({
      completed: [],
      skipped: [],
      failed: [
        { from: "/repo/src/main.ts", to: "/repo/main.ts", error: "permission denied" },
      ],
      crossDevice: [],
      warnings: [],
    });
    const wrapper = mountExplorer();
    await flush();

    await wrapper.vm.runTransfer(["/repo/src/main.ts"], "/repo", "move");
    await flush();

    expect(mockWsNative.fsMoveMany).toHaveBeenCalledTimes(1);
  });
});

// ── 文件树拖拽搬运 ─────────────────────────────────────────────────
//
// jsdom 没有 document.elementFromPoint，用真实行元素做命中目标：
// 组件的 treeDropTarget 会对它 closest() 定位行与拖放根容器。

const elementFromPointMock = vi.fn((): Element | null => null);
const originalElementFromPoint = document.elementFromPoint;

/**
 * 让 elementFromPoint 命中某个选择器对应的元素。
 * 必须从 wrapper 取元素：这里的 mount 没有 attachTo，DOM 在游离节点上，
 * document.querySelector 查不到（且会误命中其它用例遗留的树）。
 */
function pointAt(wrapper: ReturnType<typeof mount>, selector: string): void {
  const el = wrapper.find(selector).element;
  elementFromPointMock.mockImplementation(() => el);
}

/** 给行一个 24px 的真实矩形（jsdom 默认全 0，边缘带判定会失效）。 */
function giveRowHeight(wrapper: ReturnType<typeof mount>, selector: string): void {
  const el = wrapper.find(selector).element;
  el.getBoundingClientRect = () =>
    ({ top: 0, bottom: 24, height: 24, left: 0, right: 200, width: 200 }) as DOMRect;
}

function pointNowhere(): void {
  elementFromPointMock.mockImplementation(() => null);
}

/** 起手 → 越过阈值 → 悬停落点 → 松手。 */
function dragRowTo(
  wrapper: ReturnType<typeof mount>,
  sourceSelector: string,
  targetSelector: string | null,
  options: { altKey?: boolean } = {},
) {
  const source = wrapper.find(sourceSelector);
  source.element.dispatchEvent(
    new MouseEvent("pointerdown", {
      button: 0,
      clientX: 10,
      clientY: 10,
      altKey: options.altKey ?? false,
      bubbles: true,
    }),
  );
  targetSelector === null ? pointNowhere() : pointAt(wrapper, targetSelector);
  window.dispatchEvent(new MouseEvent("pointermove", { clientX: 60, clientY: 60, bubbles: true }));
  window.dispatchEvent(new MouseEvent("pointerup", { clientX: 60, clientY: 60, bubbles: true }));
}

function moveOnly(x = 60, y = 60) {
  window.dispatchEvent(new MouseEvent("pointermove", { clientX: x, clientY: y, bubbles: true }));
}

describe("FileExplorer drag-to-transfer", () => {
  beforeEach(() => {
    resetExplorerMocks();
    document.elementFromPoint =
      elementFromPointMock as unknown as typeof document.elementFromPoint;
    elementFromPointMock.mockReturnValue(null);
  });

  afterEach(() => {
    document.elementFromPoint = originalElementFromPoint;
  });

  it("拖文件到目录行上 → 搬运（移动）", async () => {
    mockWsNative.fsMoveMany.mockResolvedValueOnce({
      completed: [{ from: "/repo/README.md", to: "/repo/src/README.md" }],
      skipped: [],
      failed: [],
      crossDevice: [],
      warnings: [],
    });
    const wrapper = mountExplorer();
    await flush();

    dragRowTo(
      wrapper,
      "[data-explorer-row-path='/repo/README.md']",
      "[data-explorer-row-path='/repo/src']",
    );
    await flush();

    expect(mockWsNative.fsMoveMany).toHaveBeenCalledWith(
      [{ from: "/repo/README.md", to: "/repo/src/README.md" }],
      "rename",
      1,
    );
  });

  it("按住 Alt 拖拽 → 走复制", async () => {
    const wrapper = mountExplorer();
    await flush();

    dragRowTo(
      wrapper,
      "[data-explorer-row-path='/repo/README.md']",
      "[data-explorer-row-path='/repo/src']",
      { altKey: true },
    );
    await flush();

    expect(mockWsNative.fsCopyMany).toHaveBeenCalledWith(
      [{ from: "/repo/README.md", to: "/repo/src/README.md" }],
      "rename",
      1,
    );
    expect(mockWsNative.fsMoveMany).not.toHaveBeenCalled();
  });

  it("拖拽期间松开 Alt 会在松手前切回移动", async () => {
    const wrapper = mountExplorer();
    await flush();
    const source = wrapper.find("[data-explorer-row-path='/repo/README.md']");
    source.element.dispatchEvent(
      new MouseEvent("pointerdown", {
        button: 0,
        clientX: 10,
        clientY: 10,
        altKey: true,
        bubbles: true,
      }),
    );
    pointAt(wrapper, "[data-explorer-row-path='/repo/src']");
    moveOnly();
    // 拖拽中松开 Alt
    window.dispatchEvent(new KeyboardEvent("keyup", { altKey: false, bubbles: true }));
    window.dispatchEvent(new MouseEvent("pointerup", { clientX: 60, clientY: 60, bubbles: true }));
    await flush();

    expect(mockWsNative.fsMoveMany).toHaveBeenCalledTimes(1);
    expect(mockWsNative.fsCopyMany).not.toHaveBeenCalled();
  });

  it("拖多选时整批一起搬", async () => {
    mockWsNative.fsMoveMany.mockResolvedValue({
      completed: [],
      skipped: [],
      failed: [],
      crossDevice: [],
      warnings: [],
    });
    const wrapper = mountExplorer();
    await flush();
    // ctrl 点选 README.md 与 package.json
    await wrapper
      .find("[data-explorer-row-path='/repo/README.md']")
      .trigger("click", { ctrlKey: true });
    await wrapper
      .find("[data-explorer-row-path='/repo/package.json']")
      .trigger("click", { ctrlKey: true });
    await flush();

    dragRowTo(
      wrapper,
      "[data-explorer-row-path='/repo/README.md']",
      "[data-explorer-row-path='/repo/src']",
    );
    await flush();

    expect(mockWsNative.fsMoveMany).toHaveBeenCalledWith(
      [
        { from: "/repo/README.md", to: "/repo/src/README.md" },
        { from: "/repo/package.json", to: "/repo/src/package.json" },
      ],
      "rename",
      1,
    );
  });

  it("文件行不接收落点（不能把东西放进文件里）", async () => {
    const wrapper = mountExplorer();
    await flush();

    dragRowTo(
      wrapper,
      "[data-explorer-row-path='/repo/README.md']",
      "[data-explorer-row-path='/repo/package.json']",
    );
    await flush();

    expect(mockWsNative.fsMoveMany).not.toHaveBeenCalled();
    expect(mockWsNative.fsCopyMany).not.toHaveBeenCalled();
  });

  it("拖进自身子目录：非法落点，松手不执行", async () => {
    const wrapper = mountExplorer();
    await flush();

    // /repo/src 是目录；把它拖到它自己的子目录需要该子目录在树上。
    vi.mocked(readFileTreeDir).mockImplementation(async (_ws, path) => {
      if (path === "/repo") {
        return [
          { name: "src", kind: "dir", size: 0, mtime: 1 },
          { name: "README.md", kind: "file", size: 10, mtime: 2 },
        ];
      }
      if (path === "/repo/src") {
        return [{ name: "deep", kind: "dir", size: 0, mtime: 3 }];
      }
      return [];
    });
    const wrapper2 = mountExplorer();
    await flush();
    await wrapper2.find("[data-explorer-row-path='/repo/src']").trigger("click");
    await flush();

    dragRowTo(
      wrapper2,
      "[data-explorer-row-path='/repo/src']",
      "[data-explorer-row-path='/repo/src/deep']",
    );
    await flush();

    expect(mockWsNative.fsMoveMany).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("拖到树的空白区域 = 搬到工作区根", async () => {
    mockWsNative.fsMoveMany.mockResolvedValueOnce({
      completed: [{ from: "/repo/README.md", to: "/repo/README.md" }],
      skipped: [],
      failed: [],
      crossDevice: [],
      warnings: [],
    });
    const wrapper = mountExplorer();
    await flush();

    // 命中树容器（data-explorer-drop-root）但不是任何行。
    pointAt(wrapper, "[data-explorer-drop-root]");
    const source = wrapper.find("[data-explorer-row-path='/repo/README.md']");
    source.element.dispatchEvent(
      new MouseEvent("pointerdown", { button: 0, clientX: 10, clientY: 10, bubbles: true }),
    );
    moveOnly();
    window.dispatchEvent(new MouseEvent("pointerup", { clientX: 60, clientY: 60, bubbles: true }));
    await flush();

    // 源本来就在根下 → 守卫拦下（不重复搬到自己脚下）
    expect(mockWsNative.fsMoveMany).not.toHaveBeenCalled();
  });

  it("拖拽结束后吃掉紧跟的 click，不改变选择", async () => {
    const wrapper = mountExplorer();
    await flush();

    const source = wrapper.find("[data-explorer-row-path='/repo/README.md']");
    source.element.dispatchEvent(
      new MouseEvent("pointerdown", { button: 0, clientX: 10, clientY: 10, bubbles: true }),
    );
    pointAt(wrapper, "[data-explorer-row-path='/repo/src']");
    moveOnly();
    window.dispatchEvent(new MouseEvent("pointerup", { clientX: 60, clientY: 60, bubbles: true }));
    await flush();

    // 拖拽前 src 未选中；松手后的 click 若生效会把 src 选上
    await source.trigger("click");
    await flush();
    expect(
      wrapper
        .findAll("[data-explorer-row-path]")
        .map((row) => row.attributes("aria-pressed"))
        .filter((value) => value === "true"),
    ).toEqual([]);
  });

  it("拖到文件行的下缘 → 同级插入到它的父目录（而不是放进文件）", async () => {
    mockWsNative.fsMoveMany.mockResolvedValueOnce({
      completed: [{ from: "/repo/README.md", to: "/repo/src/README.md" }],
      skipped: [],
      failed: [],
      crossDevice: [],
      warnings: [],
    });
    const wrapper = mountExplorer();
    await flush();
    // 源必须在别的目录里：把 /repo 下的文件拖到 /repo 根是"同目录移动"，
    // 会被守卫正确拦下（那样就测不到落点语义了）。
    await wrapper.find("[data-explorer-row-path='/repo/src']").trigger("click");
    await flush();
    giveRowHeight(wrapper, "[data-explorer-row-path='/repo/README.md']");
    const source = wrapper.find("[data-explorer-row-path='/repo/src/main.ts']");
    source.element.dispatchEvent(
      new MouseEvent("pointerdown", { button: 0, clientX: 10, clientY: 10, bubbles: true }),
    );
    pointAt(wrapper, "[data-explorer-row-path='/repo/README.md']");
    // y=22 落在 24px 行的下缘带（>= 75%）
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 60, clientY: 22, bubbles: true }));
    window.dispatchEvent(new MouseEvent("pointerup", { clientX: 60, clientY: 22, bubbles: true }));
    await flush();

    // 目标是该行的**父目录**（/repo），不是文件本身
    expect(mockWsNative.fsMoveMany).toHaveBeenCalledWith(
      [{ from: "/repo/src/main.ts", to: "/repo/main.ts" }],
      "rename",
      expect.any(Number),
    );
  });

  it("拖到文件行的中间 → 非法落点（不能把东西放进文件里）", async () => {
    const wrapper = mountExplorer();
    await flush();
    giveRowHeight(wrapper, "[data-explorer-row-path='/repo/README.md']");
    const source = wrapper.find("[data-explorer-row-path='/repo/package.json']");
    source.element.dispatchEvent(
      new MouseEvent("pointerdown", { button: 0, clientX: 10, clientY: 10, bubbles: true }),
    );
    pointAt(wrapper, "[data-explorer-row-path='/repo/README.md']");
    // y=12 是行的正中（既不在上缘带也不在下缘带）
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 60, clientY: 12, bubbles: true }));
    window.dispatchEvent(new MouseEvent("pointerup", { clientX: 60, clientY: 12, bubbles: true }));
    await flush();

    expect(mockWsNative.fsMoveMany).not.toHaveBeenCalled();
  });

  it("拖到目录行的上缘 → 同级插到它前面（缩进由行层级决定）", async () => {
    const wrapper = mountExplorer();
    await flush();
    await wrapper.find("[data-explorer-row-path='/repo/src']").trigger("click");
    await flush();
    giveRowHeight(wrapper, "[data-explorer-row-path='/repo/README.md']");
    const source = wrapper.find("[data-explorer-row-path='/repo/src/main.ts']");
    source.element.dispatchEvent(
      new MouseEvent("pointerdown", { button: 0, clientX: 10, clientY: 10, bubbles: true }),
    );
    pointAt(wrapper, "[data-explorer-row-path='/repo/README.md']");
    // y=2 落在上缘带
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 60, clientY: 2, bubbles: true }));

    const row = wrapper.find("[data-explorer-row-path='/repo/README.md']");
    expect(row.attributes("data-depth")).toBe("0");
    await nextTick();
    // 插入线用 before 伪元素，且**不高亮整行**（两者语义不同）
    expect(row.classes().join(" ")).toContain("before:absolute");

    window.dispatchEvent(new MouseEvent("pointerup", { clientX: 60, clientY: 2, bubbles: true }));
    await flush();
    // 插到 /repo/README.md 前面 = 落到 /repo 根下（而不是放进 src）
    expect(mockWsNative.fsMoveMany).toHaveBeenCalledWith(
      [{ from: "/repo/src/main.ts", to: "/repo/main.ts" }],
      "rename",
      expect.any(Number),
    );
  });

  it("拖到目录行中间仍是“放进该目录”（不回归 drop-into）", async () => {
    mockWsNative.fsMoveMany.mockResolvedValueOnce({
      completed: [{ from: "/repo/README.md", to: "/repo/src/README.md" }],
      skipped: [],
      failed: [],
      crossDevice: [],
      warnings: [],
    });
    const wrapper = mountExplorer();
    await flush();
    giveRowHeight(wrapper, "[data-explorer-row-path='/repo/src']");
    const source = wrapper.find("[data-explorer-row-path='/repo/README.md']");
    source.element.dispatchEvent(
      new MouseEvent("pointerdown", { button: 0, clientX: 10, clientY: 10, bubbles: true }),
    );
    pointAt(wrapper, "[data-explorer-row-path='/repo/src']");
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 60, clientY: 12, bubbles: true }));
    window.dispatchEvent(new MouseEvent("pointerup", { clientX: 60, clientY: 12, bubbles: true }));
    await flush();

    expect(mockWsNative.fsMoveMany).toHaveBeenCalledWith(
      [{ from: "/repo/README.md", to: "/repo/src/README.md" }],
      "rename",
      expect.any(Number),
    );
  });

  it("移动后可以撤销一次（把文件搬回原处）", async () => {
    // 夹具必须反映"移动之后"的真实状态，否则撤销会被正确地判成冲突
    // （规划器看到 /repo/src/main.ts 还存在 —— 而它此时已经不在了）。
    let moved = false;
    vi.mocked(readFileTreeDir).mockImplementation(async (_ws, path) => {
      if (path === "/repo") {
        return moved
          ? [
              { name: "src", kind: "dir", size: 0, mtime: 1 },
              { name: "main.ts", kind: "file", size: 100, mtime: 9 },
            ]
          : [{ name: "src", kind: "dir", size: 0, mtime: 1 }];
      }
      if (path === "/repo/src") {
        return moved ? [] : [{ name: "main.ts", kind: "file", size: 100, mtime: 3 }];
      }
      return [];
    });
    mockWsNative.fsMoveMany
      .mockImplementationOnce(async () => {
        moved = true;
        return {
          completed: [{ from: "/repo/src/main.ts", to: "/repo/main.ts" }],
          skipped: [],
          failed: [],
          crossDevice: [],
          warnings: [],
        };
      })
      .mockImplementationOnce(async () => {
        moved = false;
        return {
          completed: [{ from: "/repo/main.ts", to: "/repo/src/main.ts" }],
          skipped: [],
          failed: [],
          crossDevice: [],
          warnings: [],
        };
      });
    const wrapper = mountExplorer();
    await flush();
    await wrapper.find("[data-explorer-row-path='/repo/src']").trigger("click");
    await flush();

    // 撤销按钮在还没有移动过之前是禁用的
    expect(wrapper.find("[data-undo-move]").attributes("disabled")).toBeDefined();

    dragRowTo(
      wrapper,
      "[data-explorer-row-path='/repo/src/main.ts']",
      "[data-explorer-drop-root]",
    );
    // 按钮启用发生在 settleAfterTransfer 里，而 transferBusy 要到 finally
    // 才清 —— 等它真的可点，否则点下去会被"搬运中"守卫吞掉。
    await vi.waitFor(() =>
      expect(wrapper.find("[data-undo-move]").attributes("disabled")).toBeUndefined(),
    );

    await wrapper.find("[data-undo-move]").trigger("click");
    await flush();

    // 撤销 = 一次新的 move，把落点搬回原目录
    expect(mockWsNative.fsMoveMany).toHaveBeenLastCalledWith(
      [{ from: "/repo/main.ts", to: "/repo/src/main.ts" }],
      "rename",
      expect.any(Number),
    );
  });

  it("复制后不提供移动撤销（撤销到与当前状态无关的位置更困惑）", async () => {
    mockWsNative.fsCopyMany.mockResolvedValue({
      completed: [{ from: "/repo/README.md", to: "/repo/src/README.md" }],
      skipped: [],
      failed: [],
      crossDevice: [],
      warnings: [],
    });
    const wrapper = mountExplorer();
    await flush();
    await wrapper.find("[data-explorer-row-path='/repo/src']").trigger("click");
    await flush();
    dragRowTo(
      wrapper,
      "[data-explorer-row-path='/repo/README.md']",
      "[data-explorer-row-path='/repo/src']",
      { altKey: true },
    );
    await flush();

    expect(wrapper.find("[data-undo-move]").attributes("disabled")).toBeDefined();
  });

  it("撤销是一次性的：撤销后按钮重新禁用", async () => {
    mockWsNative.fsMoveMany.mockResolvedValue({
      completed: [{ from: "/repo/src/main.ts", to: "/repo/main.ts" }],
      skipped: [],
      failed: [],
      crossDevice: [],
      warnings: [],
    });
    // 只断言按钮状态，不校验撤销本身发起的搬运（上面已覆盖），
    // 因此不需要同步"移动后"的目录夹具。
    const wrapper = mountExplorer();
    await flush();
    await wrapper.find("[data-explorer-row-path='/repo/src']").trigger("click");
    await flush();
    dragRowTo(
      wrapper,
      "[data-explorer-row-path='/repo/src/main.ts']",
      "[data-explorer-drop-root]",
    );
    await vi.waitFor(() =>
      expect(wrapper.find("[data-undo-move]").attributes("disabled")).toBeUndefined(),
    );
    await wrapper.find("[data-undo-move]").trigger("click");
    await flush();

    expect(wrapper.find("[data-undo-move]").attributes("disabled")).toBeDefined();
  });

  it("位移小于阈值只是普通点击，不触发搬运", async () => {
    const wrapper = mountExplorer();
    await flush();

    const source = wrapper.find("[data-explorer-row-path='/repo/README.md']");
    source.element.dispatchEvent(
      new MouseEvent("pointerdown", { button: 0, clientX: 10, clientY: 10, bubbles: true }),
    );
    pointAt(wrapper, "[data-explorer-row-path='/repo/src']");
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 12, clientY: 11, bubbles: true }));
    window.dispatchEvent(new MouseEvent("pointerup", { clientX: 12, clientY: 11, bubbles: true }));
    await flush();

    expect(mockWsNative.fsMoveMany).not.toHaveBeenCalled();
    expect(mockWsNative.fsCopyMany).not.toHaveBeenCalled();
  });
});

describe("FileExplorer clipboard (cut / copy / paste)", () => {
  beforeEach(() => {
    resetExplorerMocks();
  });

  /**
   * 直接在元素上派发 KeyboardEvent：vue-test-utils 的 trigger 会尝试给
   * 事件写 isTrusted（只读属性），传构造器实例会抛错。
   */
  function pressKey(
    wrapper: ReturnType<typeof mount>,
    key: string,
    init: { ctrlKey?: boolean } = {},
  ): void {
    wrapper.find("[data-file-explorer]").element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        ctrlKey: init.ctrlKey ?? true,
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  it("Cmd+C 复制多选集，Cmd+V 粘到选中的目录（走复制）", async () => {
    mockWsNative.fsCopyMany.mockResolvedValueOnce({
      completed: [{ from: "/repo/README.md", to: "/repo/src/README.md" }],
      skipped: [],
      failed: [],
      crossDevice: [],
      warnings: [],
    });
    const wrapper = mountExplorer();
    await flush();
    // 多选两项
    await wrapper
      .find("[data-explorer-row-path='/repo/README.md']")
      .trigger("click", { ctrlKey: true });
    await wrapper
      .find("[data-explorer-row-path='/repo/package.json']")
      .trigger("click", { ctrlKey: true });
    await flush();

    pressKey(wrapper, "c");
    await flush();

    // 粘贴落点 = 当前单选的目录
    await wrapper.find("[data-explorer-row-path='/repo/src']").trigger("click");
    await flush();
    pressKey(wrapper, "v");
    await flush();

    expect(mockWsNative.fsCopyMany).toHaveBeenCalledWith(
      [
        { from: "/repo/README.md", to: "/repo/src/README.md" },
        { from: "/repo/package.json", to: "/repo/src/package.json" },
      ],
      "rename",
      1,
    );
    expect(mockWsNative.fsMoveMany).not.toHaveBeenCalled();
  });

  it("Cmd+X 剪切后 Cmd+V 走移动", async () => {
    mockWsNative.fsMoveMany.mockResolvedValueOnce({
      completed: [{ from: "/repo/README.md", to: "/repo/src/README.md" }],
      skipped: [],
      failed: [],
      crossDevice: [],
      warnings: [],
    });
    const wrapper = mountExplorer();
    await flush();
    // 选中 src 目录作为粘贴落点
    await wrapper.find("[data-explorer-row-path='/repo/src']").trigger("click");
    await flush();

    await wrapper
      .find("[data-explorer-row-path='/repo/README.md']")
      .trigger("click");
    await flush();
    pressKey(wrapper, "x");
    await flush();
    // 重新选中 src 作为落点
    await wrapper.find("[data-explorer-row-path='/repo/src']").trigger("click");
    await flush();
    pressKey(wrapper, "v");
    await flush();

    expect(mockWsNative.fsMoveMany).toHaveBeenCalledWith(
      [{ from: "/repo/README.md", to: "/repo/src/README.md" }],
      "rename",
      1,
    );
    expect(mockWsNative.fsCopyMany).not.toHaveBeenCalled();
  });

  it("剪切粘贴后剪贴板失效（一次性）", async () => {
    const wrapper = mountExplorer();
    await flush();
    await wrapper
      .find("[data-explorer-row-path='/repo/README.md']")
      .trigger("click");
    await flush();
    pressKey(wrapper, "x");
    await flush();

    pressKey(wrapper, "v");
    await flush();
    mockWsNative.fsMoveMany.mockClear();

    // 剪贴板已空 → 再按 Cmd+V 不发任何请求
    pressKey(wrapper, "v");
    await flush();
    expect(mockWsNative.fsMoveMany).not.toHaveBeenCalled();
  });

  it("空剪贴板时 Cmd+V 不被文件树接管", async () => {
    const wrapper = mountExplorer();
    await flush();
    pressKey(wrapper, "v");
    await flush();
    expect(mockWsNative.fsMoveMany).not.toHaveBeenCalled();
    expect(mockWsNative.fsCopyMany).not.toHaveBeenCalled();
  });

  it("右键菜单：剪切 / 复制 / 粘出三个动作", async () => {
    const wrapper = mountExplorer();
    await flush();
    await wrapper
      .find("[data-explorer-row-path='/repo/README.md']")
      .trigger("contextmenu", { clientX: 10, clientY: 20 });
    await flush();

    for (const action of ["cut", "copy", "paste"]) {
      expect(wrapper.find(`[data-menu-action='${action}']`).exists(), action).toBe(true);
    }
  });

  it("右键菜单的粘贴按剪贴板状态启用", async () => {
    const wrapper = mountExplorer();
    await flush();

    await wrapper
      .find("[data-explorer-row-path='/repo/README.md']")
      .trigger("contextmenu", { clientX: 10, clientY: 20 });
    await flush();
    // 空剪贴板 → 根右键菜单的粘贴不可用
    wrapper.unmount();

    // 根目录菜单
    const rootWrapper = mountExplorer();
    await flush();
    rootWrapper
      .find("[data-explorer-drop-root]")
      .element.dispatchEvent(
        new MouseEvent("contextmenu", { clientX: 5, clientY: 5, bubbles: true }),
      );
    await flush();
    expect(rootWrapper.find("[data-menu-action='paste']").exists()).toBe(true);
  });
});

describe("FileExplorer OS file drop", () => {
  beforeEach(() => {
    resetExplorerMocks();
    osDragHandlers.length = 0;
    document.elementFromPoint = elementFromPointMock as unknown as typeof document.elementFromPoint;
    elementFromPointMock.mockReturnValue(null);
  });

  /**
   * onOsFileDragDrop 内部是动态 import，订阅发生在微任务之后的宏任务里，
   * 单次 flush 不够；等它真的挂上再继续。
   */
  async function waitForOsSubscription(): Promise<void> {
    await vi.waitFor(() => expect(osDragHandlers.length).toBeGreaterThan(0));
  }

  it("drop 到目录行 → 复制到该目录（OS 拖入永不删源）", async () => {
    mockWsNative.fsCopyMany.mockResolvedValueOnce({
      completed: [{ from: "/home/dev/pic.png", to: "/repo/src/pic.png" }],
      skipped: [],
      failed: [],
      crossDevice: [],
      warnings: [],
    });
    const wrapper = mountExplorer();
    await flush();
    await waitForOsSubscription();
    pointAt(wrapper, "[data-explorer-row-path='/repo/src']");

    fireOsDrag({
      type: "drop",
      paths: ["/home/dev/pic.png"],
      position: { x: 20, y: 20 },
    });
    await flush();

    expect(mockWsNative.fsCopyMany).toHaveBeenCalledWith(
      [{ from: "/home/dev/pic.png", to: "/repo/src/pic.png" }],
      "rename",
      1,
    );
    expect(mockWsNative.fsMoveMany).not.toHaveBeenCalled();
  });

  it("over 高亮落点，leave 清除", async () => {
    const wrapper = mountExplorer();
    await flush();
    await waitForOsSubscription();
    pointAt(wrapper, "[data-explorer-row-path='/repo/src']");

    fireOsDrag({ type: "enter", paths: [], position: { x: 20, y: 20 } });
    await flush();
    const row = wrapper.find("[data-explorer-row-path='/repo/src']");
    expect(row.classes()).toContain("bg-accent");

    fireOsDrag({ type: "leave" });
    await flush();
    expect(
      wrapper.find("[data-explorer-row-path='/repo/src']").classes(),
    ).not.toContain("bg-accent");
  });

  it("drop 到文件行：不接收（不能把东西放进文件里）", async () => {
    const wrapper = mountExplorer();
    await flush();
    await waitForOsSubscription();
    pointAt(wrapper, "[data-explorer-row-path='/repo/README.md']");

    fireOsDrag({
      type: "drop",
      paths: ["/home/dev/pic.png"],
      position: { x: 20, y: 20 },
    });
    await flush();

    expect(mockWsNative.fsCopyMany).not.toHaveBeenCalled();
    expect(mockWsNative.fsMoveMany).not.toHaveBeenCalled();
  });

  it("drop 到树空白区 = 复制到工作区根", async () => {
    mockWsNative.fsCopyMany.mockResolvedValueOnce({
      completed: [{ from: "/home/dev/pic.png", to: "/repo/pic.png" }],
      skipped: [],
      failed: [],
      crossDevice: [],
      warnings: [],
    });
    const wrapper = mountExplorer();
    await flush();
    await waitForOsSubscription();
    pointAt(wrapper, "[data-explorer-drop-root]");

    fireOsDrag({
      type: "drop",
      paths: ["/home/dev/pic.png"],
      position: { x: 20, y: 400 },
    });
    await flush();

    expect(mockWsNative.fsCopyMany).toHaveBeenCalledWith(
      [{ from: "/home/dev/pic.png", to: "/repo/pic.png" }],
      "rename",
      1,
    );
  });

  it("拖到窗口外（命中不到树）时清空高亮", async () => {
    const wrapper = mountExplorer();
    await flush();
    await waitForOsSubscription();
    pointAt(wrapper, "[data-explorer-row-path='/repo/src']");
    fireOsDrag({ type: "enter", paths: [], position: { x: 20, y: 20 } });
    await flush();

    elementFromPointMock.mockReturnValue(null);
    fireOsDrag({ type: "over", position: { x: 900, y: 900 } });
    await flush();
    expect(
      wrapper.find("[data-explorer-row-path='/repo/src']").classes(),
    ).not.toContain("bg-accent");
  });

  it("组件卸载后退订，不再处理拖拽事件", async () => {
    const wrapper = mountExplorer();
    await flush();
    await waitForOsSubscription();
    expect(osDragHandlers.length).toBe(1);
    wrapper.unmount();
    expect(osDragHandlers.length).toBe(0);
  });

  it("OS 拖入的源在工作区外时，只刷新工作区内的目录", async () => {
    mockWsNative.fsCopyMany.mockResolvedValueOnce({
      completed: [{ from: "/home/dev/pic.png", to: "/repo/pic.png" }],
      skipped: [],
      failed: [],
      crossDevice: [],
      warnings: [],
    });
    const wrapper = mountExplorer();
    await flush();
    await waitForOsSubscription();
    const before = vi.mocked(readFileTreeDir).mock.calls.length;
    pointAt(wrapper, "[data-explorer-drop-root]");

    fireOsDrag({
      type: "drop",
      paths: ["/home/dev/pic.png"],
      position: { x: 20, y: 400 },
    });
    await flush();

    // 源目录 /home/dev 不在树内，不能因此发起读请求。
    // readFileTreeDir(wsNative, path)：第 2 个参数就是路径。
    const requested = vi
      .mocked(readFileTreeDir)
      .mock.calls.slice(before)
      .map((call) => String(call[1]));
    expect(requested.every((path) => path.startsWith("/repo"))).toBe(true);
  });
});

describe("FileExplorer filter + expand/collapse", () => {
  beforeEach(() => {
    resetExplorerMocks();
  });

  it("过滤只保留命中项与祖先链", async () => {
    const wrapper = mountExplorer();
    await flush();
    // 展开 src 让子项可见
    await wrapper.find("[data-explorer-row-path='/repo/src']").trigger("click");
    await flush();

    const input = wrapper.find("[data-tree-filter-input] input");
    await input.setValue("main");
    await flush();

    const rows = wrapper
      .findAll("[data-explorer-row-path]")
      .map((row) => row.attributes("data-explorer-row-path"));
    expect(rows).toEqual(["/repo/src", "/repo/src/main.ts"]);
  });

  it("清空过滤后恢复全部行", async () => {
    const wrapper = mountExplorer();
    await flush();
    const input = wrapper.find("[data-tree-filter-input] input");
    await input.setValue("zzz");
    await flush();
    expect(wrapper.findAll("[data-explorer-row-path]")).toHaveLength(0);

    await input.setValue("");
    await flush();
    expect(wrapper.findAll("[data-explorer-row-path]").length).toBeGreaterThan(0);
  });

  it("展开全部只铺开已加载的目录，不触发额外读请求", async () => {
    const wrapper = mountExplorer();
    await flush();
    const before = vi.mocked(readFileTreeDir).mock.calls.length;

    await wrapper.find("[data-collapse-all]").trigger("click");
    await flush();

    // src 是根的子目录且已加载（根已加载），所以 src 出现在行里；
    // 但它的子目录没有被请求。
    expect(
      wrapper.find("[data-explorer-row-path='/repo/src']").exists(),
    ).toBe(true);
    expect(vi.mocked(readFileTreeDir).mock.calls.length).toBe(before);
  });

  it("有展开项时按钮变为折叠全部，点击后收起", async () => {
    const wrapper = mountExplorer();
    await flush();
    await wrapper.find("[data-explorer-row-path='/repo/src']").trigger("click");
    await flush();
    expect(
      wrapper.find("[data-explorer-row-path='/repo/src/main.ts']").exists(),
    ).toBe(true);

    const toggle = wrapper.find("[data-collapse-all]");
    expect(toggle.attributes("data-collapse-all")).toBe("collapse");
    await toggle.trigger("click");
    await flush();

    expect(
      wrapper.find("[data-explorer-row-path='/repo/src/main.ts']").exists(),
    ).toBe(false);
    // 再点一次回到展开
    expect(
      wrapper.find("[data-collapse-all]").attributes("data-collapse-all"),
    ).toBe("expand");
    await wrapper.find("[data-collapse-all]").trigger("click");
    await flush();
    expect(
      wrapper.find("[data-explorer-row-path='/repo/src/main.ts']").exists(),
    ).toBe(true);
  });

  it("过滤状态下选择集与键盘导航只看可见行", async () => {
    const wrapper = mountExplorer();
    await flush();
    const input = wrapper.find("[data-tree-filter-input] input");
    await input.setValue("README");
    await flush();

    // 只剩 README.md 一行可见：Ctrl+A 只能选它
    const tree = wrapper.find("[data-file-explorer]");
    tree.element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true, cancelable: true }),
    );
    await flush();
    await input.setValue("");
    await flush();

    const selected = wrapper
      .findAll("[data-explorer-row-path]")
      .filter((row) => row.classes().includes("bg-accent"))
      .map((row) => row.attributes("data-explorer-row-path"));
    expect(selected).toEqual(["/repo/README.md"]);
  });
  it("剪切后待粘贴的行变淡，复制则不变", async () => {
    const wrapper = mountExplorer();
    await flush();
    const rowOf = (path: string) =>
      wrapper.find(`[data-explorer-row-path='${path}']`);

    await rowOf("/repo/README.md").trigger("click");
    await flush();
    pressKey(wrapper, "x");
    await flush();
    // 已剪切 → 变淡
    expect(rowOf("/repo/README.md").classes()).toContain("opacity-45");

    // 改成复制 → 不再是"待粘贴"
    pressKey(wrapper, "c");
    await flush();
    expect(rowOf("/repo/README.md").classes()).not.toContain("opacity-45");
  });

  it("粘贴（剪切）完成后剪贴板失效，行不再变淡", async () => {
    mockWsNative.fsMoveMany.mockResolvedValueOnce({
      completed: [{ from: "/repo/README.md", to: "/repo/src/README.md" }],
      skipped: [],
      failed: [],
      crossDevice: [],
      warnings: [],
    });
    const wrapper = mountExplorer();
    await flush();
    const rowOf = (path: string) =>
      wrapper.find(`[data-explorer-row-path='${path}']`);

    await rowOf("/repo/README.md").trigger("click");
    await flush();
    pressKey(wrapper, "x");
    await flush();
    expect(rowOf("/repo/README.md").classes()).toContain("opacity-45");

    // 粘到 src 目录
    await rowOf("/repo/src").trigger("click");
    await flush();
    pressKey(wrapper, "v");

    // 粘贴是 fire-and-forget 的异步链（planTransfer → fsMoveMany →
    // settleAfterTransfer → clipboard.clear），单次 flush 走不完。
    await vi.waitFor(() =>
      expect(rowOf("/repo/README.md").classes()).not.toContain("opacity-45"),
    );
    expect(mockWsNative.fsMoveMany).toHaveBeenCalledTimes(1);
  });
  it("搬运时展示进度条，进度事件驱动百分比", async () => {
    let release: (value: unknown) => void = () => undefined;
    mockWsNative.fsMoveMany.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }) as never,
    );
    const wrapper = mountExplorer();
    await flush();
    // 等 native 里的 onFsTransferProgress 订阅建立
    await vi.waitFor(() => expect(progressHandlers.length).toBeGreaterThan(0));

    void wrapper.vm.runTransfer(["/repo/README.md"], "/repo/src", "move");
    await flush();

    const bar = wrapper.find("[data-transfer-progress]");
    expect(bar.exists()).toBe(true);
    // 总条目数在开始时就已知，不必等后端的第一个进度事件
    expect(bar.text()).toContain("0 / 1");

    fireProgress({
      operationId: 1,
      done: 0,
      total: 1,
      current: "/repo/README.md",
      bytesDone: 5 * 1024 * 1024,
      bytesTotal: 10 * 1024 * 1024,
    });
    await nextTick();
    expect(wrapper.find("[data-transfer-progress]").text()).toContain("50%");
    expect(wrapper.find("[data-transfer-progress]").text()).toContain("MB");

    release({ completed: [], skipped: [], failed: [], crossDevice: [], warnings: [] });
    await vi.waitFor(() =>
      expect(wrapper.find("[data-transfer-progress]").exists()).toBe(false),
    );
  });

  it("忽略其它搬运的进度事件（operationId 分流）", async () => {
    let release: (value: unknown) => void = () => undefined;
    mockWsNative.fsMoveMany.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }) as never,
    );
    const wrapper = mountExplorer();
    await flush();
    await vi.waitFor(() => expect(progressHandlers.length).toBeGreaterThan(0));
    void wrapper.vm.runTransfer(["/repo/README.md"], "/repo/src", "move");
    await flush();

    // operationId 对不上 → 不应影响当前进度条
    fireProgress({
      operationId: 999,
      done: 9,
      total: 10,
      current: "/other",
      bytesDone: 0,
      bytesTotal: 0,
    });
    await nextTick();
    expect(wrapper.find("[data-transfer-progress]").text()).not.toContain("9 / 10");

    release({ completed: [], skipped: [], failed: [], crossDevice: [], warnings: [] });
    await flush();
  });

  it("点取消按钮调 fsCancelTransfer 并带上当前 operationId", async () => {
    let release: (value: unknown) => void = () => undefined;
    mockWsNative.fsMoveMany.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }) as never,
    );
    const wrapper = mountExplorer();
    await flush();
    await vi.waitFor(() => expect(progressHandlers.length).toBeGreaterThan(0));
    void wrapper.vm.runTransfer(["/repo/README.md"], "/repo/src", "move");
    await flush();

    await wrapper.find("[data-transfer-cancel]").trigger("click");
    expect(mockWsNative.fsCancelTransfer).toHaveBeenCalledWith(1);

    release({ completed: [], skipped: [], failed: [], crossDevice: [], warnings: [] });
    await flush();
  });

  it("搬运把 operationId 传给后端（没有它就没有进度与取消能力）", async () => {
    const wrapper = mountExplorer();
    await flush();
    await wrapper.vm.runTransfer(["/repo/src/main.ts"], "/repo", "move");
    await flush();
    expect(mockWsNative.fsMoveMany).toHaveBeenCalledWith(
      [{ from: "/repo/src/main.ts", to: "/repo/main.ts" }],
      "rename",
      1,
    );
  });
  it("目标目录未加载时提示一次（同名项由后端自动改名）", async () => {
    // 目标 /repo/lib 未展开过 → entryNamesOf 返回 null → 前端判不了冲突。
    // 用户不该误以为“覆盖/跳过”选项坏了，所以提示一次。
    const wrapper = mountExplorer();
    await flush();
    await wrapper.vm.runTransfer(["/repo/README.md"], "/repo/lib", "move");
    await flush();

    // 未弹冲突框（判不了）
    expect(document.body.querySelector("[data-transfer-conflict]")).toBeNull();
    // 搬运照常执行，后端按 rename 策略兼底
    expect(mockWsNative.fsMoveMany).toHaveBeenCalledTimes(1);
  });
});
