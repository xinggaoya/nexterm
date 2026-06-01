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

  it("strips javascript: and data: from link hrefs but keeps the visible text", () => {
    const html = renderMarkdownToHtml(
      "[click](javascript:alert(1)) and [pdf](data:text/html,<script>alert(1)</script>)",
    );

    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:text/html");
    expect(html).toContain("click");
    expect(html).toContain("pdf");
    // The dangerous hrefs must not be emitted as anchor attributes.
    expect(html).not.toMatch(/href="[^"]*(?:javascript|data):/i);
  });

  it("rejects hrefs whose scheme is hidden behind leading whitespace or control bytes", () => {
    // Real-world browsers historically stripped leading whitespace and C0
    // control bytes before evaluating a scheme, so `\tjavascript:` and
    // `  javascript:` both resolve to `javascript:`. We must reject them
    // even though the URL string contains literal control characters.
    const html = renderMarkdownToHtml("[boom](\tjavascript:alert(1))");
    expect(html).not.toContain("javascript:");
    expect(html).not.toMatch(/href="[^"]*javascript:/i);
  });

  it("drops unknown schemes (file:, ssh:) and refuses them as anchors", () => {
    const html = renderMarkdownToHtml("[local](file:///etc/passwd) and [ssh](ssh://host)");
    expect(html).not.toMatch(/href="[^"]*file:/i);
    expect(html).not.toMatch(/href="[^"]*ssh:/i);
    expect(html).toContain("local");
    expect(html).toContain("ssh");
  });

  it("preserves safe http/https/mailto anchors with rel and target hardening", () => {
    const html = renderMarkdownToHtml(
      "[docs](https://example.com) and [mail](mailto:a@b.co)",
    );
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('href="mailto:a@b.co"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  it("replaces image tags whose src is a dangerous scheme with a safe placeholder", () => {
    const html = renderMarkdownToHtml("![evil](javascript:alert(1))");
    expect(html).not.toMatch(/src="[^"]*javascript:/i);
    expect(html).toContain("blocked: unsafe image source");
  });
});
