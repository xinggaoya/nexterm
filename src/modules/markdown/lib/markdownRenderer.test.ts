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

  it("blocks attribute-breaking payloads smuggled through a data: image src", () => {
    // marked 的 image tokenizer 不转义 href 中的 `"`，所以
    // `data:image/png"onerror="alert(1)` 会渲染成
    // `<img src="data:image/png"onerror="alert(1)">` —— onerror 在
    // webview 主 origin 里直接执行。data: 分支必须走整体白名单。
    const html = renderMarkdownToHtml('![x](data:image/png"onerror="alert(1))');

    expect(html).not.toContain("onerror");
    expect(html).not.toMatch(/<img[^>]*\son[a-z]+\s*=/i);
    expect(html).toContain("blocked: unsafe image source");
  });

  it("blocks data: payloads that merely start with an image mime type", () => {
    const cases = [
      "data:image/svg+xml,<svg onload=alert(1)>",
      "data:image/png,notbase64",
      "data:image/png;base64,%%%not-base64%%%",
      "data:text/html,<script>alert(1)</script>",
    ];
    for (const payload of cases) {
      const html = renderMarkdownToHtml(`![x](${payload})`);
      // 有的 payload 会被 marked 整体判成非图片语法（直接输出转义文本），
      // 有的会走 image renderer 并落到 blocked 占位符。两种都安全，
      // 这里只断言安全性质：不产生可执行的 <img>。
      expect(html, payload).not.toContain("<img");
      expect(html, payload).not.toMatch(/<[a-z]+[^>]*\son[a-z]+\s*=/i);
      expect(html, payload).not.toContain("<script");
    }
  });

  it("still renders legitimate inline base64 images", () => {
    const onePixel =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const html = renderMarkdownToHtml(`![dot](${onePixel})`);

    expect(html).toContain("<img src=\"data:image/png;base64,");
    expect(html).toContain('alt="dot"');
    expect(html).not.toContain("blocked");
  });
});
