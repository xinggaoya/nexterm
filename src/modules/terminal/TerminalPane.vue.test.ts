// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TerminalPane from "./TerminalPane.vue";
import {
  mountTerminalSession,
  updateTerminalSessionVisibility,
} from "./lib/terminalSessionCore";
import { getLeafTerm } from "./lib/rendererPool";

const clipboardMocks = vi.hoisted(() => ({
  readClipboardText: vi.fn(),
  writeClipboardText: vi.fn(),
}));

const fakeTerm = {
  getSelection: vi.fn(() => ""),
  paste: vi.fn(),
  selectAll: vi.fn(),
};

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
  getLeafTerm: vi.fn(() => fakeTerm),
}));

vi.mock("@/lib/clipboard", () => clipboardMocks);

describe("TerminalPane.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    fakeTerm.getSelection.mockReturnValue("");
    vi.mocked(getLeafTerm).mockReturnValue(fakeTerm as never);
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

  it("shows a right-click context menu with copy/paste/select-all", async () => {
    clipboardMocks.writeClipboardText.mockResolvedValue(undefined);
    const wrapper = mount(TerminalPane, {
      props: { leafId: 60, visible: true, focused: true },
      attachTo: document.body,
    });
    const host = wrapper.element.querySelector(
      ".nexterm-terminal-scrollbar",
    ) as HTMLElement;
    expect(host).toBeTruthy();

    Object.defineProperty(host, "getBoundingClientRect", {
      value: () => ({
        left: 0,
        top: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 600,
        x: 0,
        y: 0,
        toJSON() {},
      }),
    });

    // No selection initially → copy is disabled
    fakeTerm.getSelection.mockReturnValue("");
    const eventNoSelection = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      clientY: 80,
    });
    host.dispatchEvent(eventNoSelection);
    await wrapper.vm.$nextTick();

    let menu = wrapper.find("[data-terminal-context-menu]");
    expect(menu.exists()).toBe(true);
    expect(
      menu.find("[data-terminal-context-action='copy']").attributes("disabled"),
    ).toBeDefined();
    expect(menu.find("[data-terminal-context-action='paste']").exists()).toBe(true);
    expect(
      menu.find("[data-terminal-context-action='select-all']").exists(),
    ).toBe(true);

    // Click outside closes the menu
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-terminal-context-menu]").exists()).toBe(false);

    // With selection → copy enabled, clicking it copies
    fakeTerm.getSelection.mockReturnValue("hello world");
    host.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 200,
        clientY: 150,
      }),
    );
    await wrapper.vm.$nextTick();

    menu = wrapper.find("[data-terminal-context-menu]");
    expect(menu.exists()).toBe(true);
    expect(
      menu.find("[data-terminal-context-action='copy']").attributes("disabled"),
    ).toBeUndefined();
    await menu.find("[data-terminal-context-action='copy']").trigger("click");
    expect(clipboardMocks.writeClipboardText).toHaveBeenCalledWith("hello world");
    expect(wrapper.find("[data-terminal-context-menu]").exists()).toBe(false);

    // Paste action reads clipboard and calls term.paste
    clipboardMocks.readClipboardText.mockResolvedValue("clip text");
    host.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 50,
        clientY: 60,
      }),
    );
    await wrapper.vm.$nextTick();
    await wrapper
      .find("[data-terminal-context-action='paste']")
      .trigger("click");
    expect(clipboardMocks.readClipboardText).toHaveBeenCalled();
    expect(fakeTerm.paste).toHaveBeenCalledWith("clip text");

    // Select-all invokes term.selectAll
    host.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 20,
      }),
    );
    await wrapper.vm.$nextTick();
    await wrapper
      .find("[data-terminal-context-action='select-all']")
      .trigger("click");
    expect(fakeTerm.selectAll).toHaveBeenCalled();

    wrapper.unmount();
  });
});
