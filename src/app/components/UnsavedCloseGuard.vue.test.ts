// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import { NDialogProvider } from "naive-ui";
import { nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UnsavedCloseGuard from "./UnsavedCloseGuard.vue";
import type { Tab } from "@/modules/tabs/tabsTypes";

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
    },
  };
});

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => windowMock.currentWindow,
}));

const dirtyEditorTabs: Tab[] = [
  {
    id: 1,
    kind: "terminal",
    title: "shell",
    paneTree: { kind: "leaf", id: 2 },
    activeLeafId: 2,
  },
  {
    id: 3,
    kind: "editor",
    title: "main.ts",
    path: "/repo/src/main.ts",
    dirty: true,
    preview: false,
  },
];

function exitButton(): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("Exit Without Saving"),
  );
}

describe("UnsavedCloseGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    windowMock.closeRequestedHandlers.length = 0;
    document.body.innerHTML = "";
    (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  });

  it("confirms before allowing the native window to close with dirty editors", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const wrapper = mount(
      {
        components: { NDialogProvider, UnsavedCloseGuard },
        setup() {
          return { tabs: dirtyEditorTabs };
        },
        template:
          "<NDialogProvider><UnsavedCloseGuard :tabs=\"tabs\" /></NDialogProvider>",
      },
      { attachTo: host },
    );

    try {
      await nextTick();
      await flushPromises();

      const preventDefault = vi.fn();
      await windowMock.closeRequestedHandlers[0]?.({ preventDefault });
      await nextTick();
      await flushPromises();

      expect(preventDefault).toHaveBeenCalledTimes(1);
      expect(windowMock.currentWindow.close).not.toHaveBeenCalled();
      expect(document.body.textContent).toContain("Exit with unsaved files?");
      expect(document.body.textContent).toContain("main.ts");

      exitButton()?.click();
      await nextTick();
      await flushPromises();

      expect(windowMock.currentWindow.close).toHaveBeenCalledTimes(1);

      const secondPreventDefault = vi.fn();
      await windowMock.closeRequestedHandlers[0]?.({
        preventDefault: secondPreventDefault,
      });

      expect(secondPreventDefault).not.toHaveBeenCalled();
    } finally {
      wrapper.unmount();
      host.remove();
      delete (window as typeof window & { __TAURI_INTERNALS__?: unknown })
        .__TAURI_INTERNALS__;
    }
  });
});
