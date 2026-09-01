/**
 * OSC sequence parsing for terminal integration.
 *
 * 处理三类序列:
 * - OSC 7 ("file://host/path"): shell 的当前工作目录
 * - OSC 0/2 ("title"): window/icon title
 * - OSC 8 ("params;URI"): hyperlink,iTerm2/VSCode/Tabby 都支持
 *
 * 输出 split 成 cleaned string (with OSC bytes removed) and events.
 * State held across chunks is purely the tail of any OSC sequence that wasn't
 * terminated in this buffer; the parser is deliberately simple.
 *
 * OSC 52 clipboard 由 addon-clipboard 直接通过 xterm parser 注册,不走这个文件。
 */

export type OscEvent =
  | { type: "cwd"; value: string }
  | { type: "title"; value: string }
  | { type: "hyperlink"; value: OscHyperlink };

export interface OscHyperlink {
  uri: string;
  /** OSC 8 params,例如 "id=xyz" — 用于多行同链接去重 */
  params: string;
}

export interface OscResult {
  cleaned: string;
  events: OscEvent[];
  /** Bytes waiting to complete an OSC sequence started in the previous chunk. */
  pendingBuffer: string;
}

const OSC_TERMINATORS = ["\x07", "\x1b\\"];

export function handleOscData(data: string, prevPending: string): OscResult {
  // 快速路径:既无前序未完成序列、本块也无 ESC ],直接透传零拷贝。
  // 99% 的 PTY 输出（编译日志、AI CLI 响应、普通 cat/ls 文本）都走这条。
  if (!prevPending && data.indexOf("\x1b]") === -1) {
    return { cleaned: data, events: [], pendingBuffer: "" };
  }
  // 另一条快速路径:本块以 ESC 字符结尾(可能是 CSI `\x1b[...X`、
  // OSC `\x1b]...X`、DCS / SS3 / 其他 ESC 序列),但主体不含 OSC
  // 起始符。整段切到 OSC 慢路径会让全文 indexOf 跑两遍;
  // 这里直接把"最后一个 ESC 字符到末尾"留作 pending,前面部分零
  // 拷贝透传,下次 chunk 合并后再让 xterm 正常解析。这样 CSI 跨
  // chunk 边界(常见:用户键入清屏 `\x1b[2J` 跨 PTY 读)也能省掉
  // 一次慢路径的全文扫描。
  if (!prevPending) {
    const lastEsc = data.lastIndexOf("\x1b");
    if (lastEsc !== -1 && data.indexOf("\x1b]", 0) === -1) {
      return {
        cleaned: data.slice(0, lastEsc),
        events: [],
        pendingBuffer: data.slice(lastEsc),
      };
    }
  }

  const combined = prevPending + data;
  const events: OscEvent[] = [];
  const out: string[] = [];
  let pending = "";
  let cursor = 0;
  let searchFrom = 0;

  while (searchFrom < combined.length) {
    const escIdx = combined.indexOf("\x1b]", searchFrom);
    if (escIdx === -1) {
      if (cursor < combined.length) out.push(combined.slice(cursor));
      cursor = combined.length;
      break;
    }

    if (escIdx > cursor) {
      out.push(combined.slice(cursor, escIdx));
      cursor = escIdx;
    }

    const endIdx = findOscEnd(combined, escIdx + 2);
    if (endIdx === -1) {
      // OSC sequence isn't terminated yet — keep only the OSC tail for the
      // next chunk; everything before it is part of the regular output.
      out.push(combined.slice(cursor, escIdx));
      pending = combined.slice(escIdx);
      cursor = combined.length;
      break;
    }

    const payload = combined.slice(escIdx + 2, endIdx.value);
    const ev = parseOscPayload(payload);
    if (ev) events.push(ev);
    cursor = endIdx.end;
    searchFrom = endIdx.end;
  }

  if (cursor < combined.length) {
    out.push(combined.slice(cursor));
  }

  return {
    cleaned: out.join(""),
    events,
    pendingBuffer: pending,
  };
}

function findOscEnd(
  text: string,
  from: number,
): { value: number; end: number } | -1 {
  for (const term of OSC_TERMINATORS) {
    const idx = text.indexOf(term, from);
    if (idx !== -1) return { value: idx, end: idx + term.length };
  }
  return -1;
}

function parseOscPayload(payload: string): OscEvent | null {
  const semi = payload.indexOf(";");
  if (semi === -1) return null;
  const code = payload.slice(0, semi);
  const value = payload.slice(semi + 1);
  if (code === "7") {
    const pathMatch = value.match(/^file:\/\/[^\/]*(\/.*)$/);
    if (pathMatch) {
      let raw = pathMatch[1];
      try {
        raw = decodeURIComponent(raw);
      } catch {
        // Malformed percent-encoding — keep the raw path rather than crash.
      }
      const fixed = /^\/[A-Za-z]:/.test(raw) ? raw.slice(1) : raw;
      return { type: "cwd", value: fixed };
    }
    return null;
  }
  if (code === "0" || code === "2") {
    const clean = value.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 120);
    if (!clean) return null;
    return { type: "title", value: clean };
  }
  if (code === "8") {
    // 格式:params;URI,params 可空,例如 "id=xyz:1:2" 或 ""
    const sepIdx = value.indexOf(";");
    if (sepIdx === -1) return null;
    const params = value.slice(0, sepIdx);
    const rawUri = value.slice(sepIdx + 1);
    // 空 URI 表示"关闭 hyperlink"
    if (!rawUri) return null;
    const uri = sanitizeHyperlinkUri(rawUri);
    if (!uri) return null;
    return {
      type: "hyperlink",
      value: { uri, params },
    };
  }
  return null;
}

/**
 * 防止任意 OSC 8 URI 被注入到终端渲染;只允许 http(s) / file / ssh 等明确安全
 * 的 scheme,通过 xterm 的 registerLinkProvider 时也要做同样校验。
 */
export function sanitizeHyperlinkUri(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  // 拒绝控制字符
  if (/[\x00-\x1f\x7f]/.test(trimmed)) return "";
  try {
    const parsed = new URL(trimmed);
    if (!/^https?:$|^file:$|^ssh:$|^vscode:$/.test(parsed.protocol)) {
      return "";
    }
    return parsed.toString();
  } catch {
    // 可能是 file:// 相对形式,放宽
    return /^file:\/\//.test(trimmed) ? trimmed : "";
  }
}
