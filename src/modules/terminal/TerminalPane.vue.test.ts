// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TerminalPane from "./TerminalPane.vue";
import {
  mountTerminalSession,
  updateTerminalSessionVisibility,
} from "./lib/terminalSessionCore";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";

vi.mock("./lib/terminalSessionCore", () => ({
  mountTerminalSession: vi.fn(() => vi.fn()),
  updateTerminalSessionVisibility: vi.fn(),
  applyTerminalSessionScrollback: vi.fn(),
  createTerminalSessionHandle: vi.fn(() => ({
    write: vi.fn(),
    focus: vi.fn(),
    getBuffer: vi.fn(),
    getSelection: vi.fn(),
    applyTheme: vi.fn(),
  })),
}));

vi.mock("./lib/rendererPool", () => ({
  applyFontFamily: vi.fn(),
  applyFontSize: vi.fn(),
  applyLetterSpacing: vi.fn(),
  applyScrollback: vi.fn(),
  applyWebglPreference: vi.fn(),
  getLeafTerm: vi.fn(() => null),
}));

vi.mock("./TerminalSelectionToolbar.vue", () => ({
  default: {
    name: "TerminalSelectionToolbar",
    props: ["leafId", "container", "visible", "focused"],
    emits: ["close", "select"],
    template: "<div data-selection-toolbar-stub />",
  },
}));

function makeTouch(
  type: string,
  touches: Array<{ clientX: number; clientY: number }>,
): TouchEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as TouchEvent;
  Object.defineProperty(event, "touches", { value: touches });
  Object.defineProperty(event, "changedTouches", { value: touches });
  return event;
}

describe("TerminalPane.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("mounts a framework-neutral terminal session for its leaf", () => {
    const wrapper = mount(TerminalPane, {
      props: {
        leafId: 42,
        visible: true,
        focused: true,
        initialCwd: "/tmp",
      },
    });

    expect(mountTerminalSession).toHaveBeenCalledWith(
      expect.objectContaining({
        leafId: 42,
        initialCwd: "/tmp",
      }),
    );
    expect(updateTerminalSessionVisibility).toHaveBeenCalledWith(42, true, true);
    expect(wrapper.classes()).toContain("relative");
  });

  it("emits title updates from the terminal session", () => {
    const wrapper = mount(TerminalPane, {
      props: {
        leafId: 42,
        visible: true,
        focused: true,
      },
    });

    const callbacks = vi.mocked(mountTerminalSession).mock.calls[0][0].callbacks;
    callbacks?.onTitle?.("OpenAI Codex");

    expect(wrapper.emitted("title")).toEqual([[42, "OpenAI Codex"]]);
  });

  it("replays current visibility after mounting the session", () => {
    mount(TerminalPane, {
      props: {
        leafId: 44,
        visible: true,
        focused: true,
      },
    });

    const mountOrder = vi.mocked(mountTerminalSession).mock.invocationCallOrder[0];
    const visibilityOrders = vi
      .mocked(updateTerminalSessionVisibility)
      .mock.invocationCallOrder;
    const lastVisibilityOrder = visibilityOrders[visibilityOrders.length - 1];

    expect(lastVisibilityOrder).toBeGreaterThan(mountOrder);
    expect(updateTerminalSessionVisibility).toHaveBeenLastCalledWith(
      44,
      true,
      true,
    );
  });

  it("updates core visibility when visible or focused props change", async () => {
    const wrapper = mount(TerminalPane, {
      props: { leafId: 43, visible: false, focused: false },
    });

    await wrapper.setProps({ visible: true, focused: false });
    await wrapper.setProps({ visible: true, focused: true });

    expect(updateTerminalSessionVisibility).toHaveBeenCalledWith(43, false, false);
    expect(updateTerminalSessionVisibility).toHaveBeenCalledWith(43, true, false);
    expect(updateTerminalSessionVisibility).toHaveBeenCalledWith(43, true, true);
  });

  it("dispatches wheel events to the host when touch scroll moves", async () => {
    const prefs = usePreferencesPiniaStore();
    prefs.touchOptimizations = "on";
    const wrapper = mount(TerminalPane, {
      props: { leafId: 50, visible: true, focused: true },
      attachTo: document.body,
    });
    const host = wrapper.element.querySelector(
      ".nexterm-terminal-scrollbar",
    ) as HTMLElement;
    expect(host).toBeTruthy();

    const wheelSpy = vi.fn();
    host.addEventListener("wheel", wheelSpy);

    host.dispatchEvent(makeTouch("touchstart", [{ clientX: 10, clientY: 100 }]));
    host.dispatchEvent(makeTouch("touchmove", [{ clientX: 12, clientY: 130 }]));

    await wrapper.vm.$nextTick();
    expect(wheelSpy).toHaveBeenCalled();
    const event = wheelSpy.mock.calls[0][0] as WheelEvent;
    expect(event.deltaY).toBeLessThan(0);
    wrapper.unmount();
  });

  it("ignores touch input when touch optimizations are off", async () => {
    const prefs = usePreferencesPiniaStore();
    prefs.touchOptimizations = "off";
    const wrapper = mount(TerminalPane, {
      props: { leafId: 51, visible: true, focused: true },
      attachTo: document.body,
    });
    const host = wrapper.element.querySelector(
      ".nexterm-terminal-scrollbar",
    ) as HTMLElement;
    expect(host).toBeTruthy();

    const wheelSpy = vi.fn();
    host.addEventListener("wheel", wheelSpy);

    host.dispatchEvent(makeTouch("touchstart", [{ clientX: 10, clientY: 100 }]));
    host.dispatchEvent(makeTouch("touchmove", [{ clientX: 12, clientY: 130 }]));

    await wrapper.vm.$nextTick();
    expect(wheelSpy).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("shows the selection toolbar after a long press when touch is enabled", async () => {
    vi.useFakeTimers();
    const prefs = usePreferencesPiniaStore();
    prefs.touchOptimizations = "on";
    const wrapper = mount(TerminalPane, {
      props: { leafId: 52, visible: true, focused: true },
      attachTo: document.body,
    });
    const host = wrapper.element.querySelector(
      ".nexterm-terminal-scrollbar",
    ) as HTMLElement;
    expect(host).toBeTruthy();

    host.dispatchEvent(makeTouch("touchstart", [{ clientX: 10, clientY: 100 }]));
    await vi.advanceTimersByTimeAsync(350);
    expect(wrapper.find("[data-selection-toolbar-stub]").exists()).toBe(true);
    wrapper.unmount();
    vi.useRealTimers();
  });
});
