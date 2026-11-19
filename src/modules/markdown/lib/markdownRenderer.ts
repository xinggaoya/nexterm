import MarkdownIt, { type MarkdownIt as MarkdownItInstance } from "markdown-it";
import anchor from "markdown-it-anchor";
import footnote from "markdown-it-footnote";
import githubAlerts from "markdown-it-github-alerts";
import taskLists from "markdown-it-task-lists";
import { highlightCode } from "./markdownHighlighter";
import {
  escapeHtml,
  isSafeDataImageHref,
  isSafeHref,
  sanitizeMarkdownHtml,
} from "./markdownSanitizer";

/** GFM alert 的五种类型。 */
export type MarkdownAlertType =
  | "note"
  | "tip"
  | "important"
  | "warning"
  | "caution";

export interface MarkdownRenderOptions {
  /** 代码块复制按钮的无障碍标签。 */
  copyLabel?: string;
  /** GFM alert 的标题文案（按类型）；缺省时插件回退到英文。 */
  alertTitles?: Partial<Record<MarkdownAlertType, string>>;
}

/** GitHub 的 octicon copy，用于代码块复制按钮。 */
const COPY_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path fill="currentColor" fill-rule="evenodd" d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25v-7.5Zm5 3.25a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 .75.75v7.5a.75.75 0 0 1-.75.75h-7.5a.75.75 0 0 1-.75-.75v-7.5ZM6 5.25a.25.25 0 0 1 .25-.25h7.5a.25.25 0 0 1 .25.25v.5a.75.75 0 0 1-1.5 0v-.5h-6v.5a.75.75 0 0 1-1.5 0v-.5Z"></path></svg>';

/**
 * 标题锚点的 slug 规则（对齐 GitHub）。
 *
 * 保留字母（含 CJK）与数字、空格转连字符、去掉标点；
 * 不做 URL 编码 —— GitHub 的锚点里中文是原样的。
 */
function githubSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-");
}

/** 解析器实例缓存：文案随语言切换，实例按文案签名复用。 */
const parserCache = new Map<string, MarkdownItInstance>();

const PARSER_CACHE_LIMIT = 8;

function parserSignature(options: MarkdownRenderOptions): string {
  return `${options.copyLabel ?? ""}|${JSON.stringify(options.alertTitles ?? {})}`;
}

function createParser(options: MarkdownRenderOptions): MarkdownItInstance {
  const md = new MarkdownIt({
    // 原始 HTML 交给净化层裁决（白名单），而不是整段转义成文本。
    html: true,
    // 裸 URL / 邮箱自动链接，和 GitHub 一致。
    linkify: true,
    // GitHub 不做智能引号转换。
    typographer: false,
    breaks: false,
  });

  md.use(footnote);
  // GitHub 的任务列表复选框是只读的：enabled=false → 渲染成 disabled。
  md.use(taskLists, { enabled: false, label: false });
  md.use(anchor, {
    slugify: githubSlug,
    permalink: anchor.permalink.ariaHidden({
      placement: "after",
      symbol: "#",
      class: "md-heading-anchor",
      space: false,
      renderAttrs: () => ({ tabindex: "-1" }),
    }),
  });
  md.use(githubAlerts, { titles: options.alertTitles ?? {} });

  /**
   * 解析期不判协议。
   *
   * markdown-it 默认会在**内联解析**阶段就拒绝 javascript:/data: 链接，
   * 整段语法退化成原始文本（`[click](javascript:...)` 原样显示）。GitHub
   * 的做法相反：先按正常链接解析，再在净化阶段剥掉危险协议 —— 链接文字
   * 保留，href 落空。预览对齐 GitHub，也让链接文字不至于突然变成源码。
   *
   * 协议白名单由 link_open / image 两条规则执行，DOMPurify 是最后一道闸。
   */
  md.validateLink = () => true;

  md.renderer.rules.link_open = (tokens, idx, rendererOptions, _env, self) => {
    const token = tokens[idx];
    const href = String(token.attrGet("href") ?? "");
    if (!isSafeHref(href)) {
      // 保留链接文字、剥掉 href（不是置空 —— 空 href 会指向当前页）。
      const hrefIndex = token.attrIndex("href");
      if (hrefIndex >= 0) token.attrs?.splice(hrefIndex, 1);
      return self.renderToken(tokens, idx, rendererOptions);
    }
    // 站内 / 相对链接不加 target：点了应该留在应用里，不是新开一个 webview。
    if (/^https?:\/\//i.test(href)) {
      token.attrSet("target", "_blank");
      token.attrSet("rel", "noopener noreferrer");
    }
    return self.renderToken(tokens, idx, rendererOptions);
  };

  md.renderer.rules.image = (tokens, idx, rendererOptions, env, self) => {
    const token = tokens[idx];
    const src = String(token.attrGet("src") ?? "");
    // alt 要从子 token 渲染成纯文本 —— 覆盖默认 image 规则后不会自动填。
    const alt = self.renderInlineAsText(token.children ?? [], rendererOptions, env);
    const blocked =
      src.toLowerCase().startsWith("data:")
        ? !isSafeDataImageHref(src)
        : !isSafeHref(src);
    if (blocked) {
      return `<span class="md-blocked-image" title="blocked: unsafe image source">[image: ${escapeHtml(alt)}]</span>`;
    }
    token.attrSet("alt", alt);
    token.attrSet("loading", "lazy");
    return self.renderToken(tokens, idx, rendererOptions);
  };

  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const language = token.info.trim().split(/\s+/)[0] ?? "";
    const body = highlightCode(token.content, language) ?? escapeHtml(token.content);
    const langAttr = language ? ` class="language-${escapeHtml(language)}"` : "";
    const label = language
      ? `<span class="md-code-lang">${escapeHtml(language)}</span>`
      : "";
    const copyLabel = escapeHtml(options.copyLabel ?? "Copy");
    const copy = `<span class="md-code-copy" data-md-copy role="button" tabindex="0" aria-label="${copyLabel}" title="${copyLabel}">${COPY_ICON}</span>`;
    return (
      `<div class="md-code" data-md-code>` +
      `<div class="md-code-bar">${label}${copy}</div>` +
      `<pre><code${langAttr}>${body}</code></pre>` +
      `</div>\n`
    );
  };

  return md;
}

function getParser(options: MarkdownRenderOptions): MarkdownItInstance {
  const key = parserSignature(options);
  const cached = parserCache.get(key);
  if (cached) return cached;
  const parser = createParser(options);
  if (parserCache.size >= PARSER_CACHE_LIMIT) parserCache.clear();
  parserCache.set(key, parser);
  return parser;
}

/**
 * 把 Markdown 渲染成**已净化**的 HTML。
 *
 * 管线：markdown-it 解析（含 GFM 扩展）→ DOMPurify 白名单净化。
 * 净化是最后一道闸，调用方拿到的 HTML 可以直接喂给 v-html。
 */
export function renderMarkdownToHtml(
  markdown: string,
  options: MarkdownRenderOptions = {},
): string {
  const parser = getParser(options);
  return sanitizeMarkdownHtml(parser.render(markdown));
}
