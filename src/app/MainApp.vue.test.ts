// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { nextTick } from "vue";
import { describe, expect, it, vi } from "vitest";
import MainApp from "./MainApp.vue";
import { useTabsPiniaStore } from "@/modules/tabs/tabsPinia";

vi.mock("@/components/WindowControls.vue", () => ({
  default: { template: "<div data-window-controls />" },
}));

vi.mock("@/modules/terminal/TerminalStack.vue", () => ({
  default: {
    props: ["tabs", "activeId"],
    emits: ["focusLeaf", "cwd", "exit", "searchReady"],
    template: '<div data-terminal-stack>{{ tabs.length }}:{{ activeId }}</div>',
  },
}));

vi.mock("@/modules/explorer/FileExplorer.vue", () => ({
  default: {
    props: ["rootPath"],
    emits: ["openFile"],
    template:
      '<aside data-file-explorer>{{ rootPath ?? "none" }}<button data-open-file @click="$emit(\'openFile\', \'/repo/src/main.ts\', false)">open</button></aside>',
  },
}));

vi.mock("@/modules/source-control/SourceControlPanel.vue", () => ({
  default: {
    props: ["rootPath"],
    emits: ["openDiff", "openHistory"],
    template:
      '<aside data-source-control>{{ rootPath ?? "none" }}<button data-open-source-diff @click="$emit(\'openDiff\', { repoRoot: \'/repo\', path: \'src/main.ts\', mode: \'-\', originalPath: null, title: \'main.ts\' })">diff</button><button data-open-source-history @click="$emit(\'openHistory\', { repoRoot: \'/repo\', branch: \'main\' })">history</button></aside>',
  },
}));

vi.mock("@/modules/editor/EditorPane.vue", () => ({
  default: {
    props: ["path"],
    emits: ["dirtyChange"],
    template:
      '<section data-editor-pane>{{ path }}<button data-editor-dirty @click="$emit(\'dirtyChange\', true)">dirty</button></section>',
  },
}));

vi.mock("@/modules/preview/PreviewPane.vue", () => ({
  default: {
    props: ["url", "visible"],
    emits: ["urlChange"],
    template:
      '<section data-preview-pane>{{ url }}:{{ visible }}<button data-preview-url @click="$emit(\'urlChange\', \'http://localhost:5173\')">url</button></section>',
  },
}));

vi.mock("@/modules/markdown/MarkdownPreviewPane.vue", () => ({
  default: {
    props: ["path", "visible"],
    template: '<section data-markdown-pane>{{ path }}:{{ visible }}</section>',
  },
}));

vi.mock("@/modules/editor/GitDiffStack.vue", () => ({
  default: {
    props: ["tabs", "activeId"],
    template: '<section data-git-diff-stack>{{ activeId }}:{{ tabs.length }}</section>',
  },
}));

vi.mock("@/modules/editor/AiDiffStack.vue", () => ({
  default: {
    props: ["tabs", "activeId"],
    emits: ["accept", "reject"],
    template:
      '<section data-ai-diff-stack>{{ activeId }}:{{ tabs.length }}<button data-ai-accept @click="$emit(\'accept\', \'approval-1\')">accept</button><button data-ai-reject @click="$emit(\'reject\', \'approval-1\')">reject</button></section>',
  },
}));

vi.mock("@/modules/git-history/GitHistoryStack.vue", () => ({
  default: {
    props: ["tabs", "activeId"],
    emits: ["openCommitFile"],
    template:
      '<section data-git-history-stack>{{ activeId }}:{{ tabs.length }}<button data-history-open-file @click="$emit(\'openCommitFile\', { repoRoot: \'/repo\', sha: \'abcdef123456\', shortSha: \'abcdef1\', subject: \'Change\', path: \'src/main.ts\', originalPath: null })">open</button></section>',
  },
}));

vi.mock("./components/AppStatusBar.vue", () => ({
  default: {
    props: ["cwd", "privateActive"],
    template:
      '<footer data-status-bar>{{ cwd ?? "local workspace" }}:{{ privateActive }}</footer>',
  },
}));

