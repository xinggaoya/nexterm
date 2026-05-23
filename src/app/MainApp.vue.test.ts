// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { NConfigProvider } from "naive-ui";
import { createPinia } from "pinia";
import { nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MainApp from "./MainApp.vue";
import { i18n, setI18nLanguage } from "@/modules/i18n";
import { applyTerminalSessionTheme } from "@/modules/terminal";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import { useTabsPiniaStore } from "@/modules/tabs/tabsPinia";
import {
  currentWorkspaceEnv,
  LOCAL_WORKSPACE,
  useWorkspaceEnvPiniaStore,
  useWorkspaceRootPiniaStore,
} from "@/modules/workspace";
import { setCurrentWorkspaceEnv } from "@/modules/workspace/workspaceEnvSnapshot";

const invokeMock = vi.hoisted(() =>
  vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command === "wsl_home") return "/home/dev";
    if (command === "workspace_authorize") return args?.path ?? null;
    return null;
  }),
);
const eventListenMock = vi.hoisted(() => {
  const handlers: Array<(event: { payload: unknown }) => void> = [];
  const listen = vi.fn(
    async (_event: string, handler: (event: { payload: unknown }) => void) => {
      handlers.push(handler);
      return vi.fn();
    },
  );
  return Object.assign(listen, { handlers });
});
const windowMock = vi.hoisted(() => {
  const closeRequestedHandlers: ((event: { preventDefault: () => void }) => void | Promise<void>)[] = [];
  return {
    closeRequestedHandlers,
    currentWindow: {
      close: vi.fn(async () => {}),
      onCloseRequested: vi.fn(async (handler) => {
        closeRequestedHandlers.push(handler);
        return vi.fn();
      }),
      startDragging: vi.fn(async () => {}),
    },
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  Channel: class {
    onmessage: unknown;
  },
}));

vi.mock("@tauri-apps/api/path", () => ({
  homeDir: vi.fn(async () => "C:\\Users\\dev"),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: eventListenMock,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => windowMock.currentWindow,
}));

vi.mock("@/components/WindowControls.vue", () => ({
  default: { template: "<div data-window-controls />" },
}));

vi.mock("@/modules/terminal/TerminalStack.vue", () => ({
  default: {
    props: ["tabs", "activeId"],
    emits: ["focusLeaf", "cwd", "title", "exit", "searchReady"],
    template:
      '<div data-terminal-stack>{{ tabs.length }}:{{ activeId }}<button data-terminal-cd @click="$emit(\'cwd\', 2, \'/tmp\')"></button><button data-terminal-title @click="$emit(\'title\', 2, \'OpenAI Codex\')"></button></div>',
  },
}));

vi.mock("@/modules/terminal", () => ({
  applyTerminalSessionTheme: vi.fn(),
}));

vi.mock("@/modules/explorer/FileExplorer.vue", () => ({
  default: {
    props: ["rootPath", "fsEvent"],
    emits: ["openFile"],
    template:
      '<aside data-file-explorer>{{ rootPath ?? "none" }}<span data-explorer-fs-event>{{ fsEvent?.paths?.join("|") ?? "none" }}</span><button data-open-file @click="$emit(\'openFile\', \'/repo/src/main.ts\', false)">open</button><button data-open-other-file @click="$emit(\'openFile\', \'/repo/src/other.ts\', false)">other</button></aside>',
  },
}));

vi.mock("@/modules/source-control/SourceControlPanel.vue", () => ({
  default: {
    props: ["rootPath", "fsEvent"],
    emits: ["openDiff", "openHistory"],
    template:
      '<aside data-source-control>{{ rootPath ?? "none" }}<span data-source-fs-event>{{ fsEvent?.paths?.join("|") ?? "none" }}</span><button data-open-source-diff @click="$emit(\'openDiff\', { repoRoot: \'/repo\', path: \'src/main.ts\', mode: \'-\', originalPath: null, title: \'main.ts\' })">diff</button><button data-open-source-history @click="$emit(\'openHistory\', { repoRoot: \'/repo\', branch: \'main\' })">history</button></aside>',
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
    props: ["workspaceRoot", "terminalCwd"],
    emits: ["workspaceChange"],
    template:
      '<footer data-status-bar><span>{{ workspaceRoot ?? "No workspace" }}:{{ terminalCwd ?? "no-terminal" }}</span><button data-switch-wsl @click="$emit(\'workspaceChange\', { kind: \'wsl\', distro: \'Ubuntu\' })"></button><button data-switch-local @click="$emit(\'workspaceChange\', { kind: \'local\' })"></button></footer>',
  },
}));

