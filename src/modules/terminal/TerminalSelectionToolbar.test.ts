// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TerminalSelectionToolbar from "./TerminalSelectionToolbar.vue";

const selectionChangeListeners: Array<() => void> = [];
const clipboardMocks = vi.hoisted(() => ({
  readClipboardText: vi.fn(),
  writeClipboardText: vi.fn(),
}));

const fakeTerm = {
  _core: { _renderService: { dimensions: { actualCellWidth: 8, actualCellHeight: 16 } } },
  element: null as HTMLElement | null,
  getSelection: vi.fn(),
  getSelectionPosition: vi.fn(),
  paste: vi.fn(),
  selectAll: vi.fn(),
  onSelectionChange: vi.fn((listener: () => void) => {
    selectionChangeListeners.push(listener);
    return () => {
      const idx = selectionChangeListeners.indexOf(listener);
      if (idx >= 0) selectionChangeListeners.splice(idx, 1);
    };
  }),
};

vi.mock("./lib/rendererPool", () => ({
  getLeafTerm: () => fakeTerm,
}));

vi.mock("@/lib/clipboard", () => clipboardMocks);

function makeContainer() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  Object.defineProperty(el, "getBoundingClientRect", {
    value: () => ({
      x: 0,
      y: 0,
      left: 0,
      right: 800,
      top: 0,
      bottom: 600,
      width: 800,
      height: 600,
      toJSON: () => ({}),
    }),
  });
  return el;
}

function flushListeners() {
  for (const listener of selectionChangeListeners.slice()) listener();
}

function selectionPosition() {
  return {
    start: { x: 4, y: 2 },
    end: { x: 11, y: 2 },
  };
}

describe("TerminalSelectionToolbar.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    selectionChangeListeners.length = 0;
    fakeTerm.element = null;
    fakeTerm.getSelection.mockReturnValue("");
    fakeTerm.getSelectionPosition.mockReturnValue(null);
  });

  it("shows the toolbar when the terminal emits a non-empty selection", async () => {
    const container = makeContainer();
    fakeTerm.getSelection.mockReturnValue("selected");
    fakeTerm.getSelectionPosition.mockReturnValue(selectionPosition());
    const wrapper = mount(TerminalSelectionToolbar, {
      props: { leafId: 1, container, visible: true, focused: true },
      attachTo: document.body,
    });

    flushListeners();
    await wrapper.vm.$nextTick();

    expect(wrapper.find("[data-terminal-toolbar]").exists()).toBe(true);
    wrapper.unmount();
  });

  it("hides the toolbar when no selection is reported", async () => {
    const container = makeContainer();
    const wrapper = mount(TerminalSelectionToolbar, {
      props: { leafId: 1, container, visible: true, focused: true },
      attachTo: document.body,
    });

    expect(wrapper.find("[data-terminal-toolbar]").exists()).toBe(false);
    wrapper.unmount();
  });

  it("copies the current terminal selection", async () => {
    const container = makeContainer();
    fakeTerm.getSelection.mockReturnValue("echo hello");
    fakeTerm.getSelectionPosition.mockReturnValue(selectionPosition());
    clipboardMocks.writeClipboardText.mockResolvedValue(undefined);
    const wrapper = mount(TerminalSelectionToolbar, {
      props: { leafId: 1, container, visible: true, focused: true },
      attachTo: document.body,
    });

    flushListeners();
    await wrapper.vm.$nextTick();

    await wrapper.find("[data-terminal-action='copy']").trigger("click");

    expect(clipboardMocks.writeClipboardText).toHaveBeenCalledWith("echo hello");
    expect(wrapper.find("[data-terminal-toolbar]").exists()).toBe(false);
    expect(wrapper.emitted("select")).toEqual([["copy"]]);
    wrapper.unmount();
  });

  it("pastes clipboard text into the terminal", async () => {
    const container = makeContainer();
    fakeTerm.getSelection.mockReturnValue("a");
    fakeTerm.getSelectionPosition.mockReturnValue(selectionPosition());
    clipboardMocks.readClipboardText.mockResolvedValue("hello\n");
    const wrapper = mount(TerminalSelectionToolbar, {
      props: { leafId: 1, container, visible: true, focused: true },
      attachTo: document.body,
    });

    flushListeners();
    await wrapper.vm.$nextTick();

    await wrapper.find("[data-terminal-action='paste']").trigger("click");

    await vi.waitFor(() => {
      expect(fakeTerm.paste).toHaveBeenCalledWith("hello\n");
    });
    expect(wrapper.emitted("select")).toEqual([["paste"]]);
    wrapper.unmount();
  });

  it("invokes selectAll on the terminal", async () => {
    const container = makeContainer();
    fakeTerm.getSelection.mockReturnValue("seed");
    fakeTerm.getSelectionPosition.mockReturnValue(selectionPosition());
    const wrapper = mount(TerminalSelectionToolbar, {
      props: { leafId: 1, container, visible: true, focused: true },
      attachTo: document.body,
    });

    flushListeners();
    await wrapper.vm.$nextTick();

    await wrapper.find("[data-terminal-action='select-all']").trigger("click");

    expect(fakeTerm.selectAll).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted("select")).toEqual([["selectAll"]]);
    wrapper.unmount();
  });

  it("closes when the document receives an outside pointerdown", async () => {
    const container = makeContainer();
    fakeTerm.getSelection.mockReturnValue("abc");
    fakeTerm.getSelectionPosition.mockReturnValue(selectionPosition());
    const wrapper = mount(TerminalSelectionToolbar, {
      props: { leafId: 1, container, visible: true, focused: true },
      attachTo: document.body,
    });

    flushListeners();
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-terminal-toolbar]").exists()).toBe(true);

    const outside = document.createElement("div");
    document.body.appendChild(outside);
    const event = new PointerEvent("pointerdown", { bubbles: true });
    outside.dispatchEvent(event);
    await wrapper.vm.$nextTick();

    expect(wrapper.find("[data-terminal-toolbar]").exists()).toBe(false);
    expect(wrapper.emitted("close")).toBeTruthy();
    wrapper.unmount();
  });
});
