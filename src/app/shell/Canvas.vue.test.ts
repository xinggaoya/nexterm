// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import type { Tab, TerminalTab } from "@/modules/tabs/tabsTypes";

// ── 重依赖子组件全部桩化,画布自身只负责分层与转发 ──────────────────────

vi.mock("@/modules/terminal", () => ({
  TerminalWorkspace: {
    name: "TerminalWorkspaceStub",
    props: ["tab", "isActive"],
    template: "<div class='terminal-workspace-stub' />",
  },
  getPtyIdForLeaf: vi.fn(() => null),
  disposeSession: vi.fn(),
}));

vi.mock("@/modules/preview/PreviewStack.vue", () => ({
  default: {
    name: "PreviewStackStub",
    props: ["tabs", "activeId"],
    template: "<div class='preview-stack-stub' />",
  },
}));
vi.mock("@/modules/markdown/MarkdownStack.vue", () => ({
  default: {
    name: "MarkdownStackStub",
    props: ["tabs", "activeId"],
    template: "<div class='markdown-stack-stub' />",
  },
}));
vi.mock("@/modules/file-preview/FilePreviewStack.vue", () => ({
  default: {
    name: "FilePreviewStackStub",
    props: ["tabs", "activeId"],
    template: "<div class='file-preview-stack-stub' />",
  },
}));
vi.mock("@/modules/editor/GitDiffStack.vue", () => ({
  default: {
    name: "GitDiffStackStub",
    props: ["tabs", "activeId"],
    template: "<div class='git-diff-stack-stub' />",
  },
}));
vi.mock("@/modules/git-history/GitHistoryStack.vue", () => ({
  default: {
    name: "GitHistoryStackStub",
    props: ["tabs", "activeId"],
    emits: ["open-commit-file", "change-ref"],
    template: "<div class='git-history-stack-stub' />",
  },
}));

import Canvas from "./Canvas.vue";

function terminalTab(id: number): TerminalTab {
  return {
    id,
    workspaceId: "w1",
    kind: "terminal",
    title: `sh-${id}`,
    paneTree: { kind: "leaf", id: `leaf-${id}` },
    activeLeafId: id,
    cwd: "/repo",
  } as unknown as TerminalTab;
}

function editorTab(id: number, path: string): Tab {
  return { id, workspaceId: "w1", kind: "editor", title: path, path, dirty: false, preview: false };
}

function mountCanvas(tabs: Tab[], activeId: number) {
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? null;
  return mount(Canvas, {
    props: {
      activeId,
      activeTab,
      tabs,
      tabsStore: {
        focusPane: vi.fn(),
        openCommitFileDiffTab: vi.fn(),
        setLeafCwd: vi.fn(),
        setLeafTitle: vi.fn(),
        updateTab: vi.fn(),
      },
      workspaceFsEvent: null,
    },
  });
}

describe("Canvas.vue", () => {
  it("每个终端 tab 渲染一个常驻 TerminalWorkspace 实例", () => {
    const wrapper = mountCanvas([terminalTab(1), terminalTab(2)], 1);
    const terminals = wrapper.findAllComponents({ name: "TerminalWorkspaceStub" });
    expect(terminals).toHaveLength(2);
    expect(terminals[0]?.props("isActive")).toBe(true);
    expect(terminals[1]?.props("isActive")).toBe(false);
  });

  it("活动 tab 是编辑器时:编辑器层可见,终端层隐藏(按层切换)", () => {
    const wrapper = mountCanvas([editorTab(1, "/repo/a.ts")], 1);
    // EditorPane 是 defineAsyncComponent(动态加载),这里断言层的切换:
    // 编辑器层可见、其余层隐藏,内容组件挂载由其自身模块测试覆盖。
    const editorLayer = wrapper.find('[data-tab-layer="editor"]');
    expect(editorLayer.exists()).toBe(true);
    expect(editorLayer.attributes("aria-hidden")).toBe("false");

    const terminalLayer = wrapper.find('[data-tab-layer="terminal"]');
    expect(terminalLayer.attributes("aria-hidden")).toBe("true");
  });

  it("git-history 的 change-ref 逐层上抛", async () => {
    const wrapper = mountCanvas([terminalTab(1)], 1);
    const history = wrapper.findComponent({ name: "GitHistoryStackStub" });
    const input = { tabId: 3, refName: "main", allRefs: false };
    await history.vm.$emit("change-ref", input);
    expect(wrapper.emitted("history-ref-change")).toEqual([[input]]);
  });
});