vi.mock("./components/WorkspaceWelcome.vue", () => ({
  default: {
    props: ["recentWorkspaces", "loading", "error"],
    emits: ["chooseWorkspace", "openRecent", "workspaceEnvChange"],
    template:
      '<section data-workspace-welcome><span>{{ error ?? "welcome" }}</span><button data-welcome-open @click="$emit(\'chooseWorkspace\')">open</button><button v-if="recentWorkspaces.length" data-open-recent @click="$emit(\'openRecent\', recentWorkspaces[0])">recent</button><button data-welcome-wsl @click="$emit(\'workspaceEnvChange\', { kind: \'wsl\', distro: \'Ubuntu\' })">wsl</button></section>',
  },
}));

function wrapperCleanup(host: HTMLElement) {
  document.body
    .querySelectorAll("[data-settings-panel]")
    .forEach((node) => node.remove());
  document.body
    .querySelectorAll(".n-dialog-container, .n-modal-container")
    .forEach((node) => node.remove());
  host.remove();
}

describe("MainApp.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    windowMock.closeRequestedHandlers.length = 0;
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
    eventListenMock.handlers.length = 0;
    document.body.innerHTML = "";
    setI18nLanguage("en-US");
    setCurrentWorkspaceEnv({ kind: "local" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the workspace welcome screen before a workspace is opened", () => {
    const pinia = createPinia();

    const wrapper = mount(MainApp, {
      global: { plugins: [pinia, i18n] },
    });
    const tabs = useTabsPiniaStore();

    expect(wrapper.find("[data-workspace-welcome]").exists()).toBe(true);
    expect(wrapper.find("[data-file-explorer]").exists()).toBe(false);
    expect(tabs.tabs).toHaveLength(0);
  });

  it("opens a workspace from the promoted header action", async () => {
    const pinia = createPinia();
    const workspaceRoot = useWorkspaceRootPiniaStore(pinia);
    workspaceRoot.chooseWorkspace = vi.fn(async () => {
      workspaceRoot.rootPath = "/repo";
      return { path: "/repo", env: LOCAL_WORKSPACE, openedAt: 1 };
    });

    const wrapper = mount(MainApp, {
      global: { plugins: [pinia, i18n] },
    });

    await wrapper.find("[data-open-workspace]").trigger("click");
    await flushPromises();
    await nextTick();

    expect(workspaceRoot.chooseWorkspace).toHaveBeenCalledTimes(1);
    expect(wrapper.find("[data-terminal-stack]").text()).toBe("1:1");
  });

  it("keeps preinitialized workspace root available on first render", async () => {
    const pinia = createPinia();
    const workspaceRoot = useWorkspaceRootPiniaStore(pinia);
    workspaceRoot.rootPath = "/repo";

    const wrapper = mount(MainApp, {
      global: { plugins: [pinia, i18n] },
    });
    const tabs = useTabsPiniaStore();
    await nextTick();

    expect(wrapper.find("[data-file-explorer]").text()).toContain("/repo");
    expect(tabs.tabs[0]).toMatchObject({
      kind: "terminal",
      cwd: "/repo",
      paneTree: { kind: "leaf", id: 2, cwd: "/repo" },
    });
  });

  it("refreshes terminal themes after syncing app theme tokens", async () => {
    const originalRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    }) as typeof window.requestAnimationFrame;

    try {
      mount(MainApp, {
        global: { plugins: [createPinia(), i18n] },
      });
      await nextTick();

      expect(applyTerminalSessionTheme).toHaveBeenCalled();
    } finally {
      window.requestAnimationFrame = originalRaf;
    }
  });

  it("passes the resolved app locale into Naive UI providers", async () => {
    const pinia = createPinia();
    const prefs = usePreferencesPiniaStore(pinia);
    prefs.language = "zh-CN";

    const wrapper = mount(MainApp, {
      global: { plugins: [pinia, i18n] },
    });
    await flushPromises();
    await nextTick();

    const provider = wrapper.findComponent(NConfigProvider);
    expect(provider.props("locale")?.name).toBe("zh-CN");
    expect(provider.props("dateLocale")?.name).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
  });

  it("opens a workspace from the welcome screen and handles terminal tab actions", async () => {
    const pinia = createPinia();
    const workspaceRoot = useWorkspaceRootPiniaStore(pinia);
    workspaceRoot.openWorkspace = vi.fn(async (path: string) => {
      workspaceRoot.rootPath = path;
      return { path, env: LOCAL_WORKSPACE, openedAt: 1 };
    });
    workspaceRoot.chooseWorkspace = vi.fn(async () => {
      workspaceRoot.rootPath = "/repo";
      return { path: "/repo", env: LOCAL_WORKSPACE, openedAt: 1 };
    });
    const wrapper = mount(MainApp, {
      global: { plugins: [pinia, i18n] },
    });
    const tabs = useTabsPiniaStore();

    await wrapper.find("[data-welcome-open]").trigger("click");
    await flushPromises();
    await nextTick();

    expect(wrapper.find("[data-terminal-stack]").text()).toBe("1:1");

    await wrapper.find("[data-new-tab]").trigger("click");

    expect(tabs.tabs).toHaveLength(2);
    expect(wrapper.find("[data-terminal-stack]").text()).toContain("2:3");
    expect(wrapper.find("[data-new-private-tab]").exists()).toBe(false);

    await wrapper.find("[data-split-row]").trigger("click");

    expect(tabs.tabs[1]).toMatchObject({
      id: 3,
      kind: "terminal",
      activeLeafId: 6,
      paneTree: {
        kind: "split",
        id: 5,
        dir: "row",
      },
    });
    expect(wrapper.find("[data-status-bar]").text()).toContain("/repo:/repo");

    expect(wrapper.find("[data-close-active-tab]").exists()).toBe(false);

    await wrapper.find("[data-close-tab-id='3']").trigger("click");

    expect(tabs.tabs.map((tab) => tab.id)).toEqual([1]);
    expect(tabs.activeId).toBe(1);
  });

  it("opens settings inside the main window without invoking a Tauri settings window", async () => {
    const pinia = createPinia();
    const workspaceRoot = useWorkspaceRootPiniaStore(pinia);
    workspaceRoot.rootPath = "/repo";
    const host = document.createElement("div");
    document.body.appendChild(host);

    try {
      const wrapper = mount(MainApp, {
        attachTo: host,
        global: { plugins: [pinia, i18n] },
      });
      await nextTick();

      expect(document.body.querySelector("[data-settings-panel]")).toBeNull();

      await wrapper.find("[data-open-settings]").trigger("click");
      await nextTick();
      await flushPromises();

      expect(invokeMock).not.toHaveBeenCalled();
      expect(document.body.querySelector("[data-settings-panel]")).not.toBeNull();
      expect(document.body.querySelector("[data-settings-tab='general']")).not.toBeNull();
    } finally {
      document.body.removeChild(host);
      document.body
        .querySelectorAll("[data-settings-panel]")
        .forEach((node) => node.remove());
    }
  });

  it("updates terminal tab titles from terminal title events", async () => {
    const pinia = createPinia();
    const workspaceRoot = useWorkspaceRootPiniaStore(pinia);
    workspaceRoot.rootPath = "/repo";
    const wrapper = mount(MainApp, {
      global: { plugins: [pinia, i18n] },
    });
    const tabs = useTabsPiniaStore();

    await wrapper.find("[data-terminal-title]").trigger("click");

    expect(tabs.tabs[0]).toMatchObject({
      kind: "terminal",
      terminalTitle: "OpenAI Codex",
      paneTree: { kind: "leaf", id: 2, terminalTitle: "OpenAI Codex" },
    });
  });

  it("switches to a WSL workspace and resets terminal tabs to the WSL home", async () => {
    const pinia = createPinia();
    const workspaceRoot = useWorkspaceRootPiniaStore(pinia);
    workspaceRoot.rootPath = "D:/repo";
    const wrapper = mount(MainApp, {
      global: { plugins: [pinia, i18n] },
    });
    const tabs = useTabsPiniaStore();

    tabs.newTab("D:/other");
    await nextTick();

    await wrapper.find("[data-switch-wsl]").trigger("click");
    await flushPromises();
    await nextTick();

    expect(currentWorkspaceEnv()).toEqual({ kind: "wsl", distro: "Ubuntu" });
    expect(workspaceRoot.rootPath).toBe("/home/dev");
    expect(tabs.tabs).toEqual([
      {
        id: 5,
        kind: "terminal",
        title: "shell",
        cwd: "/home/dev",
        paneTree: { kind: "leaf", id: 6, cwd: "/home/dev" },
        activeLeafId: 6,
      },
    ]);
    expect(tabs.activeId).toBe(5);
    expect(invokeMock).toHaveBeenCalledWith("wsl_home", { distro: "Ubuntu" });
    expect(invokeMock).toHaveBeenCalledWith("workspace_authorize", {
      path: "/home/dev",
      workspace: { kind: "wsl", distro: "Ubuntu" },
    });
  });

  it("blocks workspace switching while editor tabs are dirty", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const pinia = createPinia();
    const workspaceRoot = useWorkspaceRootPiniaStore(pinia);
    workspaceRoot.rootPath = "/repo";
    const wrapper = mount(MainApp, {
      global: { plugins: [pinia, i18n] },
    });
    const tabs = useTabsPiniaStore();

    const editorId = tabs.openFileTab("/repo/src/main.ts");
    tabs.updateTab(editorId!, { dirty: true });
    await nextTick();

    await wrapper.find("[data-switch-wsl]").trigger("click");
    await flushPromises();

    expect(alertSpy).toHaveBeenCalledWith(
      "Save or close unsaved editor tabs before switching workspace.",
    );
    expect(currentWorkspaceEnv()).toEqual({ kind: "local" });
    expect(tabs.tabs.some((tab) => tab.kind === "editor" && tab.dirty)).toBe(
      true,
    );
    expect(invokeMock).not.toHaveBeenCalledWith("wsl_home", {
      distro: "Ubuntu",
    });

    alertSpy.mockRestore();
  });

  it("confirms before closing an unsaved editor tab", async () => {
    const pinia = createPinia();
    const workspaceRoot = useWorkspaceRootPiniaStore(pinia);
    workspaceRoot.rootPath = "/repo";
    const host = document.createElement("div");
    document.body.appendChild(host);
    let wrapper: VueWrapper | null = null;

    try {
      wrapper = mount(MainApp, {
        attachTo: host,
        global: { plugins: [pinia, i18n] },
      });
      const tabs = useTabsPiniaStore();

      await nextTick();
      await wrapper.find("[data-open-file]").trigger("click");
      await wrapper.find("[data-editor-dirty]").trigger("click");
      await nextTick();

      await wrapper.find("[data-close-tab-id='3']").trigger("click");
      await nextTick();
      await flushPromises();

      expect(tabs.tabs.map((tab) => tab.id)).toEqual([1, 3]);
      expect(document.body.textContent).toContain("Close unsaved file?");
      expect(document.body.textContent).toContain("main.ts");

      const cancelButton = Array.from(document.body.querySelectorAll("button")).find(
        (button) => button.textContent?.includes("Cancel"),
      );
      cancelButton?.click();
      await nextTick();
      await flushPromises();

      expect(tabs.tabs.map((tab) => tab.id)).toEqual([1, 3]);

      await wrapper.find("[data-close-tab-id='3']").trigger("click");
      await nextTick();
      await flushPromises();
      const closeButton = Array.from(document.body.querySelectorAll("button")).find(
        (button) => button.textContent?.includes("Close Without Saving"),
      );
      closeButton?.click();
      await nextTick();
      await flushPromises();

      expect(tabs.tabs.map((tab) => tab.id)).toEqual([1]);
    } finally {
      wrapper?.unmount();
      wrapperCleanup(host);
    }
  });

  it("renders the Vue file explorer and opens files into editor tabs", async () => {
    const pinia = createPinia();
    const workspaceRoot = useWorkspaceRootPiniaStore(pinia);
    workspaceRoot.rootPath = "/repo";
    const wrapper = mount(MainApp, {
      global: { plugins: [pinia, i18n] },
    });
    const tabs = useTabsPiniaStore();

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

  it("pins editor preview tabs from a tab double click", async () => {
    const pinia = createPinia();
    const workspaceRoot = useWorkspaceRootPiniaStore(pinia);
    workspaceRoot.rootPath = "/repo";
    const wrapper = mount(MainApp, {
      global: { plugins: [pinia, i18n] },
    });
    const tabs = useTabsPiniaStore();

    await nextTick();
    await wrapper.find("[data-open-file]").trigger("click");
    await nextTick();

    expect(tabs.tabs[1]).toMatchObject({
      kind: "editor",
      path: "/repo/src/main.ts",
      preview: true,
    });

    await wrapper.find("[data-tab-id='3']").trigger("dblclick");
    await nextTick();

    expect(tabs.tabs[1]).toMatchObject({
      kind: "editor",
      path: "/repo/src/main.ts",
      preview: false,
    });

    await wrapper.find("[data-open-other-file]").trigger("click");

    expect(tabs.tabs.map((tab) => tab.id)).toEqual([1, 3, 4]);
    expect(tabs.tabs[1]).toMatchObject({
      kind: "editor",
      path: "/repo/src/main.ts",
      preview: false,
    });
    expect(tabs.tabs[2]).toMatchObject({
      kind: "editor",
      path: "/repo/src/other.ts",
      preview: true,
    });
  });

  it("opens clicked files as pinned editor tabs when previews are disabled", async () => {
    const pinia = createPinia();
    const workspaceRoot = useWorkspaceRootPiniaStore(pinia);
    workspaceRoot.rootPath = "/repo";
    const wrapper = mount(MainApp, {
      global: { plugins: [pinia, i18n] },
    });
    const prefs = usePreferencesPiniaStore();
    const tabs = useTabsPiniaStore();
    prefs.fileOpenMode = "pinned";

    await nextTick();
    await wrapper.find("[data-open-file]").trigger("click");
    await wrapper.find("[data-open-other-file]").trigger("click");

    expect(tabs.tabs.map((tab) => tab.id)).toEqual([1, 3, 4]);
    expect(tabs.tabs[1]).toMatchObject({
      kind: "editor",
      path: "/repo/src/main.ts",
      preview: false,
    });
    expect(tabs.tabs[2]).toMatchObject({
      kind: "editor",
      path: "/repo/src/other.ts",
      preview: false,
    });
  });

  it("renders migrated preview and markdown tabs", async () => {
    const pinia = createPinia();
    const workspaceRoot = useWorkspaceRootPiniaStore(pinia);
    workspaceRoot.rootPath = "/repo";
    const wrapper = mount(MainApp, {
      global: { plugins: [pinia, i18n] },
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

  it("renders migrated git diff tabs", async () => {
    const pinia = createPinia();
    const workspaceRoot = useWorkspaceRootPiniaStore(pinia);
    workspaceRoot.rootPath = "/repo";
    const wrapper = mount(MainApp, {
      global: { plugins: [pinia, i18n] },
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
  });

  it("renders migrated git history tabs and opens commit file diffs", async () => {
    const pinia = createPinia();
    const workspaceRoot = useWorkspaceRootPiniaStore(pinia);
    workspaceRoot.rootPath = "/repo";
    const wrapper = mount(MainApp, {
      global: { plugins: [pinia, i18n] },
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
    const workspaceRoot = useWorkspaceRootPiniaStore(pinia);
    workspaceRoot.rootPath = "/repo";
    const wrapper = mount(MainApp, {
      global: { plugins: [pinia, i18n] },
    });
    const tabs = useTabsPiniaStore();

    await nextTick();
    await wrapper.find("[data-toggle-left-panel]").trigger("click");

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

  it("keeps explorer and source control rooted at the workspace when terminal cwd changes", async () => {
    const pinia = createPinia();
    const workspaceRoot = useWorkspaceRootPiniaStore(pinia);
    workspaceRoot.rootPath = "/repo";
    const wrapper = mount(MainApp, {
      global: { plugins: [pinia, i18n] },
    });
    const tabs = useTabsPiniaStore();
    await nextTick();

    await wrapper.find("[data-terminal-cd]").trigger("click");
    await nextTick();

    expect(tabs.tabs[0]).toMatchObject({ kind: "terminal", cwd: "/tmp" });
    expect(wrapper.find("[data-file-explorer]").text()).toContain("/repo");

    await wrapper.find("[data-toggle-left-panel]").trigger("click");
    await nextTick();
    expect(wrapper.find("[data-source-control]").text()).toContain("/repo");
  });

  it("forwards workspace fs events when Windows root separators differ", async () => {
    (window as typeof window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__ = { invoke: vi.fn(async () => null) };
    const pinia = createPinia();
    const workspaceRoot = useWorkspaceRootPiniaStore(pinia);
    workspaceRoot.rootPath = "D:/repo";
    usePreferencesPiniaStore(pinia).hydrated = true;
    const wrapper = mount(MainApp, {
      global: { plugins: [pinia, i18n] },
    });
    await flushPromises();
    await nextTick();

    eventListenMock.handlers[0]?.({
      payload: {
        rootPath: "D:\\repo",
        paths: ["D:/repo/src/main.ts"],
        gitRelated: false,
      },
    });
    await nextTick();

    expect(wrapper.find("[data-explorer-fs-event]").text()).toBe(
      "D:/repo/src/main.ts",
    );

    await wrapper.find("[data-toggle-left-panel]").trigger("click");
    await nextTick();

    expect(wrapper.find("[data-source-fs-event]").text()).toBe(
      "D:/repo/src/main.ts",
    );
  });

  it("does not run periodic workspace refresh for WSL because backend owns fallback", async () => {
    vi.useFakeTimers();
    (window as typeof window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__ = { invoke: vi.fn(async () => null) };
    const pinia = createPinia();
    useWorkspaceEnvPiniaStore(pinia).setEnv({ kind: "wsl", distro: "Ubuntu" });
    const workspaceRoot = useWorkspaceRootPiniaStore(pinia);
    workspaceRoot.rootPath = "/home/dev/repo";
    usePreferencesPiniaStore(pinia).hydrated = true;
    const wrapper = mount(MainApp, {
      global: { plugins: [pinia, i18n] },
    });

    await flushPromises();
    await nextTick();

    expect(wrapper.find("[data-explorer-fs-event]").text()).toBe("none");
    expect(invokeMock).toHaveBeenCalledWith("fs_watch_workspace", {
      rootPath: "/home/dev/repo",
      workspace: { kind: "wsl", distro: "Ubuntu" },
    });

    await vi.advanceTimersByTimeAsync(5000);
    await nextTick();

    expect(wrapper.find("[data-explorer-fs-event]").text()).toBe("none");

    await wrapper.find("[data-toggle-left-panel]").trigger("click");
    await nextTick();

    expect(wrapper.find("[data-source-fs-event]").text()).toBe("none");
    vi.useRealTimers();
  });

  it("does not run periodic workspace refresh for local workspaces while the watcher is active", async () => {
    vi.useFakeTimers();
    (window as typeof window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__ = { invoke: vi.fn(async () => null) };
    const pinia = createPinia();
    const workspaceRoot = useWorkspaceRootPiniaStore(pinia);
    workspaceRoot.rootPath = "D:/repo";
    usePreferencesPiniaStore(pinia).hydrated = true;
    const wrapper = mount(MainApp, {
      global: { plugins: [pinia, i18n] },
    });

    await flushPromises();
    await nextTick();

    expect(invokeMock).toHaveBeenCalledWith("fs_watch_workspace", {
      rootPath: "D:/repo",
      workspace: { kind: "local" },
    });

    await vi.advanceTimersByTimeAsync(5000);
    await nextTick();

    expect(wrapper.find("[data-explorer-fs-event]").text()).toBe("none");
    vi.useRealTimers();
  });

});
