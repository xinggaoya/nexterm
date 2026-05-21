// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FileExplorer from "./FileExplorer.vue";
import { readFileTreeDir } from "./lib/fileTreeService";

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
  };
});

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
        ];
      }
      if (path === "/repo/src") {
        return [{ name: "main.ts", kind: "file", size: 100, mtime: 3 }];
      }
      return [];
    });
  });

  it("loads the root directory and opens files as preview tabs", async () => {
    const wrapper = mount(FileExplorer, {
      global: { plugins: [createPinia()] },
      props: { rootPath: "/repo" },
    });
    await flush();

    expect(readFileTreeDir).toHaveBeenCalledWith("/repo", false);
    expect(wrapper.text()).toContain("repo");
    expect(wrapper.text()).toContain("src");
    expect(wrapper.text()).toContain("README.md");

    await wrapper.find("[data-explorer-row-path='/repo/README.md']").trigger("click");

    expect(wrapper.emitted("openFile")).toEqual([["/repo/README.md", false]]);
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
  });

  it("renders an empty state without a root path", () => {
    const wrapper = mount(FileExplorer, {
      global: { plugins: [createPinia()] },
      props: { rootPath: null },
    });

    expect(wrapper.text()).toContain("No current directory");
  });
});
