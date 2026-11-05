import { describe, expect, it } from "vitest";
import { fileIconUrl, folderIconUrl } from "./fileIcon";

/** 通用回落图标的 data-URL（未知类型都长这样）。 */
function genericFileIcon(): string {
  return fileIconUrl("__definitely_not_a_real_file__");
}

describe("icons module · fileIconUrl", () => {
  it("resolves common file types to distinct icons", () => {
    const urls = [
      fileIconUrl("main.rs"),
      fileIconUrl("package.json"),
      fileIconUrl("app.vue"),
      fileIconUrl("AGENTS.md"),
      fileIconUrl("index.ts"),
      fileIconUrl("main.py"),
    ];

    for (const url of urls) {
      expect(url).not.toBe(genericFileIcon());
      expect(url.startsWith("data:image/svg+xml")).toBe(true);
    }
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("falls back to the generic file icon for unknown types", () => {
    expect(fileIconUrl("__definitely_not_a_real_file__")).toBe(genericFileIcon());
    expect(fileIconUrl("")).toBe(genericFileIcon());
  });

  it("matches extension-less files by their exact name", () => {
    // Makefile / Dockerfile 没有扩展名，只能靠文件名映射命中具体图标。
    expect(fileIconUrl("Makefile")).not.toBe(genericFileIcon());
    expect(fileIconUrl("Dockerfile")).not.toBe(genericFileIcon());
    expect(fileIconUrl("LICENSE")).not.toBe(genericFileIcon());
  });

  it("matches dot-files by their exact name", () => {
    expect(fileIconUrl(".gitignore")).not.toBe(genericFileIcon());
    expect(fileIconUrl(".env")).not.toBe(genericFileIcon());
  });

  it("resolves compound extensions by falling back segment by segment", () => {
    expect(fileIconUrl("archive.tar.gz")).not.toBe(genericFileIcon());
    expect(fileIconUrl("archive.tar.gz")).toBe(fileIconUrl("archive.gz"));
  });

  it("accepts a full path and resolves it like its basename", () => {
    expect(fileIconUrl("apps/cli/package.json")).toBe(
      fileIconUrl("package.json"),
    );
    expect(fileIconUrl("apps/cli/package.json")).not.toBe(genericFileIcon());
    expect(fileIconUrl("packages/agent/src/main.rs")).toBe(
      fileIconUrl("main.rs"),
    );
  });

  it("is case insensitive", () => {
    expect(fileIconUrl("README.MD")).toBe(fileIconUrl("README.md"));
    expect(fileIconUrl("Main.RS")).toBe(fileIconUrl("main.rs"));
  });
});

describe("icons module · folderIconUrl", () => {
  it("uses a different icon for the expanded state", () => {
    expect(folderIconUrl("src", false)).not.toBe(folderIconUrl("src", true));
  });

  it("falls back to the generic folder icon for unknown directories", () => {
    const generic = folderIconUrl("__no_such_dir__", false);
    expect(folderIconUrl("__no_such_dir__", true)).not.toBe(generic);
    expect(generic.startsWith("data:image/svg+xml")).toBe(true);
  });

  it("accepts a full path and resolves it like its basename", () => {
    expect(folderIconUrl("apps/cli", false)).toBe(folderIconUrl("cli", false));
  });
});
