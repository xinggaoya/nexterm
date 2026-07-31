// @vitest-environment jsdom
import { nextTick, reactive } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkbenchLayout } from "./useWorkbenchLayout";

describe("useWorkbenchLayout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // useWorkbenchLayout now reads panel visibility from a shared Pinia store,
    // so an active Pinia instance is required.
    setActivePinia(createPinia());
    // 让 hasTauriInternals() 返回 true，使 schedule* 走真实的 debounce -> 写
    // prefs 路径，从而完整校验序列化与调用。Plugin-store 自身在 jsdom 下不会
    // 被实际命中（schedule/flush 走 void prefs.update*，而 prefs 被 reactive
    // mock 替换），所以这里只需要满足运行时检测即可。
    (window as typeof window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__ = { invoke: () => Promise.resolve(null) };
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
  });

  function createPrefs() {
    return reactive({
      sourceControlPanelWidth: 256,
      explorerPanelWidth: 300,
      leftSidebar: {
        activity: "sourceControl" as const,
        open: true,
        width: 320,
      },
      panelVisibility: {
        workspace: true,
        sourceControl: true,
        explorer: true,
        taskConsole: false,
      },
      updateSourceControlPanelWidth: vi.fn(async (_value: number) => {}),
      updateExplorerPanelWidth: vi.fn(async (_value: number) => {}),
      updateLeftSidebar: vi.fn(
        async (_value: {
          activity: "workspace" | "sourceControl";
          open: boolean;
          width: number;
        }) => {},
      ),
      updatePanelVisibility: vi.fn(
        async (_value: {
          workspace: boolean;
          sourceControl: boolean;
          explorer: boolean;
          taskConsole: boolean;
        }) => {},
      ),
    });
  }

  it("clamps and persists source control width after the drag debounce", async () => {
    const prefs = createPrefs();
    const layout = useWorkbenchLayout({ prefs, saveDelayMs: 250 });

    layout.updateSourceControlSplitSize("900px");

    expect(layout.sourceControlPanelWidth.value).toBe(520);
    expect(prefs.updateSourceControlPanelWidth).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(249);
    expect(prefs.updateSourceControlPanelWidth).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(prefs.updateSourceControlPanelWidth).toHaveBeenCalledWith(520);
  });

  it("converts center split size into explorer panel width", async () => {
    const prefs = createPrefs();
    const layout = useWorkbenchLayout({
      prefs,
      panelResizeTriggerSize: 6,
      saveDelayMs: 250,
    });

    layout.rightSplitWidth.value = 900;
    layout.updateExplorerSplitSize("600px");
    await vi.advanceTimersByTimeAsync(250);

    expect(layout.explorerPanelWidth.value).toBe(294);
    expect(prefs.updateExplorerPanelWidth).toHaveBeenCalledWith(294);
  });

  it("syncs panel widths from external preference updates when no save is pending", async () => {
    const prefs = createPrefs();
    const layout = useWorkbenchLayout({ prefs });

    prefs.sourceControlPanelWidth = 128;
    prefs.explorerPanelWidth = 1000;
    await nextTick();

    expect(layout.sourceControlPanelWidth.value).toBe(240);
    expect(layout.explorerPanelWidth.value).toBe(520);
  });

  it("uses the compact workbench defaults", () => {
    const layout = useWorkbenchLayout({ prefs: createPrefs() });

    expect(layout.leftSidebar.value.width).toBe(320);
    expect(layout.panelResizeTriggerSize).toBe(4);
  });

  it("flushes pending panel width saves", () => {
    const prefs = createPrefs();
    const layout = useWorkbenchLayout({ prefs, saveDelayMs: 250 });

    layout.updateSourceControlSplitSize(320);
    layout.rightSplitWidth.value = 900;
    layout.updateExplorerSplitSize(620);
    layout.flushSourceControlWidthSave();
    layout.flushExplorerWidthSave();

    expect(prefs.updateSourceControlPanelWidth).toHaveBeenCalledWith(320);
    // usableWidth = rightSplitWidth(900) - panelResizeTriggerSize(4) = 896；
    // explorer 宽度 = 896 - centerWidth(620) = 276。
    expect(prefs.updateExplorerPanelWidth).toHaveBeenCalledWith(276);
  });

  it("togglePanel(workspace) acts as a toggle against the left sidebar", async () => {
    const prefs = createPrefs();
    const layout = useWorkbenchLayout({ prefs, saveDelayMs: 250 });

    // 初始：leftSidebar 在 sourceControl 视图且打开。
    expect(layout.leftSidebar.value.open).toBe(true);
    expect(layout.leftSidebar.value.activity).toBe("sourceControl");

    // 第一次切到 workspace：左侧栏仍 open，但 activity 切到 workspace。
    layout.togglePanel("workspace");
    expect(layout.leftSidebar.value.open).toBe(true);
    expect(layout.leftSidebar.value.activity).toBe("workspace");
    // panelVisibility 派生同步。
    expect(layout.panelVisibility.value.workspace).toBe(true);
    expect(layout.panelVisibility.value.sourceControl).toBe(false);

    // 第二次点 workspace：折叠左侧栏。
    layout.togglePanel("workspace");
    expect(layout.leftSidebar.value.open).toBe(false);
    expect(layout.panelVisibility.value.workspace).toBe(false);

    // debounce 后写 prefs。
    await vi.advanceTimersByTimeAsync(250);
    expect(prefs.updateLeftSidebar).toHaveBeenCalled();
    expect(prefs.updatePanelVisibility).toHaveBeenCalled();
  });

  it("togglePanel(sourceControl) toggles the left sidebar in sourceControl view", () => {
    const prefs = createPrefs();
    const layout = useWorkbenchLayout({ prefs });

    // 已经在 sourceControl 视图 → 折叠。
    layout.togglePanel("sourceControl");
    expect(layout.leftSidebar.value.open).toBe(false);
    expect(layout.panelVisibility.value.sourceControl).toBe(false);

    // 再点 → 展开并切回 sourceControl。
    layout.togglePanel("sourceControl");
    expect(layout.leftSidebar.value.open).toBe(true);
    expect(layout.leftSidebar.value.activity).toBe("sourceControl");
    expect(layout.panelVisibility.value.sourceControl).toBe(true);
  });

  it("togglePanel(explorer) keeps the explorer status in lockstep", () => {
    const prefs = createPrefs();
    const layout = useWorkbenchLayout({ prefs });

    expect(layout.panelVisibility.value.explorer).toBe(true);
    layout.togglePanel("explorer");
    expect(layout.panelVisibility.value.explorer).toBe(false);
    layout.togglePanel("explorer");
    expect(layout.panelVisibility.value.explorer).toBe(true);
  });

  it("bootstrapFromPrefs hydrates leftSidebar from prefs on next microtask", async () => {
    const prefs = reactive({
      sourceControlPanelWidth: 256,
      explorerPanelWidth: 300,
      leftSidebar: {
        activity: "workspace" as const,
        open: false,
        width: 380,
      },
      panelVisibility: {
        workspace: false,
        sourceControl: false,
        explorer: false,
        taskConsole: false,
      },
      updateSourceControlPanelWidth: vi.fn(async () => {}),
      updateExplorerPanelWidth: vi.fn(async () => {}),
      updateLeftSidebar: vi.fn(async () => {}),
      updatePanelVisibility: vi.fn(async () => {}),
    });
    const layout = useWorkbenchLayout({ prefs });
    layout.bootstrapFromPrefs();

    expect(layout.leftSidebar.value.activity).toBe("workspace");
    expect(layout.leftSidebar.value.open).toBe(false);
    expect(layout.leftSidebar.value.width).toBe(380);
    // panelVisibility 派生同步：open=false 时两者都是 false。
    expect(layout.panelVisibility.value.workspace).toBe(false);
    expect(layout.panelVisibility.value.sourceControl).toBe(false);
  });
});
