import { Marked, type RendererObject, type Tokens } from "marked";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Schemes that are safe to render as href. The list is intentionally narrow;
// unknown schemes fall through to "render as text" so `javascript:`,
// `data:`, `vbscript:`, `file:` and friends never reach v-html.
const SAFE_HREF_SCHEMES = new Set([
  "http",
  "https",
  "mailto",
  "ftp",
  "ftps",
  "tel",
]);

const HREF_SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
// Browsers historically stripped leading whitespace, C0 control bytes, and
// even certain punctuation (e.g. `\` in some legacy parsers) before evaluating
// a scheme, so `  \tjavascript:...` and `\\javascript:...` have both been
// observed to resolve as `javascript:`. Reject any leading byte that's neither
// a normal URL character nor a colon-bearing path/drive letter.
const DANGEROUS_HREF_LEADING_RE =
  /^[\s\x00-\x1f\\]*(?:javascript|vbscript|data):/i;

function isSafeHref(href: string): boolean {
  if (typeof href !== "string" || href.length === 0) return false;
  if (DANGEROUS_HREF_LEADING_RE.test(href)) return false;
  const match = HREF_SCHEME_RE.exec(href);
  if (!match) {
    // Relative path or anchor — no explicit scheme, safe.
    return true;
  }
  return SAFE_HREF_SCHEMES.has(match[1].toLowerCase());
}

// 内联 base64 图片（README 徽章、内嵌截图）是唯一允许的 `data:` 用途。
// 必须整体匹配：只判断 `startsWith("data:image/")` 会让
// `![x](data:image/png"onerror="alert(1))` 逃出属性 —— marked 的 image
// tokenizer 不转义 href 里的 `"`，于是渲染出的 `<img src="...">` 会被
// 提前闭合，攻击者注入的 onerror 在预览里直接执行（webview 主 origin，
// 持有全部 IPC 能力）。
const SAFE_DATA_IMAGE_RE =
  /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)(?:;[\w-]+=[\w-]+)*;base64,[A-Za-z0-9+/]*={0,2}$/i;

function isSafeDataImageHref(href: string): boolean {
  return SAFE_DATA_IMAGE_RE.test(href);
}

const renderer: RendererObject = {
  html({ text }: Tokens.HTML | Tokens.Tag) {
    // Treat raw HTML blocks as text so user-controlled content can never
    // inject <script>/<iframe> into the preview via v-html.
    return escapeHtml(text);
  },
  link({ href, title, tokens }: Tokens.Link) {
    // Render the link's inner tokens via the parser's default renderer so any
    // nested formatting (em/strong/code) is preserved. The link wrapper itself
    // is fully owned by this method, so we control whether href is emitted.
    const inner = this.parser.parseInline(tokens, this.parser.renderer);
    if (!isSafeHref(href)) {
      // Drop the href but keep the visible text — e.g. `[click](javascript:...)`
      // renders as the word "click" without a link wrapper.
      return inner;
    }
    const safeHref = escapeHtml(href);
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
    return `<a href="${safeHref}"${titleAttr} rel="noopener noreferrer" target="_blank">${inner}</a>`;
  },
  image({ href, title, text }: Tokens.Image) {
    const alt = escapeHtml(text);
    // 顺序很重要：data: 图片走白名单校验，其余走 scheme 校验；两条分支
    // 都必须经过 escapeHtml —— 属性值里的 `"` 会提前闭合标签。
    const isDataImage = href.startsWith("data:");
    if (isDataImage) {
      if (!isSafeDataImageHref(href)) {
        return `<span class="md-blocked-image" title="blocked: unsafe image source">[image: ${alt}]</span>`;
      }
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      return `<img src="${escapeHtml(href)}" alt="${alt}"${titleAttr}>`;
    }
    if (!isSafeHref(href)) {
      return `<span class="md-blocked-image" title="blocked: unsafe image source">[image: ${alt}]</span>`;
    }
    const safeHref = escapeHtml(href);
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
    return `<img src="${safeHref}" alt="${alt}"${titleAttr} loading="lazy">`;
  },
};

const parser = new Marked({
  async: false,
  gfm: true,
  breaks: false,
  renderer,
});

export function renderMarkdownToHtml(markdown: string): string {
  return parser.parse(markdown, { async: false }) as string;
}
