// @vitest-environment jsdom
import type { Terminal } from "@xterm/xterm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const clipboardMocks = vi.hoisted(() => ({
  readClipboardText: vi.fn(),
  writeClipboardText: vi.fn(),
}));

vi.mock("@/lib/clipboard", () => clipboardMocks);

import {
  attachClipboardShortcuts,
  pasteClipboardIntoTerminal,
} from "./shortcuts";

function createTerminalDouble() {
  let handler: ((event: KeyboardEvent) => boolean) | undefined;
  const term = {
    attachCustomKeyEventHandler: vi.fn(
      (next: (event: KeyboardEvent) => boolean) => {
        handler = next;
      },
    ),
    getSelection: vi.fn(() => "selected text"),
    paste: vi.fn(),
  };
  return {
    term: term as unknown as Terminal,
    getHandler: () => handler,
  };
}

describe("terminal clipboard shortcuts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clipboardMocks.readClipboardText.mockResolvedValue("");
    clipboardMocks.writeClipboardText.mockResolvedValue(undefined);
  });

  it("routes multiline clipboard input through xterm paste", async () => {
    const { term } = createTerminalDouble();
    const text = "first line\n\nsecond line";
    clipboardMocks.readClipboardText.mockResolvedValue(text);

    await pasteClipboardIntoTerminal(term);

    expect(term.paste).toHaveBeenCalledWith(text);
  });

  it("handles Ctrl+Shift+V independently from context menu settings", async () => {
    const { term, getHandler } = createTerminalDouble();
    clipboardMocks.readClipboardText.mockResolvedValue("one\ntwo");
    attachClipboardShortcuts({ term });
    const event = new KeyboardEvent("keydown", {
      key: "v",
      ctrlKey: true,
      shiftKey: true,
      cancelable: true,
    });

    expect(getHandler()?.(event)).toBe(false);
    await vi.waitFor(() => {
      expect(term.paste).toHaveBeenCalledWith("one\ntwo");
    });
    expect(event.defaultPrevented).toBe(true);
  });

  it("copies the active selection with Ctrl+Shift+C", async () => {
    const { term, getHandler } = createTerminalDouble();
    attachClipboardShortcuts({ term });
    const event = new KeyboardEvent("keydown", {
      key: "c",
      ctrlKey: true,
      shiftKey: true,
      cancelable: true,
    });

    expect(getHandler()?.(event)).toBe(false);
    await vi.waitFor(() => {
      expect(clipboardMocks.writeClipboardText).toHaveBeenCalledWith(
        "selected text",
      );
    });
  });
});
