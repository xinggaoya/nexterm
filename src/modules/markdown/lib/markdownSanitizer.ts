import DOMPurify from "dompurify";

/**
 * Markdown 预览的 HTML 净化层。
 *
 * 渲染管线是「markdown-it 解析 → DOMPurify 净化 → v-html」。净化器是
 * 整条管线里**唯一**决定「哪些标签 / 属性能进预览」的地方，因此这里的
 * 允许集按 GitHub 的 README 渲染口径裁剪，并且失败关闭：
 * 净化器不可用（非 DOM 环境）时退回「整段转义」，绝不裸放行。
 *
 * DOMPurify 自身的 `sanitize()` 在 `isSupported === false` 时会**原样返回**
 * 脏字符串（见 dompurify 源码 `if (!DOMPurify.isSupported) return dirty`），
 * 所以 `isSupported` 必须由本模块自己先判断，不能依赖库的行为。
 */

/** 允许的 URL 协议。与旧渲染器同一份语义，未列出的协议一律不落到 href / src。 */
const ALLOWED_URI_REGEXP =
  /^(?:(?:https?|ftps?|mailto|tel):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

/**
 * 内联 base64 图片（README 徽章、内嵌截图）是唯一允许的 `data:` 用途。
 * 必须整体匹配：只判断 `startsWith("data:image/")` 会让
 * `data:image/png"onerror="alert(1))` 逃出属性 —— 攻击者注入的 onerror
 * 在预览里直接执行（webview 主 origin，持有全部 IPC 能力）。
 */
const SAFE_DATA_IMAGE_RE =
  /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)(?:;[\w-]+=[\w-]+)*;base64,[A-Za-z0-9+/]*={0,2}$/i;

/**
 * 允许的标签。
 *
 * - 文本块：GitHub README 允许的常规排版标签。
 * - `input`：仅任务列表复选框（净化钩子里再收紧到 `type=checkbox`）。
 * - `svg` 子集：GFM alert 插件与代码块复制按钮要画图标，DOMPurify 对
 *   SVG 的 mXSS 向量（foreignObject / 脚本 / 样式）有专门处理。
 */
const ALLOWED_TAGS = [
  "a", "abbr", "b", "blockquote", "br", "caption", "cite", "code", "col",
  "colgroup", "dd", "del", "details", "div", "dl", "dt", "em", "figcaption",
  "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "input",
  "ins", "kbd", "li", "mark", "ol", "p", "pre", "q", "rp", "rt", "ruby", "s",
  "samp", "small", "span", "strong", "sub", "summary", "sup", "table", "tbody",
  "td", "tfoot", "th", "thead", "tr", "u", "ul", "var", "wbr",
  // SVG 子集
  "circle", "clippath", "defs", "ellipse", "g", "line", "lineargradient",
  "mask", "path", "polygon", "polyline", "radialgradient", "rect", "stop",
  "svg", "symbol", "text", "tspan", "use",
];

/** 允许的属性（HTML + SVG）。`data-*` 与 `aria-*` 由 DOMPurify 单独放行。 */
const ALLOWED_ATTR = [
  "align", "alt", "checked", "class", "colspan", "dir", "disabled", "height",
  "href", "id", "lang", "name", "open", "rel", "reversed", "role", "rowspan",
  "span", "src", "start", "tabindex", "target", "title", "type", "value",
  "loading", "referrerpolicy",
  // SVG
  "clip-path", "clip-rule", "cx", "cy", "d", "fill", "fill-rule", "focusable",
  "gradientunits", "gradienttransform", "offset", "points", "preserveaspectratio",
  "stop-color", "stop-opacity", "stroke", "stroke-linecap", "stroke-linejoin",
  "stroke-width", "text-anchor", "transform", "viewbox", "x", "x1", "x2",
  "xmlns", "y", "y1", "y2",
];

/**
 * 这些标签连同**内部内容**一起丢弃。
 *
 * 只从 ALLOWED_TAGS 里剔除的话，DOMPurify 会把子节点「提上来」保留 ——
 * `<script>alert(1)</script>` 会退化成一段纯文本。放进 FORBID_CONTENTS
 * 才能连内容一起清掉。
 *
 * 注意：只列**不在** ALLOWED_TAGS 里的标签。已允许的标签（svg / colgroup）
 * 在这里再列一次会让它们的子节点被清空 —— 图标的 <path> 和表格的 <tr>
 * 都会消失。
 */
