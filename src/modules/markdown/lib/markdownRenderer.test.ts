import { describe, expect, it } from "vitest";
import { renderMarkdownToHtml } from "./markdownRenderer";

describe("markdown renderer", () => {
  it("renders common markdown blocks and inline code", () => {
    const html = renderMarkdownToHtml([
      "# Readme",
      "",
      "Use `pnpm test` before shipping.",
      "",
      "```ts",
      "const value = 1;",
      "```",
    ].join("\n"));

    expect(html).toContain("<h1");
    expect(html).toContain("Readme");
    expect(html).toContain("<code>pnpm test</code>");
    expect(html).toContain("const value = 1;");
  });

  it("escapes raw html instead of injecting it into the preview", () => {
    const html = renderMarkdownToHtml("<img src=x onerror=alert(1)>");

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});
