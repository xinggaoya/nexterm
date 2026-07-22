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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createPrefs() {
    return reactive({
      sourceControlPanelWidth: 256,
      explorerPanelWidth: 300,
      updateSourceControlPanelWidth: vi.fn(async (_value: number) => {}),
      updateExplorerPanelWidth: vi.fn(async (_value: number) => {}),
    });
  }

  it("clamps and persists source control width after the drag debounce", async () => {
    const prefs = createPrefs();
    const layout = useWorkbenchLayout({ prefs, saveDelayMs: 250 });

    layout.updateSourceControlSplitSize("900px");

    expect(layout.sourceControlPanelWidth.value).toBe(440);
    expect(prefs.updateSourceControlPanelWidth).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(249);
    expect(prefs.updateSourceControlPanelWidth).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(prefs.updateSourceControlPanelWidth).toHaveBeenCalledWith(440);
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

    expect(layout.sourceControlPanelWidth.value).toBe(220);
    expect(layout.explorerPanelWidth.value).toBe(440);
  });

  it("uses the compact workbench defaults", () => {
    const layout = useWorkbenchLayout({ prefs: createPrefs() });

    expect(layout.leftSidebar.value.width).toBe(272);
    expect(layout.panelResizeTriggerSize).toBe(6);
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
    // usableWidth = rightSplitWidth(900) - panelResizeTriggerSize(6) = 894；
    // explorer 宽度 = 894 - centerWidth(620) = 274。
    expect(prefs.updateExplorerPanelWidth).toHaveBeenCalledWith(274);
  });
});