const FORBID_CONTENTS = [
  "annotation-xml", "audio", "desc", "foreignobject", "head", "iframe",
  "math", "mi", "mn", "mo", "ms", "mtext", "noembed", "noframes", "noscript",
  "plaintext", "script", "style", "template", "textarea", "video", "xmp",
];

let hooksInstalled = false;

/** 危险图片的占位文案（与旧渲染器一致）。 */
const BLOCKED_IMAGE_TEXT = "[image]";

function installHooks(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;

  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    const element = node as Element;
    const tag = element.tagName?.toLowerCase();

    // 任务列表复选框是唯一允许的 input；其它表单控件一律丢掉。
    if (tag === "input") {
      const type = (element.getAttribute("type") ?? "").toLowerCase();
      if (type !== "checkbox") {
        element.remove();
        return;
      }
    }

    if (tag !== "img") return;

    const src = element.getAttribute("src");
    if (!src) return;

    // data: 只有整体匹配 base64 图片白名单才放行；其余一律换成占位符。
    if (src.toLowerCase().startsWith("data:") && !SAFE_DATA_IMAGE_RE.test(src)) {
      replaceWithBlockedImage(element);
    }
  });
}

/**
 * 把不安全的 <img> 换成文本占位符。
 *
 * 用 replaceWith 而不是清空 src：空 src 的图片会渲染成浏览器的破图标，
 * 占位符文本更明确，也不会占版面。
 */
function replaceWithBlockedImage(element: Element): void {
  const alt = element.getAttribute("alt") ?? "";
  const placeholder = element.ownerDocument.createElement("span");
  placeholder.className = "md-blocked-image";
  placeholder.setAttribute("title", "blocked: unsafe image source");
  placeholder.textContent = alt ? `${BLOCKED_IMAGE_TEXT}: ${alt}` : BLOCKED_IMAGE_TEXT;
  element.replaceWith(placeholder);
}

/** 转义 HTML 特殊字符。净化不可用时的失败关闭路径与代码块兜底都用它。 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 净化一段 Markdown 渲染出来的 HTML。
 *
 * 失败关闭：DOMPurify 不可用时返回整段转义文本 —— 预览退化成「显示源码」，
 * 但绝不会变成可执行内容。
 */
export function sanitizeMarkdownHtml(html: string): string {
  if (!DOMPurify.isSupported) {
    return escapeHtml(html);
  }
  installHooks();
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    FORBID_CONTENTS,
    ALLOW_DATA_ATTR: true,
    ALLOW_ARIA_ATTR: true,
    KEEP_CONTENT: true,
    RETURN_DOM: false,
  });
}

/** 供渲染层复用：判断一个 URL 是否落在允许协议内（不含 data: 图片）。 */
export function isSafeHref(href: string): boolean {
  if (typeof href !== "string" || href.length === 0) return false;
  if (DANGEROUS_HREF_LEADING_RE.test(href)) return false;
  const match = HREF_SCHEME_RE.exec(href);
  if (!match) return true; // 相对路径或锚点：没有显式协议。
  return SAFE_HREF_SCHEMES.has(match[1].toLowerCase());
}

const SAFE_HREF_SCHEMES = new Set([
  "http",
  "https",
  "mailto",
  "ftp",
  "ftps",
  "tel",
]);

const HREF_SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

/**
 * 浏览器历史上会剥掉前导空白与 C0 控制字节再解析协议，
 * 于是 `  \tjavascript:...`、`\\javascript:...` 都可能被当成
 * `javascript:`。前导字节既不是普通 URL 字符也不是带冒号的路径/盘符时，
 * 一律拒绝。
 */
const DANGEROUS_HREF_LEADING_RE =
  /^[\s\x00-\x1f\\]*(?:javascript|vbscript|data):/i;

/** data: 图片白名单。 */
export function isSafeDataImageHref(href: string): boolean {
  return SAFE_DATA_IMAGE_RE.test(href);
}
