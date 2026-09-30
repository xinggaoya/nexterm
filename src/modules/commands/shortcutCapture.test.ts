// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isTerminalInputSurface, isTextEntryTarget } from "./shortcutTarget";

describe("shortcut target classification", () => {
  it("does not treat the terminal helper textarea as a text-entry field", () => {
    // 这是 P0-1 的核心：xterm 用隐藏 textarea 接收键盘。若把它当普通
    // textarea，所有全局快捷键在终端里都会被放行成裸字节发给 PTY。
    const host = document.createElement("div");
    host.className = "xterm";
    const textarea = document.createElement("textarea");
    textarea.className = "xterm-helper-textarea";
    host.appendChild(textarea);
    document.body.appendChild(host);

    expect(isTerminalInputSurface(textarea)).toBe(true);
    expect(isTextEntryTarget(textarea)).toBe(false);

    const input = document.createElement("input");
    document.body.appendChild(input);
    expect(isTextEntryTarget(input)).toBe(true);
    expect(isTerminalInputSurface(input)).toBe(false);

    document.body.removeChild(host);
    document.body.removeChild(input);
  });
});
