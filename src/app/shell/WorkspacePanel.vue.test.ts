// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type { GitDecorationMap } from "@/modules/source-control";

vi.mock("@/modules/explorer/FileExplorer.vue", () => ({
  default: {
    name: "FileExplorerStub",
    props: ["rootPath", "fsEvent", "gitDecorations"],
    emits: ["open-file", "open-markdown-preview", "open-in-terminal", "open-search-result"],
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
      gitBranch: "main",
      showBranchesModal: ref(false),
      fsEvent: null,
      ...props,
    },
  });
}

describe("WorkspacePanel.vue", () => {
  it("渲染两个标签,活动标签 aria-pressed,头部显示分支徽标", async () => {
    const wrapper = mountPanel();

    const tabButtons = wrapper.findAll("[data-panel-tab]");
    expect(tabButtons.map((b) => b.attributes("data-panel-tab"))).toEqual([
      "explorer",
      "changes",
    ]);
    expect(tabButtons[0]?.attributes("aria-pressed")).toBe("true");
    expect(wrapper.find("[data-panel-branch]").text()).toContain("main");

    await tabButtons[1]!.trigger("click");
    expect(wrapper.emitted("update:tab")).toEqual([["changes"]]);
  });

  it("文件树标签层接收根路径并转发 open-file", async () => {
    const wrapper = mountPanel({ tab: "explorer" });

    const explorer = wrapper.findComponent({ name: "FileExplorerStub" });
    expect(explorer.props("rootPath")).toBe("/repo");

    await explorer.vm.$emit("open-file", "/repo/a.ts", false);
    expect(wrapper.emitted("open-file")).toEqual([["/repo/a.ts", false]]);
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
