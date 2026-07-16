import { describe, expect, it } from "vitest";
import { isMarkdownPath, resolveMonacoLanguageId } from "./languageMap";

describe("languageMap", () => {
  it("maps common code extensions to monaco language ids", () => {
    expect(resolveMonacoLanguageId("src/main.ts")).toBe("typescript");
    expect(resolveMonacoLanguageId("src/App.tsx")).toBe("typescript");
    expect(resolveMonacoLanguageId("package.json")).toBe("json");
    expect(resolveMonacoLanguageId("Cargo.toml")).toBe("ini");
    expect(resolveMonacoLanguageId("README.md")).toBe("markdown");
    expect(resolveMonacoLanguageId("script.py")).toBe("python");
    expect(resolveMonacoLanguageId("main.go")).toBe("go");
    expect(resolveMonacoLanguageId("lib.rs")).toBe("rust");
    expect(resolveMonacoLanguageId("unknown.xyz")).toBeNull();
  });

  it("recognises override filenames", () => {
    expect(resolveMonacoLanguageId("Dockerfile")).toBe("dockerfile");
    expect(resolveMonacoLanguageId(".env")).toBe("ini");
    expect(resolveMonacoLanguageId("nginx.conf")).toBe("nginx");
  });

  it("detects markdown variants", () => {
    expect(isMarkdownPath("README.md")).toBe(true);
    expect(isMarkdownPath("page.markdown")).toBe(true);
    expect(isMarkdownPath("post.mdx")).toBe(true);
    expect(isMarkdownPath("main.ts")).toBe(false);
  });
});
