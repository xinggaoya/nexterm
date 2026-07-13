import { describe, expect, it } from "vitest";
import { handleOscData } from "./osc";

describe("OSC parsing", () => {
  it("strips OSC 7 cwd sequences and reports the cwd", () => {
    const before = handleOscData("hello\x1b]7;file://host/tmp/path\x07world", "");
    expect(before.pendingBuffer).toBe("");
    expect(before.events).toEqual([{ type: "cwd", value: "/tmp/path" }]);
    expect(before.cleaned).toBe("helloworld");
  });

  it("strips OSC 0 title sequences and reports the title", () => {
    const before = handleOscData("\x1b]0;hello\x07tail", "");
    expect(before.events).toEqual([{ type: "title", value: "hello" }]);
    expect(before.cleaned).toBe("tail");
  });

  it("ignores OSC payloads with unknown codes", () => {
    const before = handleOscData("\x1b]99;ping\x07ok", "");
    expect(before.events).toEqual([]);
    expect(before.cleaned).toBe("ok");
  });

  it("normalises Windows-style file:// URLs by stripping the leading slash", () => {
    const before = handleOscData("\x1b]7;file://host/C:/Users\x07", "");
    expect(before.events).toEqual([{ type: "cwd", value: "C:/Users" }]);
  });

  it("preserves OSC sequences that span a chunk boundary", () => {
    const first = handleOscData("pre\x1b]7;file://host/tmp", "");
    expect(first.pendingBuffer).toContain("\x1b");
    expect(first.events).toEqual([]);
    expect(first.cleaned).toBe("pre");

    const second = handleOscData("/more\x07post", first.pendingBuffer);
    expect(second.events).toEqual([{ type: "cwd", value: "/tmp/more" }]);
    expect(second.cleaned).toBe("post");
  });

  it("drops unknown OSC 7 host paths entirely", () => {
    const before = handleOscData("\x1b]7;not-a-url\x07", "");
    expect(before.events).toEqual([]);
    expect(before.cleaned).toBe("");
  });
});