describe("MainApp.vue", () => {
  it("renders the Vue workbench shell and handles terminal tab actions", async () => {
    const pinia = createPinia();
    const wrapper = mount(MainApp, {
      global: { plugins: [pinia] },
    });
    const tabs = useTabsPiniaStore();

    expect(wrapper.text()).toContain("Nexterm");
    expect(wrapper.find("[data-terminal-stack]").text()).toBe("1:1");

    await wrapper.find("[data-new-tab]").trigger("click");

    expect(tabs.tabs).toHaveLength(2);
    expect(wrapper.find("[data-terminal-stack]").text()).toBe("2:3");

    await wrapper.find("[data-new-private-tab]").trigger("click");

    expect(tabs.tabs).toHaveLength(3);
    expect(tabs.activeId).toBe(5);
    expect(tabs.tabs[2]).toMatchObject({
      id: 5,
      kind: "terminal",
      title: "private",
      private: true,
      activeLeafId: 6,
    });
    expect(wrapper.find("[data-status-bar]").text()).toBe("local workspace:true");

    await wrapper.find("[data-split-row]").trigger("click");

    expect(tabs.tabs[2]).toMatchObject({
      activeLeafId: 8,
      paneTree: {
        kind: "split",
        id: 7,
        dir: "row",
      },
    });

    await wrapper.find("[data-close-active-tab]").trigger("click");

    expect(tabs.tabs.map((tab) => tab.id)).toEqual([1, 3]);
    expect(tabs.activeId).toBe(3);
  });

  it("renders the Vue file explorer and opens files into editor tabs", async () => {
    const pinia = createPinia();
    const wrapper = mount(MainApp, {
      global: { plugins: [pinia] },
    });
    const tabs = useTabsPiniaStore();

    tabs.setLeafCwd(2, "/repo");
    await nextTick();

    expect(wrapper.find("[data-file-explorer]").text()).toContain("/repo");

    await wrapper.find("[data-open-file]").trigger("click");

    expect(tabs.activeId).toBe(3);
    expect(tabs.tabs[1]).toMatchObject({
      id: 3,
      kind: "editor",
      title: "main.ts",
      path: "/repo/src/main.ts",
      preview: true,
    });
    expect(wrapper.find("[data-editor-pane]").text()).toContain("/repo/src/main.ts");

    await wrapper.find("[data-editor-dirty]").trigger("click");

    expect(tabs.tabs[1]).toMatchObject({
      kind: "editor",
      dirty: true,
      preview: false,
    });
  });

  it("renders migrated preview and markdown tabs", async () => {
    const pinia = createPinia();
    const wrapper = mount(MainApp, {
      global: { plugins: [pinia] },
    });
    const tabs = useTabsPiniaStore();

    const previewId = tabs.newPreviewTab("https://example.com/docs");
    await nextTick();

    expect(tabs.activeId).toBe(previewId);
    expect(wrapper.find("[data-preview-pane]").text()).toContain(
      "https://example.com/docs:true",
    );

    await wrapper.find("[data-preview-url]").trigger("click");

    expect(tabs.tabs.find((tab) => tab.id === previewId)).toMatchObject({
      kind: "preview",
      url: "http://localhost:5173",
      title: "localhost:5173",
    });

    const markdownId = tabs.newMarkdownTab("/repo/README.md");
    await nextTick();

    expect(tabs.activeId).toBe(markdownId);
    expect(wrapper.find("[data-markdown-pane]").text()).toContain(
      "/repo/README.md:true",
    );
  });

  it("renders migrated diff tabs", async () => {
    const pinia = createPinia();
    const wrapper = mount(MainApp, {
      global: { plugins: [pinia] },
    });
    const tabs = useTabsPiniaStore();

    tabs.tabs.push({
      id: 3,
      kind: "git-diff",
      title: "main.ts",
      repoRoot: "/repo",
      path: "src/main.ts",
      mode: "+",
      originalPath: null,
    });
    tabs.setActiveId(3);
    await nextTick();

    expect(wrapper.find("[data-git-diff-stack]").text()).toContain("3:2");

    tabs.tabs.push({
      id: 4,
      kind: "ai-diff",
      title: "AI diff",
      path: "src/agent.ts",
      originalContent: "old",
      proposedContent: "new",
      approvalId: "approval-1",
      status: "pending",
      isNewFile: false,
    });
    tabs.setActiveId(4);
    await nextTick();

    expect(wrapper.find("[data-ai-diff-stack]").text()).toContain("4:3");
    await wrapper.find("[data-ai-accept]").trigger("click");

    expect(tabs.tabs.find((tab) => tab.id === 4)).toMatchObject({
      kind: "ai-diff",
      status: "approved",
    });
  });

  it("renders migrated git history tabs and opens commit file diffs", async () => {
    const pinia = createPinia();
    const wrapper = mount(MainApp, {
      global: { plugins: [pinia] },
    });
    const tabs = useTabsPiniaStore();

    const historyId = tabs.openCommitHistoryTab({ repoRoot: "/repo", branch: "main" });
    await nextTick();

    expect(wrapper.find("[data-git-history-stack]").text()).toContain(
      `${historyId}:2`,
    );

    await wrapper.find("[data-history-open-file]").trigger("click");

    expect(tabs.tabs.find((tab) => tab.kind === "git-commit-file")).toMatchObject({
      kind: "git-commit-file",
      title: "main.ts @ abcdef1",
      repoRoot: "/repo",
      sha: "abcdef123456",
      path: "src/main.ts",
    });
  });

  it("switches the sidebar to source control and opens git tabs", async () => {
    const pinia = createPinia();
    const wrapper = mount(MainApp, {
      global: { plugins: [pinia] },
    });
    const tabs = useTabsPiniaStore();

    tabs.setLeafCwd(2, "/repo");
    await nextTick();
    await wrapper.find("[data-sidebar-source]").trigger("click");

    expect(wrapper.find("[data-source-control]").text()).toContain("/repo");

    await wrapper.find("[data-open-source-diff]").trigger("click");
    expect(tabs.tabs.find((tab) => tab.kind === "git-diff")).toMatchObject({
      kind: "git-diff",
      repoRoot: "/repo",
      path: "src/main.ts",
      mode: "-",
    });

    await wrapper.find("[data-open-source-history]").trigger("click");
    expect(tabs.tabs.find((tab) => tab.kind === "git-history")).toMatchObject({
      kind: "git-history",
      repoRoot: "/repo",
    });
  });
});
