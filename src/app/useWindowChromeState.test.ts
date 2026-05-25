// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWindowChromeState } from "./useWindowChromeState";

function createWindowHarness(input: { maximized?: boolean; fullscreen?: boolean } = {}) {
  const state = {
    maximized: input.maximized ?? false,
    fullscreen: input.fullscreen ?? false,
    handlers: [] as Array<() => void>,
    unlisten: vi.fn(),
  };
  const appWindow = {
    isMaximized: vi.fn(async () => state.maximized),
    isFullscreen: vi.fn(async () => state.fullscreen),
    onResized: vi.fn(async (handler: () => void) => {
      state.handlers.push(handler);
      return state.unlisten;
    }),
  };
  return { appWindow, state };
}

function mountWindowChrome(options: Parameters<typeof useWindowChromeState>[0]) {
  return mount(
    defineComponent({
      setup() {
        useWindowChromeState(options);
        return () => h("div");
      },
    }),
  );
}

describe("useWindowChromeState", () => {
  beforeEach(() => {
    delete document.documentElement.dataset.windowEdgeToEdge;
  });

  afterEach(() => {
    delete document.documentElement.dataset.windowEdgeToEdge;
    vi.restoreAllMocks();
  });

  it("marks the window edge-to-edge when the native window is maximized", async () => {
    const { appWindow, state } = createWindowHarness({ maximized: true });

    const wrapper = mountWindowChrome({
      customControls: true,
      hasRuntime: () => true,
      getWindow: () => appWindow,
    });
    await flushPromises();
    await nextTick();

    expect(document.documentElement.dataset.windowEdgeToEdge).toBe("true");
    expect(appWindow.isMaximized).toHaveBeenCalled();
    expect(appWindow.isFullscreen).toHaveBeenCalled();

    wrapper.unmount();

    expect(state.unlisten).toHaveBeenCalledTimes(1);
    expect(document.documentElement.dataset.windowEdgeToEdge).toBeUndefined();
  });

  it("removes the edge-to-edge marker for a normal restored window", async () => {
    document.documentElement.dataset.windowEdgeToEdge = "true";
    const { appWindow } = createWindowHarness();

    mountWindowChrome({
      customControls: true,
      hasRuntime: () => true,
      getWindow: () => appWindow,
    });
    await flushPromises();
    await nextTick();

    expect(document.documentElement.dataset.windowEdgeToEdge).toBeUndefined();
  });

  it("refreshes the marker after native resize events", async () => {
    const { appWindow, state } = createWindowHarness();

    mountWindowChrome({
      customControls: true,
      hasRuntime: () => true,
      getWindow: () => appWindow,
    });
    await flushPromises();
    await nextTick();

    expect(document.documentElement.dataset.windowEdgeToEdge).toBeUndefined();

    state.fullscreen = true;
    state.handlers[0]?.();
    await flushPromises();
    await nextTick();

    expect(document.documentElement.dataset.windowEdgeToEdge).toBe("true");

    state.fullscreen = false;
    state.maximized = false;
    state.handlers[0]?.();
    await flushPromises();
    await nextTick();

    expect(document.documentElement.dataset.windowEdgeToEdge).toBeUndefined();
  });

  it("does not touch the native window API outside the Tauri custom chrome path", async () => {
    const getWindow = vi.fn();

    mountWindowChrome({
      customControls: true,
      hasRuntime: () => false,
      getWindow,
    });
    await flushPromises();
    await nextTick();

    expect(getWindow).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.windowEdgeToEdge).toBeUndefined();
  });
});
