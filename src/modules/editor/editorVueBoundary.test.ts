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

describe("monaco boundary guard", () => {
  it("does not keep CodeMirror artifacts in src/modules/editor/", () => {
    const files = [
      "DiffCodeMirror.vue",
      "lib/extensions.ts",
      "lib/languageResolver.ts",
      "lib/languageResolver.test.ts",
    ];
    const offenders = files.filter((f) =>
      existsSync(new URL(f, editorRoot)),
    );
    expect(offenders).toEqual([]);
  });

  it("uses DiffEditor (monaco) instead of DiffCodeMirror in GitDiffPane", () => {
    const source = readFileSync(
      new URL("./GitDiffPane.vue", editorRoot),
      "utf8",
    );
    expect(source).toContain("DiffEditor");
    expect(source).not.toContain("DiffCodeMirror");
  });

  it("uses languageMap for monaco language resolution, not ad-hoc loaders", () => {
    const libFiles = readdirSync(new URL("./lib/", editorRoot));
    expect(libFiles).toContain("languageMap.ts");
    expect(libFiles).not.toContain("languageResolver.ts");
  });

  it("resolves monaco-vim through its ESM entry in the browser", () => {
    const viteConfig = readFileSync(
      new URL("../../../vite.config.ts", editorRoot),
      "utf8",
    );

    expect(viteConfig).toContain(
      'path.resolve(__dirname, "./node_modules/monaco-vim/dist/index.mjs")',
    );
  });
});
