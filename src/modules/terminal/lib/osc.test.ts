import { describe, expect, it } from "vitest";
import { handleOscData, sanitizeHyperlinkUri } from "./osc";

describe("osc handling", () => {
  it("keeps cwd and title parsing working", () => {
    const r1 = handleOscData("\x1b]7;file:///home/xinggao\x07", "");
    expect(r1.cleaned).toBe("");
    expect(r1.events).toEqual([{ type: "cwd", value: "/home/xinggao" }]);

    const r2 = handleOscData("\x1b]2;my title\x07", "");
    expect(r2.cleaned).toBe("");
    expect(r2.events).toEqual([{ type: "title", value: "my title" }]);
  });

  it("parses OSC 8 hyperlink with id param", () => {
    const r = handleOscData(
      "\x1b]8;id=link1;https://example.com\x07click me\x1b]8;;\x07",
      "",
    );
    // 只有开 hyperlink 产生事件;关闭序列(\x1b]8;;\x07)无 URI 不会产生事件
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toEqual({
      type: "hyperlink",
      value: { uri: "https://example.com/", params: "id=link1" },
    });
    // cleaned 保留普通字符,所有 OSC 字节被剥离
    expect(r.cleaned).toBe("click me");
  });

  it("strips unsafe URIs from OSC 8", () => {
    const r = handleOscData("\x1b]8;;javascript:alert(1)\x07x\x07", "");
    expect(r.events).toHaveLength(0);
  });

  it("preserves pending OSC bytes across chunks", () => {
    const r1 = handleOscData("\x1b]2;partial ti", "");
    expect(r1.cleaned).toBe("");
    expect(r1.pendingBuffer).toBe("\x1b]2;partial ti");
    expect(r1.events).toEqual([]);

    const r2 = handleOscData("tle\x07", r1.pendingBuffer);
    expect(r2.cleaned).toBe("");
    expect(r2.events).toEqual([{ type: "title", value: "partial title" }]);
    expect(r2.pendingBuffer).toBe("");
  });

  it("sanitizeHyperlinkUri accepts http(s)/file/ssh/vscode and rejects others", () => {
    expect(sanitizeHyperlinkUri("https://example.com")).toBe(
      "https://example.com/",
    );
    expect(sanitizeHyperlinkUri("http://localhost:8080/x")).toBe(
      "http://localhost:8080/x",
    );
    expect(sanitizeHyperlinkUri("file:///home/x/a.txt")).toBe(
      "file:///home/x/a.txt",
    );
    // ssh URL: 新版 Node URL 不会自动补 trailing slash
    expect(sanitizeHyperlinkUri("ssh://user@host")).toMatch(/^ssh:\/\//);
    expect(sanitizeHyperlinkUri("javascript:alert(1)")).toBe("");
    expect(sanitizeHyperlinkUri("data:text/plain,foo")).toBe("");
    expect(sanitizeHyperlinkUri("")).toBe("");
    expect(sanitizeHyperlinkUri("  https://ok  ")).toBe("https://ok/");
  });
});