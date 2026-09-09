import { describe, expect, it } from "vitest";

import { buildHighlightSegments, escapeRegExp } from "./highlight";

describe("escapeRegExp", () => {
  it("转义全部正则元字符", () => {
    expect(escapeRegExp("a.b(c)d[e]f{g}h*i+j?k$l^m|n\\o")).toBe(
      "a\\.b\\(c\\)d\\[e\\]f\\{g\\}h\\*i\\+j\\?k\\$l\\^m\\|n\\\\o",
    );
  });

  it("普通字符原样返回", () => {
    expect(escapeRegExp("foo-bar_baz")).toBe("foo-bar_baz");
  });
});

describe("buildHighlightSegments", () => {
  it("字面量模式按大小写不敏感子串切分", () => {
    const segments = buildHighlightSegments("Foo foo FOO", "foo", {
      caseInsensitive: true,
    });
    expect(segments).toEqual([
      { text: "Foo", hit: true },
      { text: " ", hit: false },
      { text: "foo", hit: true },
      { text: " ", hit: false },
      { text: "FOO", hit: true },
    ]);
  });

  it("字面量模式不解释正则元字符", () => {
    const segments = buildHighlightSegments("a.b axb", ".", {});
    expect(segments).toEqual([
      { text: "a", hit: false },
      { text: ".", hit: true },
      { text: "b axb", hit: false },
    ]);
  });

  it("正则模式按表达式匹配", () => {
    const segments = buildHighlightSegments("foo123bar", "foo\\d+", {
      regex: true,
    });
    expect(segments).toEqual([
      { text: "foo123", hit: true },
      { text: "bar", hit: false },
    ]);
  });

  it("非法正则返回 null(整行不高亮)", () => {
    expect(buildHighlightSegments("text", "[unclosed", { regex: true })).toBeNull();
  });

  it("零长匹配不死循环", () => {
    const segments = buildHighlightSegments("ab", "a*", { regex: true });
    expect(segments).toEqual([
      { text: "a", hit: true },
      { text: "b", hit: false },
    ]);
  });

  it("无命中返回 null", () => {
    expect(buildHighlightSegments("abc", "xyz")).toBeNull();
  });

  it("空 pattern 返回 null", () => {
    expect(buildHighlightSegments("abc", "")).toBeNull();
  });
});
