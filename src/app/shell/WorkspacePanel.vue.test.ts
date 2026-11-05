// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type { GitDecorationMap } from "@/modules/source-control";

vi.mock("@/modules/explorer/FileExplorer.vue", () => ({
  default: {
    name: "FileExplorerStub",
    props: ["rootPath", "fsEvent", "gitDecorations"],
    emits: [
      "open-file",
      "open-file-preview",
      "open-markdown-preview",
      "open-in-terminal",
      "open-search-result",
      "path-renamed",
      "path-deleted",
    ],
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

import WorkspacePanel from "./WorkspacePanel.vue";

function mountPanel(props: Partial<InstanceType<typeof WorkspacePanel>["$props"]> = {}) {
  return mount(WorkspacePanel, {
    props: {
      tab: "explorer",
      width: 300,
      workspaceId: "w1",
      workspaceRoot: "/repo",
      workspaceScope: "local",
      activeRepoRoot: null,
      gitDecorations: new Map() as GitDecorationMap,
      showBranchesModal: ref(false),
      fsEvent: null,
      ...props,
    },
  });
}

describe("WorkspacePanel.vue", () => {
  // v3.2 壳层重设计：面板头部（文件树/更改 标签组 + 分支徽标）已并入顶栏。
  // 面板本体只��内容，不再有任何头部 —— 右侧区域只剩一条 44px chrome 带。
  it("不再有独立头部:标签组与分支徽标都不在面板里", () => {
    const wrapper = mountPanel();

    expect(wrapper.findAll("[data-panel-tab]")).toHaveLength(0);
    expect(wrapper.find("[data-panel-branch]").exists()).toBe(false);
    // 面板根容器与右缘停靠位置保持不变。
    expect(wrapper.find("[data-workspace-panel]").exists()).toBe(true);
    expect(wrapper.find("[data-workspace-panel-right]").exists()).toBe(true);
  });

  it("内容层按 tab 切换:explorer 与 changes 互斥显示", () => {
    const explorerPanel = mountPanel({ tab: "explorer" });
    expect(explorerPanel.find("[data-panel-tab-explorer]").isVisible()).toBe(true);
    expect(explorerPanel.find("[data-panel-tab-changes]").isVisible()).toBe(false);

    const changesPanel = mountPanel({ tab: "changes" });
    expect(changesPanel.find("[data-panel-tab-explorer]").isVisible()).toBe(false);
    expect(changesPanel.find("[data-panel-tab-changes]").isVisible()).toBe(true);
  });

  it("文件树标签层接收根路径并转发 open-file", async () => {
    const wrapper = mountPanel({ tab: "explorer" });

    const explorer = wrapper.findComponent({ name: "FileExplorerStub" });
    expect(explorer.props("rootPath")).toBe("/repo");

    await explorer.vm.$emit("open-file", "/repo/a.ts", false);
    expect(wrapper.emitted("open-file")).toEqual([["/repo/a.ts", false]]);
  });

  // 回归：这三类事件曾经只声明不转发，导致重命名后编辑器标签指向失效路径、
  // 图片预览从文件树完全打不开。
  it("转发 open-file-preview / path-renamed / path-deleted", async () => {
    const wrapper = mountPanel({ tab: "explorer" });
    const explorer = wrapper.findComponent({ name: "FileExplorerStub" });

    await explorer.vm.$emit("open-file-preview", "/repo/logo.png");
    await explorer.vm.$emit("path-renamed", "/repo/a.ts", "/repo/b.ts");
    await explorer.vm.$emit("path-deleted", "/repo/c.ts");

    expect(wrapper.emitted("open-file-preview")).toEqual([["/repo/logo.png"]]);
    expect(wrapper.emitted("path-renamed")).toEqual([
      ["/repo/a.ts", "/repo/b.ts"],
    ]);
    expect(wrapper.emitted("path-deleted")).toEqual([["/repo/c.ts"]]);
  });

  it("更改标签的 branch-change / decorations-change 逐层上抛", async () => {
    const wrapper = mountPanel({ tab: "changes" });
    const panel = wrapper.findComponent({ name: "SourceControlPanelStub" });
    expect(panel.props("workspaceId")).toBe("w1");

    await panel.vm.$emit("branch-change", "dev");
    expect(wrapper.emitted("branch-change")).toEqual([["dev"]]);

    const decorations = new Map() as GitDecorationMap;
    await panel.vm.$emit("decorations-change", decorations);
    expect(wrapper.emitted("decorations-change")).toEqual([[decorations]]);
  });

  it("拖拽左缘手柄调宽:向左拖加宽并发出 resize-width", async () => {
    const wrapper = mountPanel({ width: 300 });

    wrapper.find("[data-panel-resizer]").element.dispatchEvent(
      new MouseEvent("pointerdown", { clientX: 300, button: 0, bubbles: true }),
    );
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 240, bubbles: true }));
    window.dispatchEvent(new MouseEvent("pointerup", { clientX: 240, bubbles: true }));

    expect(wrapper.emitted("resize-width")).toEqual([[360]]);
    wrapper.unmount();
  });
});
