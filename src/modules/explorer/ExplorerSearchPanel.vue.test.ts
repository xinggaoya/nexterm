// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { createPinia } from "pinia";

import type { WorkspaceNative } from "@/lib/native";

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
  return { ...actual, searchFileTree: vi.fn().mockResolvedValue({ hits: [], truncated: false }) };
});

vi.mock("@/modules/search/lib/findInFilesService", () => ({
  runFindInFiles: vi.fn().mockResolvedValue({ hits: [], truncated: false, filesScanned: 0 }),
}));

import ExplorerSearchPanel from "./ExplorerSearchPanel.vue";
import type { ExplorerSearchMode } from "./explorerTypes";

function mountPanel(props: { mode?: ExplorerSearchMode; filter?: string } = {}) {
  return mount(ExplorerSearchPanel, {
    props: { rootPath: "/repo", mode: "files", filter: "", ...props },
    global: { plugins: [createPinia()] },
  });
}

describe("ExplorerSearchPanel.vue", () => {
  it("三个分段各自渲染对应面板", async () => {
    const wrapper = mountPanel();

    expect(wrapper.find("[data-explorer-search-input]").exists()).toBe(true);
    expect(wrapper.find("[data-tree-filter-input]").exists()).toBe(false);

    // mode 是受控 prop：先点分段看事件，再把父级的回写灌回来验证渲染。
    await wrapper.find("[data-search-mode='content']").trigger("click");
    expect(wrapper.emitted("update:mode")).toEqual([["content"]]);
    await wrapper.setProps({ mode: "content" });
    expect(wrapper.find("[data-find-in-files]").exists()).toBe(true);

    await wrapper.find("[data-search-mode='filter']").trigger("click");
    expect(wrapper.emitted("update:mode")![1]).toEqual(["filter"]);
    await wrapper.setProps({ mode: "filter" });
    expect(wrapper.find("[data-tree-filter-input]").exists()).toBe(true);
  });

  it("过滤段只占一行（不抢整块区域），其余段吃掉剩余高度", async () => {
    // 过滤段在下方还要显示文件树，所以面板必须 shrink-0；
    // files / content 段出结果列表，必须 flex-1。
    expect(mountPanel({ mode: "filter" }).classes()).toContain("shrink-0");
    expect(mountPanel({ mode: "files" }).classes()).toContain("flex-1");
    expect(mountPanel({ mode: "content" }).classes()).toContain("flex-1");
  });

  it("过滤输入框回写 update:filter，清空按钮置空", async () => {
    const wrapper = mountPanel({ mode: "filter", filter: "main" });

    await wrapper.find("[data-tree-filter-input]").setValue("readme");
    expect(wrapper.emitted("update:filter")![0]).toEqual(["readme"]);

    await wrapper.find("[data-clear-tree-filter]").trigger("click");
    expect(wrapper.emitted("update:filter")![1]).toEqual([""]);
  });

  it("过滤段 Esc：先清空内容，再按才请求关闭", async () => {
    const wrapper = mountPanel({ mode: "filter", filter: "main" });

    await wrapper.find("[data-tree-filter-input]").trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("update:filter")).toEqual([[""]]);
    expect(wrapper.emitted("requestClose")).toBeUndefined();

    // 父级把 filter 清空后再按，才升级为关闭
    await wrapper.setProps({ filter: "" });
    await wrapper.find("[data-tree-filter-input]").trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("requestClose")?.length).toBe(1);
  });

  it("关闭按钮请求 requestClose", async () => {
    const wrapper = mountPanel();
    await wrapper.find("[data-search-close]").trigger("click");
    expect(wrapper.emitted("requestClose")?.length).toBe(1);
  });
});
