// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TerminalPane from "./TerminalPane.vue";
import {
  mountTerminalSession,
  updateTerminalSessionVisibility,
} from "./lib/terminalSessionCore";

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
}));

describe("TerminalPane.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mounts a framework-neutral terminal session for its leaf", () => {
    mount(TerminalPane, {
      global: { plugins: [createPinia()] },
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
  });

  it("emits title updates from the terminal session", () => {
    const wrapper = mount(TerminalPane, {
      global: { plugins: [createPinia()] },
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
      global: { plugins: [createPinia()] },
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
      global: { plugins: [createPinia()] },
      props: { leafId: 43, visible: false, focused: false },
    });

    await wrapper.setProps({ visible: true, focused: false });
    await wrapper.setProps({ visible: true, focused: true });

    expect(updateTerminalSessionVisibility).toHaveBeenCalledWith(43, false, false);
    expect(updateTerminalSessionVisibility).toHaveBeenCalledWith(43, true, false);
    expect(updateTerminalSessionVisibility).toHaveBeenCalledWith(43, true, true);
  });
});
