// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderMarkdownToHtml } from "./markdownRenderer";

describe("markdown renderer", () => {
  it("renders common markdown blocks and inline code", () => {
    const html = renderMarkdownToHtml([
      "# Readme",
      "",
      "Use `pnpm test` before shipping.",
      "",
      "```",
      "const value = 1;",
      "```",
    ].join("\n"));

    expect(html).toContain("<h1");
    expect(html).toContain("Readme");
    expect(html).toContain("<code>pnpm test</code>");
    expect(html).toContain("const value = 1;");
  });

  it("renders GitHub-style raw html instead of dumping it as source", () => {
    // README 顶部的居中徽章块是原始 HTML —— GitHub 会渲染，预览也必须渲染。
    const html = renderMarkdownToHtml(
      '<p align="center"><a href="https://github.com/xinggaoya/coda"><strong>Coda</strong></a></p>',
    );

    expect(html).toContain('align="center"');
    expect(html).toContain("<strong>Coda</strong>");
    expect(html).toContain('href="https://github.com/xinggaoya/coda"');
    expect(html).not.toContain("&lt;p");
  });

  it("strips event handlers and scripts from raw html", () => {
    const html = renderMarkdownToHtml(
      '<img src="x.png" onerror="alert(1)">\n\n<script>alert(1)</script>',
    );

    expect(html).not.toContain("onerror");
    expect(html).not.toContain("<script");
    expect(html).not.toMatch(/<[a-z]+[^>]*\son[a-z]+\s*=/i);
  });

  it("drops dangerous elements together with their content", () => {
    const html = renderMarkdownToHtml("<script>alert(1)</script>");

    expect(html).not.toContain("alert(1)");
    expect(html).not.toContain("<script");
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

  it("refuses images whose src uses a dangerous scheme", () => {
    // 协议白名单在渲染层执行：危险协议的图片换成占位符，不产生 <img>。
    const html = renderMarkdownToHtml("![evil](javascript:alert(1))");
    expect(html).not.toContain("<img");
    expect(html).not.toMatch(/src="[^"]*javascript:/i);
    expect(html).toContain("blocked: unsafe image source");
  });

  it("replaces images with an unlisted scheme by a safe placeholder", () => {
    // ssh: / ftp 这类协议不在本项目的协议白名单里，由渲染层换成占位符，
    // 不让 webview 去加载未知协议的 URL。
    const html = renderMarkdownToHtml("![evil](ssh://host/x.png)");
    expect(html).not.toContain("<img");
    expect(html).not.toMatch(/src="[^"]*ssh:/i);
    expect(html).toContain("blocked: unsafe image source");
  });

  it("blocks attribute-breaking payloads smuggled through a data: image src", () => {
    // data: 不是整体匹配白名单时不会拼出
    // `<img src="data:image/png"onerror="alert(1)">` ——
    // onerror 在 webview 主 origin 里能直接执行。
    const html = renderMarkdownToHtml('![x](data:image/png"onerror="alert(1))');

    expect(html).not.toContain("<img");
    expect(html).not.toMatch(/<img[^>]*\son[a-z]+\s*=/i);
    expect(html).not.toMatch(/<[a-z]+[^>]*\son[a-z]+\s*=/i);
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
      // 有的 payload 会被整体判成非图片语法（直接输出转义文本），
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

  it("renders GFM tables with a header row", () => {
    const html = renderMarkdownToHtml(
      ["| 平台 | 下载 |", "| --- | --- |", "| Windows x64 | app.exe |"].join("\n"),
    );

    expect(html).toContain("<table>");
    expect(html).toContain("<th>平台</th>");
    expect(html).toContain("<td>app.exe</td>");
  });

  it("renders task lists with disabled checkboxes", () => {
    const html = renderMarkdownToHtml("- [ ] todo\n- [x] done");

    expect(html).toContain("task-list-item");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("disabled");
    expect(html).toContain("checked");
  });

  it("renders footnotes with a footnote section", () => {
    const html = renderMarkdownToHtml("Body[^1]\n\n[^1]: The note.");

    expect(html).toContain("footnote-ref");
    expect(html).toContain("footnotes");
    expect(html).toContain("The note.");
  });

  it("renders GFM alerts with the configured title", () => {
    const html = renderMarkdownToHtml(
      "> [!NOTE]\n> Heads up.",
      { alertTitles: { note: "注意" } },
    );

    expect(html).toContain("markdown-alert");
    expect(html).toContain("markdown-alert-note");
    expect(html).toContain("注意");
    expect(html).toContain("Heads up.");
  });

  it("adds heading anchors with GitHub-style slugs", () => {
    const html = renderMarkdownToHtml("## 安装 指南");

    expect(html).toContain('id="安装-指南"');
    expect(html).toContain("md-heading-anchor");
  });

  it("highlights fenced code and exposes the language label", () => {
    const html = renderMarkdownToHtml(
      "```js\nconst value = 1;\n```",
    );

    expect(html).toContain("md-code");
    expect(html).toContain("md-code-lang");
    expect(html).toContain("js");
    // highlight.js 的分色标记。
    expect(html).toContain("hljs-keyword");
  });

  it("keeps unknown fenced languages as plain escaped text", () => {
    const html = renderMarkdownToHtml("```notalanguage\n<b>raw</b>\n```");

    expect(html).toContain("notalanguage");
    expect(html).toContain("&lt;b&gt;raw&lt;/b&gt;");
    expect(html).not.toContain("hljs-");
  });

  it("escapes code block content instead of executing it", () => {
    const html = renderMarkdownToHtml("```\n<script>alert(1)</script>\n```");

    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
  });

  it("adds a copy control to fenced code blocks", () => {
    const html = renderMarkdownToHtml("```ts\nconst a = 1;\n```", {
      copyLabel: "复制代码",
    });

    expect(html).toContain("data-md-copy");
    expect(html).toContain("复制代码");
  });

  it("keeps relative links without target=_blank", () => {
    const html = renderMarkdownToHtml("[guide](./docs/guide.md)");

    expect(html).toContain('href="./docs/guide.md"');
    expect(html).not.toContain('target="_blank"');
  });
});
