export type HighlightSegment = {
  text: string;
  hit: boolean;
};

/**
 * 转义正则元字符,让 pattern 按字面量匹配。后端 fs_grep 统一按 Rust 正则
 * 解析(本地 / WSL / SSH 三条路由一致),纯文本模式在前端转义等价于
 * `rg -F`,后端零改动。
 */
export function escapeRegExp(pattern: string): string {
  return pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type HighlightOptions = {
  /** pattern 按正则解析;false(默认)按字面量子串匹配。 */
  regex?: boolean;
  caseInsensitive?: boolean;
};

/**
 * 计算 text 的命中高亮分段(顺序排列,hit 标记是否命中)。
 *
 * 返回 null 表示无法可靠计算(正则非法,或与后端引擎存在语法差异)或
 * 没有命中,调用方应按无高亮整行渲染。JS 与 Rust 正则语义大体兼容,
 * 高亮仅影响显示,不参与匹配判定。
 */
export function buildHighlightSegments(
  text: string,
  pattern: string,
  options: HighlightOptions = {},
): HighlightSegment[] | null {
  if (!pattern) return null;
  const flags = options.caseInsensitive ? "gi" : "g";
  let regex: RegExp;
  try {
    regex = options.regex
      ? new RegExp(pattern, flags)
      : new RegExp(escapeRegExp(pattern), flags);
  } catch {
    return null;
  }

  const segments: HighlightSegment[] = [];
  let last = 0;
  regex.lastIndex = 0;
  for (;;) {
    const match = regex.exec(text);
    if (!match) break;
    if (match[0].length === 0) {
      // 零长匹配(如 a*)会死循环,前进一步跳过。
      regex.lastIndex += 1;
      continue;
    }
    if (match.index > last) {
      segments.push({ text: text.slice(last, match.index), hit: false });
    }
    segments.push({ text: match[0], hit: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    segments.push({ text: text.slice(last), hit: false });
  }
  // 整行没有任何命中时返回 null,调用方按无高亮渲染。
  if (!segments.some((segment) => segment.hit)) return null;
  return segments;
}
