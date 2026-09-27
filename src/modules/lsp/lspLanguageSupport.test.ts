import { describe, expect, it } from "vitest";
import { EditorState, Text } from "@codemirror/state";
import {
  completionInsertText,
  lspPositionToOffset,
  markupToText,
  offsetToLspPosition,
  resolveDefinitionLocations,
  toCmCompletionResult,
  toHoverText,
  wordStartAt,
} from "./lspLanguageSupport";
import type {
  LspCompletionItem,
  LspHover,
  LspLocation,
  LspLocationLink,
} from "./types";
import { fileUriToPath } from "./types";

function docOf(text: string): Text {
  return EditorState.create({ doc: text }).doc;
}

describe("LSP position ↔ CodeMirror offset", () => {
  it("ASCII 文档上的双向换算", () => {
    const doc = docOf("fn main() {\n  println!();\n}\n");
    expect(lspPositionToOffset(doc, { line: 0, character: 3 })).toBe(3);
    // 第 1 行从偏移 12 开始（"fn main() {" 11 字 + 换行），character 2 落在
    // 第二个空格上。
    expect(lspPositionToOffset(doc, { line: 1, character: 2 })).toBe(14);
    expect(offsetToLspPosition(doc, 3)).toEqual({ line: 0, character: 3 });
    expect(offsetToLspPosition(doc, 14)).toEqual({ line: 1, character: 2 });
  });

  it("CJK：character 是 UTF-16 code unit 而不是码点", () => {
    // "变量名" 三个字各占 1 个 UTF-16 unit；但 emoji 占 2 个。
    const doc = docOf("let 名 = 1;\n");
    expect(lspPositionToOffset(doc, { line: 0, character: 5 })).toBe(5);
  });

  it("emoji 占 2 个 UTF-16 unit，与 CodeMirror 偏移一致", () => {
    const doc = docOf("const 🎯 = 1;\n");
    // JS 字符串里 "const " 5 个 unit，emoji 2 个，所以 = 在偏移 8。
    expect("const 🎯".length).toBe(8);
    expect(lspPositionToOffset(doc, { line: 0, character: 8 })).toBe(8);
    expect(offsetToLspPosition(doc, 8)).toEqual({ line: 0, character: 8 });
  });

  it("越界位置被钳制到文档内而不是抛错", () => {
    const doc = docOf("abc");
    expect(lspPositionToOffset(doc, { line: 99, character: 99 })).toBe(3);
    expect(lspPositionToOffset(doc, { line: 0, character: -5 })).toBe(0);
    expect(offsetToLspPosition(doc, 999)).toEqual({ line: 0, character: 3 });
  });

  it("range 起止顺序颠倒时由调用方归一（不静默产出负区间）", () => {
    const doc = docOf("hello world");
    const from = lspPositionToOffset(doc, { line: 0, character: 8 });
    const to = lspPositionToOffset(doc, { line: 0, character: 2 });
    // 两个独立换算都落在文档内，排序交给调用方 —— 这样"谁该负责归一"
    // 在代码里是显式的，而不是藏在某个 helper 里。
    expect(Math.min(from, to)).toBe(2);
    expect(Math.max(from, to)).toBe(8);
  });
});

describe("wordStartAt", () => {
  it("往前吞掉标识符字符", () => {
    const doc = docOf("const value = 1;");
    expect(wordStartAt(doc, 10)).toBe(6);
    expect(wordStartAt(doc, 6)).toBe(6);
  });

  it("$ 结尾的标识符（PHP/JS 变量）", () => {
    const doc = docOf("$name = 1;");
    expect(wordStartAt(doc, 4)).toBe(0);
  });

  it("光标在空白处不吞任何字符", () => {
    const doc = docOf("a = b");
    expect(wordStartAt(doc, 2)).toBe(2);
  });

  it("越界偏移被钳制到文档内", () => {
    const doc = docOf("ab");
    // 钳到末尾后向前吐词，光标就在 "ab" 之后 → 词起点 0。
    expect(wordStartAt(doc, 99)).toBe(0);
  });
});

