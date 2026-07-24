// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import { NConfigProvider, NNotificationProvider } from "naive-ui";
import { createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import MainApp from "./MainApp.vue";
import { i18n, setI18nLanguage } from "@/modules/i18n";
import { applyTerminalSessionTheme } from "@/modules/terminal";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import { LOCAL_WORKSPACE, useWorkspaceRootPiniaStore } from "@/modules/workspace";

// MainApp 已完全重写为多工作区架构：WorkspaceBar + WorkspaceHost 栈，
// 不再有单工作区 rootPath / openWorkspace / setEnv / switchWorkspace 等旧 API。
// 这些测试只覆盖 MainApp 自身的行为：Naive UI providers、主题/locale 同步、
// 通知位置、原生右键菜单拦截、添加工作区流程、设置抽屉。所有子外壳组件
// （TitleBar/StatusBar/WorkspaceBar/WorkspaceHost/WorkspaceWelcome 等）都被
// 替换为最小 stub，以便隔离 MainApp 自身的逻辑。

const invokeMock = vi.hoisted(() =>
  vi.fn(async (command: string, args?: Record<string, unknown>) => {
    // addWorkspace 流程需要 workspace_authorize 返回授权后的路径。
    if (command === "workspace_authorize") return args?.path ?? null;
    return null;
  }),
);

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
  listen: vi.fn(async () => vi.fn()),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: vi.fn(async () => false),
    isFullscreen: vi.fn(async () => false),
    onResized: vi.fn(async () => vi.fn()),
    onCloseRequested: vi.fn(async () => vi.fn()),
    startDragging: vi.fn(async () => {}),
    innerSize: vi.fn(async () => ({ width: 1200, height: 800 })),
    outerPosition: vi.fn(async () => ({ x: 100, y: 100 })),
  }),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  exit: vi.fn(async () => undefined),
  relaunch: vi.fn(async () => undefined),
}));

vi.mock("@/lib/platform", () => ({
  IS_MAC: false,
  IS_LINUX: false,
  IS_WINDOWS: true,
  USE_CUSTOM_WINDOW_CONTROLS: true,
  MOD_KEY: "Ctrl",
  MOD_PROP: "ctrl" as const,
  CTRL_KEY: "Ctrl",
  ALT_KEY: "Alt",
  SHIFT_KEY: "Shift",
  TAB_KEY: "Tab",
  ENTER_KEY: "Enter",
  KEY_SEP: "+",
  fmtShortcut: (...parts: string[]) => parts.join("+"),
}));

vi.mock("@/modules/terminal", () => ({
  applyTerminalSessionTheme: vi.fn(),
  getPtyIdForLeaf: vi.fn(() => null),
  disposeSession: vi.fn(),
  TerminalWorkspace: { name: "TerminalWorkspace", template: "<div />" },
}));

vi.mock("@/modules/terminal/lib/sessions", () => ({
  disposeSession: vi.fn(),
  disposeAllSessions: vi.fn(),
}));

vi.mock("@/modules/tabs/terminalDisposal", () => ({
  configureTerminalSessionDisposer: vi.fn(),
}));

vi.mock("@/modules/notifications/NotificationBridge.vue", () => ({
  default: { template: '<div data-notification-bridge />' },
}));

vi.mock("@/settings/SettingsPanel.vue", () => ({
  default: {
    props: ["activeTab", "showClose"],
    emits: ["update:activeTab", "close"],
    template:
      '<div data-settings-panel><button data-settings-tab="general" /><button data-settings-close @click="$emit(\'close\')">close</button></div>',
  },
}));

vi.mock("./shell/TitleBar.vue", () => ({
  default: {
    props: ["showWindowControls"],
    emits: [
      "openCommandPalette",
      "openSettings",
      "selectWorkspace",
      "closeWorkspace",
      "addWorkspace",
      "openInNewWindow",
    ],
    template:
      '<header data-title-bar><button data-add-workspace @click="$emit(\'addWorkspace\', { kind: \'local\' })" /><button data-add-wsl-workspace @click="$emit(\'addWorkspace\', { kind: \'wsl\', distro: \'Ubuntu\' })" /><button data-open-settings @click="$emit(\'openSettings\')" /><button data-open-command-palette @click="$emit(\'openCommandPalette\')" /></header>',
  },
}));

vi.mock("./shell/StatusBar.vue", () => ({
  default: {
    props: ["workspaceName", "gitBranch", "panelStates"],
    emits: ["togglePanel"],
    template:
      '<footer data-status-bar><button data-toggle-panel="sourceControl" @click="$emit(\'togglePanel\', \'sourceControl\')" /><button data-toggle-panel="explorer" @click="$emit(\'togglePanel\', \'explorer\')" /><button data-toggle-panel="workspace" @click="$emit(\'togglePanel\', \'workspace\')" /><button data-toggle-panel="taskConsole" @click="$emit(\'togglePanel\', \'taskConsole\')" /></footer>',
  },
}));

vi.mock("./shell/WorkspaceBar.vue", () => ({
  default: {
    emits: ["selectWorkspace", "closeWorkspace", "addWorkspace", "openInNewWindow"],
    template:
      '<nav data-workspace-bar><button data-add-workspace @click="$emit(\'addWorkspace\')" /><button data-open-in-new-window @click="$emit(\'openInNewWindow\')" /></nav>',
  },
}));

