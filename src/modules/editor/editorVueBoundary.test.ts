import { existsSync, readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
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
    ];

    expect(
      legacyFiles.filter((file) => existsSync(new URL(file, editorRoot))),
    ).toEqual([]);
  });
});

describe("CodeMirror 6 boundary guard", () => {
  it("does not keep Monaco artifacts in src/modules/editor/", () => {
    const files = [
      "DiffEditor.vue",
      "lib/editorConfig.ts",
      "lib/languageMap.ts",
      "lib/languageMap.test.ts",
    ];
    const offenders = files.filter((f) => existsSync(new URL(f, editorRoot)));
    expect(offenders).toEqual([]);
  });

  it("keeps the CodeMirror runtime layer files in place", () => {
    const files = [
      "DiffCodeMirror.vue",
      "lib/extensions.ts",
      "lib/languageResolver.ts",
      "lib/themes.ts",
      "lib/vim.ts",
      "lib/editorRuntime.ts",
    ];
    const missing = files.filter((f) => !existsSync(new URL(f, editorRoot)));
    expect(missing).toEqual([]);
  });

  it("uses DiffCodeMirror instead of the Monaco DiffEditor in GitDiffPane", () => {
    const source = readFileSync(
      new URL("./GitDiffPane.vue", editorRoot),
      "utf8",
    );
    expect(source).toContain("DiffCodeMirror");
    expect(source).not.toContain("DiffEditor");
  });

  it("resolves languages through languageResolver, not a static id map", () => {
    const libFiles = readdirSync(new URL("./lib/", editorRoot));
    expect(libFiles).toContain("languageResolver.ts");
    expect(libFiles).not.toContain("languageMap.ts");
  });

  it("does not import monaco anywhere in the editor module or vite config", () => {
    const sources = [
      "EditorPane.vue",
      "DiffCodeMirror.vue",
      "GitDiffPane.vue",
      "lib/editorRuntime.ts",
      "lib/extensions.ts",
      "lib/themes.ts",
      "lib/vim.ts",
      "lib/editorPaneLsp.ts",
      "../../../vite.config.ts",
    ];
    const offenders = sources
      .map((f) => readFileSync(new URL(f, editorRoot), "utf8"))
      .filter((source) => /monaco/i.test(source));
    expect(offenders).toEqual([]);
  });
});
