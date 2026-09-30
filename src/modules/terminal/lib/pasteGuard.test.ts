import { describe, expect, it } from "vitest";
import {
  MULTILINE_PASTE_WARN_LINES,
  classifyPaste,
  needsPasteConfirmation,
} from "./pasteGuard";

describe("classifyPaste", () => {
  it("treats single-line text as safe", () => {
    expect(classifyPaste("ls -la")).toEqual({ kind: "single-line" });
    expect(classifyPaste("")).toEqual({ kind: "empty" });
  });

  it("does not warn about a trailing newline alone", () => {
    // 编辑器复制带一个结尾换行是常态，为此弹窗只会把人训练成无脑点确认。
    expect(classifyPaste("git status\n")).toEqual({ kind: "single-line" });
    expect(classifyPaste("git status\r\n\r\n")).toEqual({ kind: "single-line" });
  });

  it("counts effective lines once trailing blanks are stripped", () => {
    expect(classifyPaste("a\nb\nc\n\n\n")).toEqual({
      kind: "multiline",
      lines: 3,
    });
  });

  it("never warns for a bracketed-selection paste", () => {
    // 有选区时是按行终止符（Ctrl+C）粘贴，用户在删东西，不该被打断。
    const risk = classifyPaste("a\nb\nc\nd\ne\nf\ng", {
      isBracketedSelection: true,
    });
    expect(risk.kind).toBe("from-selection");
    expect(needsPasteConfirmation(risk)).toBe(false);
  });

  it("treats content that is only newlines as single-line", () => {
    expect(classifyPaste("\n\n\n")).toEqual({ kind: "single-line" });
  });
});

describe("needsPasteConfirmation", () => {
  it("only warns for genuinely large blocks", () => {
    // 2~3 行的短命令片段无风险，不该打断。
    const short = Array.from({ length: MULTILINE_PASTE_WARN_LINES - 1 }, (_, i) =>
      `line ${i}`,
    ).join("\n");
    expect(needsPasteConfirmation(classifyPaste(short))).toBe(false);

    const long = Array.from({ length: MULTILINE_PASTE_WARN_LINES }, (_, i) =>
      `line ${i}`,
    ).join("\n");
    expect(needsPasteConfirmation(classifyPaste(long))).toBe(true);
  });

  it("never warns on the safe paths", () => {
    expect(needsPasteConfirmation(classifyPaste(""))).toBe(false);
    expect(needsPasteConfirmation(classifyPaste("npm run dev"))).toBe(false);
  });
});
