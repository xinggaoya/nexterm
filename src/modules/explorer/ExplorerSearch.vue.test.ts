// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia } from "pinia";

import type { WorkspaceNative } from "@/lib/native";
import type { SearchHit, SearchResult } from "./lib/fileTreeService";

const searchFileTree = vi.fn();

vi.mock("@/app/workspaceContext", () => ({
  useWorkspaceContext: () => ({
    workspace: {
      id: "local:/repo",
      rootPath: "/repo",
      env: { kind: "local" },
      name: "repo",
      openedAt: 0,
    },
    wsNative: {} as WorkspaceNative,
  }),
}));

vi.mock("./lib/fileTreeService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/fileTreeService")>();
  return {
    ...actual,
    searchFileTree: (...args: unknown[]) => searchFileTree(...args),
  };
});

vi.mock("./lib/iconResolver", () => ({
  fileIconUrl: vi.fn(() => "file-icon.png"),
  folderIconUrl: vi.fn(() => "folder-icon.png"),
}));

import ExplorerSearch from "./ExplorerSearch.vue";

const DEBOUNCE_MS = 200;

function hit(name: string, rel = name): SearchHit {
  return { path: `/repo/${rel}`, rel, name, is_dir: false };
}

function mountSearch() {
  return mount(ExplorerSearch, {
    props: { rootPath: "/repo", open: true },
    global: { plugins: [createPinia()] },
  });
}

/** 输入查询词并推进防抖计时,返回时 mock 已被调用。 */
async function query(
  wrapper: ReturnType<typeof mountSearch>,
  text: string,
): Promise<void> {
  await wrapper.find("[data-explorer-search-input]").setValue(text);
  vi.advanceTimersByTime(DEBOUNCE_MS + 1);
  await flushPromises();
}

beforeEach(() => {
  vi.useFakeTimers();
  searchFileTree.mockReset();
  searchFileTree.mockResolvedValue({ hits: [], truncated: false });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ExplorerSearch.vue", () => {
  it("单字符即可触发搜索", async () => {
    const wrapper = mountSearch();
    await query(wrapper, "a");
    expect(searchFileTree).toHaveBeenCalledTimes(1);
  });

  it("显示结果计数,命中名高亮匹配片段", async () => {
    searchFileTree.mockResolvedValue({
      hits: [hit("AGENTS.md"), hit("agents-notes.md", "docs/agents-notes.md")],
      truncated: false,
    } satisfies SearchResult);
    const wrapper = mountSearch();
    await query(wrapper, "AGEN");

    expect(wrapper.text()).toContain("2");
    const marks = wrapper.findAll("mark");
    expect(marks).toHaveLength(2);
    expect(marks[0]!.text()).toBe("AGEN");
  });

  it("点击文件结果发出 openFile,目录命中不触发", async () => {
    searchFileTree.mockResolvedValue({
      hits: [
        { ...hit("src"), is_dir: true },
        hit("a.ts"),
      ],
      truncated: false,
    } satisfies SearchResult);
    const wrapper = mountSearch();
    await query(wrapper, "a");

    const results = wrapper.findAll("[data-search-result]");
    await results[0]!.trigger("click");
    expect(wrapper.emitted("openFile")).toBeUndefined();

    await results[1]!.trigger("click");
    expect(wrapper.emitted("openFile")).toEqual([["/repo/a.ts", false]]);
  });
});
