import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const editorRoot = new URL(".", import.meta.url);

describe("standard editor Vue boundary", () => {
  it("does not keep the legacy React editor pane or stack", () => {
    const legacyFiles = [
      "EditorPane.tsx",
      "EditorStack.tsx",
      "EditorStackLazy.tsx",
      "lib/useDocument.ts",
    ];

    expect(
      legacyFiles.filter((file) => existsSync(new URL(file, editorRoot))),
    ).toEqual([]);
  });

  it("does not export the standard editor through React lazy wrappers", () => {
    const indexSource = readFileSync(new URL("./index.ts", editorRoot), "utf8");

    expect(indexSource).not.toContain("EditorStackLazy");
    expect(indexSource).not.toContain("./EditorPane");
  });

  it("does not keep React diff panes or lazy wrappers", () => {
    const legacyFiles = [
      "GitDiffPane.tsx",
      "GitDiffStack.tsx",
      "GitDiffStackLazy.tsx",
      "AiDiffPane.tsx",
      "AiDiffStack.tsx",
      "AiDiffStackLazy.tsx",
    ];

    expect(
      legacyFiles.filter((file) => existsSync(new URL(file, editorRoot))),
    ).toEqual([]);
  });
});