vi.mock("./shell/WorkspaceHost.vue", () => ({
  default: {
    props: ["workspace"],
    emits: ["add-workspace", "open-in-new-window"],
    template: '<section data-workspace-host>{{ workspace.rootPath }}</section>',
  },
}));

vi.mock("./components/WorkspaceWelcome.vue", () => ({
  default: {
    props: ["recentWorkspaces", "loading", "error"],
    emits: ["chooseWorkspace", "openRecent", "workspaceEnvChange"],
    template:
      '<section data-workspace-welcome><span>{{ error ?? "welcome" }}</span><button data-welcome-open @click="$emit(\'chooseWorkspace\', { kind: \'local\' })" /></section>',
  },
}));

vi.mock("./components/UnsavedCloseGuard.vue", () => ({
  default: {
    props: ["tabs"],
    emits: ["closeTab"],
    template: '<div data-unsaved-close-guard />',
  },
}));

vi.mock("./components/RenameTerminalDialog.vue", () => ({
  default: {
    props: ["show", "currentTitle"],
    emits: ["submit", "cancel"],
    template: '<div data-rename-terminal-dialog />',
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
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
    document.body.innerHTML = "";
    setI18nLanguage("en-US");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the workspace welcome screen before a workspace is opened", () => {
    const wrapper = mount(MainApp, {
      global: { plugins: [createPinia(), i18n] },
    });

    expect(wrapper.find("[data-workspace-welcome]").exists()).toBe(true);
    expect(wrapper.find("[data-workspace-host]").exists()).toBe(false);
  });

  it("prevents the native webview context menu", () => {
    mount(MainApp, {
      global: { plugins: [createPinia(), i18n] },
    });

    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("lets component context menu handlers run before preventing the native menu", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const wrapper = mount(MainApp, {
      attachTo: host,
      global: { plugins: [createPinia(), i18n] },
    });

    try {
      const customHandler = vi.fn();
      wrapper.element.addEventListener("contextmenu", customHandler);

      const event = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
      });
      wrapper.element.dispatchEvent(event);

      expect(customHandler).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    } finally {
      wrapper.unmount();
      wrapperCleanup(host);
    }
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

  it("places notifications in the lower-right corner", () => {
    const wrapper = mount(MainApp, {
      global: { plugins: [createPinia(), i18n] },
    });

    const provider = wrapper.findComponent(NNotificationProvider);

    expect(provider.props("placement")).toBe("bottom-right");
    expect(provider.props("containerStyle")).toBe("right: 12px; bottom: 12px;");
  });

  it("opens the workspace target chooser from the promoted header action", async () => {
    const pinia = createPinia();
    const workspaceRoot = useWorkspaceRootPiniaStore(pinia);
    workspaceRoot.pickWorkspaceDirectory = vi.fn(async () => ({
      path: "/repo",
      env: LOCAL_WORKSPACE,
    }));

    const wrapper = mount(MainApp, {
      global: { plugins: [pinia, i18n] },
    });

    await wrapper.find("[data-add-workspace]").trigger("click");
    await flushPromises();
    await nextTick();

    expect(workspaceRoot.pickWorkspaceDirectory).toHaveBeenCalledTimes(1);
  });

  it("opens a picked workspace in the current window after target selection", async () => {
    const pinia = createPinia();
    const workspaceRoot = useWorkspaceRootPiniaStore(pinia);
    workspaceRoot.pickWorkspaceDirectory = vi.fn(async () => ({
      path: "/repo",
      env: LOCAL_WORKSPACE,
    }));

    const wrapper = mount(MainApp, {
      global: { plugins: [pinia, i18n] },
    });

    await wrapper.find("[data-add-workspace]").trigger("click");
    await flushPromises();
    for (let i = 0; i < 10; i++) {
      await flushPromises();
      await nextTick();
    }

    // 工作区已添加到 workspaces store 并被 WorkspaceHost 渲染。
    expect(wrapper.find("[data-workspace-host]").text()).toContain("/repo");
  });

  it("passes the selected WSL distro into the workspace picker", async () => {
    const pinia = createPinia();
    const workspaceRoot = useWorkspaceRootPiniaStore(pinia);
    const wslEnv = { kind: "wsl" as const, distro: "Ubuntu" };
    workspaceRoot.pickWorkspaceDirectory = vi.fn(async () => ({
      path: "/home/dev/repo",
      env: wslEnv,
    }));

    const wrapper = mount(MainApp, {
      global: { plugins: [pinia, i18n] },
    });

    await wrapper.find("[data-add-wsl-workspace]").trigger("click");
    await flushPromises();
    await nextTick();

    expect(workspaceRoot.pickWorkspaceDirectory).toHaveBeenCalledWith(wslEnv);
  });

  it("opens settings inside the main window without invoking a Tauri settings window", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const pinia = createPinia();
    useWorkspaceRootPiniaStore(pinia);

    try {
      const wrapper = mount(MainApp, {
        attachTo: host,
        global: { plugins: [pinia, i18n] },
      });
      await nextTick();
      invokeMock.mockClear();

      expect(document.body.querySelector("[data-settings-panel]")).toBeNull();

      await wrapper.find("[data-open-settings]").trigger("click");
      await nextTick();
      await flushPromises();

      expect(invokeMock).not.toHaveBeenCalled();
      expect(document.body.querySelector("[data-settings-panel]")).not.toBeNull();
    } finally {
      document.body.removeChild(host);
      document.body
        .querySelectorAll("[data-settings-panel]")
        .forEach((node) => node.remove());
    }
  });
});