describe("completion conversion", () => {
  const item = (over: Partial<LspCompletionItem> = {}): LspCompletionItem => ({
    label: "println",
    ...over,
  });

  it("无 textEdit 时插入文本退到 insertText / label", () => {
    expect(completionInsertText(item())).toBe("println");
    expect(completionInsertText(item({ insertText: "println!" }))).toBe("println!");
  });

  it("textEdit 优先于 insertText", () => {
    const value = completionInsertText(
      item({
        insertText: "ignored",
        textEdit: {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          newText: "print",
        },
      }),
    );
    expect(value).toBe("print");
  });

  it("CompletionList → CompletionResult，from 对齐到词起点", () => {
    const doc = docOf("fn main() { pri }");
    const cursor = doc.length - 2; // "pri" 之后
    const result = toCmCompletionResult(
      doc,
      {
        isIncomplete: false,
        items: [
          { label: "println", kind: 3, detail: "fn println()" },
          { label: "print", kind: 3 },
        ],
      },
      cursor,
    );
    expect(result).not.toBeNull();
    expect(result!.from).toBe(doc.length - 5);
    expect(result!.to).toBe(cursor);
    expect(result!.options.map((o) => o.label)).toEqual(["println", "print"]);
    expect(result!.options[0]?.type).toBe("function");
  });

  it("空列表 / null 返回 null（不弹空面板）", () => {
    const doc = docOf("ab");
    expect(toCmCompletionResult(doc, { isIncomplete: false, items: [] }, 2)).toBeNull();
    expect(toCmCompletionResult(doc, null, 2)).toBeNull();
  });

  it("也接受裸数组形态（老 server 直接返回 item[]）", () => {
    const doc = docOf("ab");
    const result = toCmCompletionResult(doc, [item()], 2);
    expect(result?.options).toHaveLength(1);
  });

  it("文档字段接受 string 与 MarkupContent 两种形态", () => {
    const doc = docOf("ab");
    const fromString = toCmCompletionResult(doc, [
      item({ documentation: "docs string" }),
    ], 2);
    expect(fromString?.options[0]?.info).toBe("docs string");
    const fromMarkup = toCmCompletionResult(doc, [
      item({ documentation: { kind: "markdown", value: "**docs**" } }),
    ], 2);
    expect(fromMarkup?.options[0]?.info).toBe("**docs**");
  });

  it("kind 映射到 CodeMirror 的图标简写", () => {
    const doc = docOf("ab");
    const result = toCmCompletionResult(
      doc,
      [
        item({ label: "a", kind: 5 }), // Field
        item({ label: "b", kind: 12 }), // Keyword
        item({ label: "c", kind: 7 }), // Class
        item({ label: "d", kind: 999 }), // 未知
      ],
      2,
    );
    expect(result?.options.map((o) => o.type)).toEqual([
      "property",
      "keyword",
      "class",
      undefined,
    ]);
  });
});

describe("hover conversion", () => {
  const hover = (contents: LspHover["contents"]): LspHover => ({ contents });

  it("string 形态", () => {
    expect(toHoverText(hover("fn foo() -> u32"))).toBe("fn foo() -> u32");
  });

  it("MarkupContent 形态", () => {
    expect(
      toHoverText(hover({ kind: "markdown", value: "```rust\nfn foo()\n```" })),
    ).toBe("fn foo()");
  });

  it("数组形态拼接", () => {
    expect(
      toHoverText(hover(["first", { kind: "plaintext", value: "second" }])),
    ).toBe("first\n\nsecond");
  });

  it("行内代码标记被剥掉", () => {
    expect(toHoverText(hover("uses `Vec<T>` here"))).toBe("uses Vec<T> here");
  });

  it("空 / null 内容返回 null", () => {
    expect(toHoverText(null)).toBeNull();
    expect(toHoverText(hover(""))).toBeNull();
    expect(toHoverText(hover("   "))).toBeNull();
  });

  it("markupToText 处理 string 与对象两种形态", () => {
    expect(markupToText("a")).toBe("a");
    expect(markupToText({ kind: "plaintext", value: "b" })).toBe("b");
  });
});

describe("definition resolution", () => {
  it("单条 Location", () => {
    const location: LspLocation = {
      uri: "file:///repo/src/lib.rs",
      range: {
        start: { line: 41, character: 8 },
        end: { line: 41, character: 14 },
      },
    };
    expect(resolveDefinitionLocations(location, fileUriToPath)).toEqual({
      path: "/repo/src/lib.rs",
      line: 41,
      character: 8,
    });
  });

  it("Location[] 取第一条", () => {
    const locations: LspLocation[] = [
      {
        uri: "file:///repo/a.ts",
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } },
      },
      {
        uri: "file:///repo/b.ts",
        range: { start: { line: 2, character: 0 }, end: { line: 2, character: 1 } },
      },
    ];
    expect(resolveDefinitionLocations(locations, fileUriToPath)?.path).toBe(
      "/repo/a.ts",
    );
  });

  it("LocationLink 取 targetSelectionRange（定义体而非整体范围）", () => {
    const link: LspLocationLink = {
      targetUri: "file:///repo/types.ts",
      targetRange: {
        start: { line: 10, character: 0 },
        end: { line: 20, character: 0 },
      },
      targetSelectionRange: {
        start: { line: 10, character: 6 },
        end: { line: 20, character: 0 },
      },
    };
    expect(resolveDefinitionLocations([link], fileUriToPath)).toEqual({
      path: "/repo/types.ts",
      line: 10,
      character: 6,
    });
  });

  it("null / 空数组返回 null", () => {
    expect(resolveDefinitionLocations(null, fileUriToPath)).toBeNull();
    expect(resolveDefinitionLocations(undefined, fileUriToPath)).toBeNull();
    expect(resolveDefinitionLocations([], fileUriToPath)).toBeNull();
  });
});

describe("fileUriToPath", () => {
  it("unix 路径 + 百分号解码", () => {
    expect(fileUriToPath("file:///repo/src/main%20file.rs")).toBe(
      "/repo/src/main file.rs",
    );
  });

  it("中文路径解码", () => {
    expect(fileUriToPath("file:///repo/%E6%96%87%E4%BB%B6.md")).toBe(
      "/repo/文件.md",
    );
  });

  it("Windows 盘符路径去掉多余的首个斜杠", () => {
    expect(fileUriToPath("file:///C:/repo/a.ts")).toBe("C:/repo/a.ts");
  });

  it("非法百分号编码不抛错，原样返回", () => {
    expect(fileUriToPath("file:///repo/100%.rs")).toBe("/repo/100%.rs");
  });

  it("非 file:// 的 uri 原样返回", () => {
    expect(fileUriToPath("jdt://contents/foo")).toBe("jdt://contents/foo");
  });
});
