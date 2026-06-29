// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { nextTick } from "vue";
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

async function flush() {
  await Promise.resolve();
  await nextTick();
}

describe("FileExplorer.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readFileTreeDir).mockImplementation(async (path) => {
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

    expect(readFileTreeDir).toHaveBeenCalledWith("/repo", false);
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
    const wrapper = mount(FileExplorer, {
      global: { plugins: [createPinia()] },
      props: {
        rootPath: "/repo",
        gitChangedFiles: [
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
        ],
      },
    });
    await flush();

    expect(
      wrapper
        .find("[data-explorer-row-path='/repo/src'] [data-explorer-git-tone]")
        .attributes("data-explorer-git-tone"),
    ).toBe("modified");

    await wrapper.find("[data-explorer-row-path='/repo/src']").trigger("click");
    await flush();

    expect(
      wrapper
        .find(
          "[data-explorer-row-path='/repo/src/main.ts'] [data-explorer-git-tone]",
        )
        .attributes("data-explorer-git-tone"),
    ).toBe("modified");
  });

  it("expands folders and renders loaded children", async () => {
    const wrapper = mount(FileExplorer, {
      global: { plugins: [createPinia()] },
      props: { rootPath: "/repo" },
    });
    await flush();

    await wrapper.find("[data-explorer-row-path='/repo/src']").trigger("click");
    await flush();

    expect(readFileTreeDir).toHaveBeenCalledWith("/repo/src", false);
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

    expect(createFileTreeEntry).toHaveBeenCalledWith("/repo/notes.md", "file");
    expect(readFileTreeDir).toHaveBeenLastCalledWith("/repo", false);
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

    expect(deleteFileTreePath).toHaveBeenCalledWith("/repo/README.md");
    expect(wrapper.emitted("pathDeleted")).toEqual([["/repo/README.md"]]);
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

    expect(searchFileTree).toHaveBeenCalledWith("/repo", "main", false);
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

    expect(readFileTreeDir).toHaveBeenCalledWith("/repo/src", false);
    const openFileEvents = wrapper.emitted("openFile") ?? [];
    expect(openFileEvents[openFileEvents.length - 1]).toEqual([
      "/repo/src/main.ts",
      false,
    ]);
    wrapper.unmount();
  });

  it("refreshes only the affected loaded directory for batched fs events", async () => {
    vi.useFakeTimers();
    vi.mocked(readFileTreeDir).mockImplementation(async (path) => {
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
    expect(readFileTreeDir).toHaveBeenCalledWith("/repo/src", false);
    vi.useRealTimers();
  });

  it("keeps loaded rows visible while auto-refreshing an expanded directory", async () => {
    vi.useFakeTimers();
    let srcReads = 0;
    const deferredRefresh: { resolve?: (entries: DirEntry[]) => void } = {};
    vi.mocked(readFileTreeDir).mockImplementation((path) => {
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

  it("coalesces repeated fs refreshes while a directory read is in flight", async () => {
    vi.useFakeTimers();
    let srcReads = 0;
    const pendingRefreshes: Array<(entries: DirEntry[]) => void> = [];
    vi.mocked(readFileTreeDir).mockImplementation((path) => {
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
});
