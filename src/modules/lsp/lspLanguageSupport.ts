import type { Text } from "@codemirror/state";
import type { Completion, CompletionResult } from "@codemirror/autocomplete";
import type {
  LspCompletionItem,
  LspDocumentSymbol,
  LspCompletionList,
  LspHover,
  LspLocation,
  LspLocationLink,
  LspMarkupContent,
  LspPosition,
  LspRange,
  LspWorkspaceEdit,
} from "./types";

/**
 * LSP ↔ CodeMirror 的换算层（纯函数，不依赖 Tauri 与 LSP 连接）。
 *
 * 抽出来的原因：补全/悬浮/跳转的可测部分全在这里，而它们恰好是最容易
 * 出错的部分 —— **偏移刻度**。CodeMirror 的 offset 与 LSP 的 Position 都是
 * UTF-16 code unit 计数，看起来一致，但只要有一个地方按码点或字节算，
 * 在含 emoji / CJK 的文件里就会整行错位。这类 bug 在单测里能精确捕获，
 * 接上真实 server 反而很难复现。
 */

/** LSP Position(0-based line / UTF-16 character) → CodeMirror 文档偏移。 */
export function lspPositionToOffset(doc: Text, position: LspPosition): number {
  const lineNo = Math.min(Math.max((position.line ?? 0) + 1, 1), doc.lines);
  const line = doc.line(lineNo);
  // 下界也要钳：server 回传负 character（个别实现在空行上会这么做）时，
  // 不钳就会算出负偏移，后续 dispatch 直接抛 RangeError。
  return Math.min(Math.max(line.from + (position.character ?? 0), line.from), line.to);
}

/** CodeMirror 文档偏移 → LSP Position。 */
export function offsetToLspPosition(doc: Text, offset: number): LspPosition {
  const clamped = Math.min(Math.max(offset, 0), doc.length);
  const line = doc.lineAt(clamped);
  return { line: line.number - 1, character: clamped - line.from };
}


/**
 * 把 LSP 的文档偏移对齐到当前"词"上。
 *
 * 补全的位置本身就是词的起点（server 在 `foo.ba|` 返回的插入点就是
 * `ba` 的开头），但不同 server 实现有出入（有的返回光标处）。往前吞掉
 * 标识符字符可以兜住差异，否则会出现"前半个词被保留、结果拼成 foofoobar"。
 */
export function wordStartAt(doc: Text, offset: number): number {
  let start = Math.min(Math.max(offset, 0), doc.length);
  while (start > 0) {
    const before = doc.sliceString(start - 1, start);
    if (!/[\w$]/.test(before)) break;
    start -= 1;
  }
  return start;
}

/** 补全项的插入文本：textEdit 优先于 insertText，再退到 label。 */
export function completionInsertText(item: LspCompletionItem): string {
  return item.textEdit?.newText ?? item.insertText ?? item.label;
}

/** markdown 降级成纯文本：悬浮框不做 markdown 渲染，先把标记剥掉。 */
export function markupToText(markup: string | LspMarkupContent): string {
  if (typeof markup === "string") return markup;
  return markup.value;
}

/** LSP CompletionItem → CodeMirror Completion。 */
export function toCmCompletion(item: LspCompletionItem): Completion {
  const insert = completionInsertText(item);
  const base: Completion = {
    label: item.label,
    detail: item.detail,
    // 文档支持多形态（string | MarkupContent），统一成字符串。
    info: item.documentation ? markupToText(item.documentation) : undefined,
    type: completionType(item.kind),
  };
  const edit = item.textEdit;
  if (!edit) {
    // 无 range：返回字符串，CodeMirror 会用结果里的 from/to（即词起点）
    // 替换已输入的前缀。
    return { ...base, apply: insert };
  }
  // 有 range：以服务端给的替换范围为准，不能用 CodeMirror 算的 from/to ——
  // 两者在"光标停在词中间"时会不同。
  // InsertReplaceEdit 用 `insert` 范围（我们不声明 insertReplaceSupport，
  // 真收到时取 insert 是更保守的选择）。
  const range = "range" in edit ? edit.range : edit.insert;
  return {
    ...base,
    apply: (view, _completion, _from, _to) => {
      const from = lspPositionToOffset(view.state.doc, range.start);
      const to = lspPositionToOffset(view.state.doc, range.end);
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length },
        // 标成 input.complete 才会进 undo 栈的"输入"分组，
        // 否则一次撤销会把整行删掉。
        userEvent: "input.complete",
      });
    },
  };
}

/** LSP CompletionItemKind → CodeMirror 简写类型，用于补全面板图标。 */
function completionType(kind: number | undefined): string | undefined {
  switch (kind) {
    case 1: // Text
    case 19: // TextMatrix
      return "text";
    case 2: // Method
      return "method";
    case 3: // Function
      return "function";
    case 4: // Constructor
      return "type";
    case 5: // Field
    case 8: // Property
      return "property";
    case 6: // Variable
      return "variable";
    case 7: // Class
    case 11: // Interface
      return "class";
    case 9: // File
      return "file";
    case 10: // Enum
      return "enum";
    case 12: // Keyword
      return "keyword";
    case 13: // Snippet
      return "text";
    case 14: // Color
      return "constant";
    case 21: // Constant
      return "constant";
    case 22: // Struct
      return "type";
    default:
      return undefined;
  }
}

/**
 * 组装 CodeMirror 补全结果。
 *
 * `from` 用 `wordStartAt` 对齐到当前词起点：CodeMirror 会用它来截断已输入
 * 的前缀，必须与服务端认定的补全范围一致，否则会出现重复前缀。
 */
export function toCmCompletionResult(
  doc: Text,
  list: LspCompletionList | LspCompletionItem[] | null,
  cursorOffset: number,
): CompletionResult | null {
  const items = Array.isArray(list) ? list : list?.items;
  if (!items || items.length === 0) return null;
  return {
    from: wordStartAt(doc, cursorOffset),
    to: cursorOffset,
    options: items.map(toCmCompletion),
    // 词还在继续输入时不收掉候选（rust-analyzer / pyright 都会把
    // isIncomplete 置真来表达这一点）。
    validFor: /^[\w$]*$/,
  };
}

/** 悬浮内容：剥掉 markdown 标记后拼成纯文本；空内容返回 null。 */
export function toHoverText(hover: LspHover | null | undefined): string | null {
  if (!hover) return null;
  const parts = Array.isArray(hover.contents)
    ? hover.contents.map(markupToText)
    : [markupToText(hover.contents)];
  const text = parts
    // 悬浮框暂不渲染 markdown：只去掉代码围栏与行内标记，保留可读文本。
    .map((part) =>
      part
        .replace(/^```[a-zA-Z]*\n?/gm, "")
        .replace(/^```$/gm, "")
        .replace(/`([^`]+)`/g, "$1")
        .trim(),
    )
    .filter(Boolean)
    .join("\n\n");
  return text || null;
}

export type ResolvedDefinition = {
  path: string;
  line: number;
  character: number;
};

/**
 * `textDocument/definition` 的结果归一化。
 *
 * server 可能返回单条 `Location`、`Location[]`、`LocationLink[]` 或
 * `null`，四种都要能吃。
 */
export function resolveDefinitionLocations(
  result: LspLocation | LspLocation[] | LspLocationLink[] | null | undefined,
  fileUriToPath: (uri: string) => string,
): ResolvedDefinition | null {
  if (!result) return null;
  const first = Array.isArray(result) ? result[0] : result;
  if (!first) return null;
  if ("targetUri" in first) {
    return {
      path: fileUriToPath(first.targetUri),
      line: first.targetSelectionRange.start.line,
      character: first.targetSelectionRange.start.character,
    };
  }
  return {
    path: fileUriToPath(first.uri),
    line: first.range.start.line,
    character: first.range.start.character,
  };
}

// ── 重命名 / 引用 / 符号 ───────────────────────────────────────────────

/** 一处待改的文本。 */
export type PendingEdit = {
  /** `file://` URI（键来自 WorkspaceEdit）。 */
  uri: string;
  path: string;
  range: LspRange;
  newText: string;
};

/**
 * WorkspaceEdit（`uri → edits`）→ 按路径分组的扁平列表。
 *
 * 之所以要摊平：WorkspaceEdit 的键是 URI，而编辑器的应用侧只认路径；
 * 跨文件重命名的改动要一次性写回多个文件，按路径分组才好落。
 */
export function toPendingEdits(
  edit: LspWorkspaceEdit | null | undefined,
  fileUriToPath: (uri: string) => string,
): PendingEdit[] {
  if (!edit) return [];
  const out: PendingEdit[] = [];
  for (const [uri, edits] of Object.entries(edit)) {
    if (!Array.isArray(edits)) continue;
    for (const item of edits) {
      if (!item || !item.range) continue;
      out.push({
        uri,
        path: fileUriToPath(uri),
        range: item.range,
        newText: typeof item.newText === "string" ? item.newText : "",
      });
    }
  }
  return out;
}

/** 引用列表 → 按路径分组、每处一行。 */
export type ReferenceGroup = {
  path: string;
  /** 按行号升序，便于渲染。 */
  lines: number[];
};

export function toReferenceGroups(
  locations: LspLocation[] | null | undefined,
  fileUriToPath: (uri: string) => string,
): ReferenceGroup[] {
  if (!locations || locations.length === 0) return [];
  const byPath = new Map<string, number[]>();
  for (const location of locations) {
    const path = fileUriToPath(location.uri);
    const lines = byPath.get(path) ?? [];
    lines.push(location.range.start.line);
    byPath.set(path, lines);
  }
  return Array.from(byPath.entries())
    .map(([path, lines]) => ({ path, lines: lines.sort((a, b) => a - b) }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** 深度优先摊平符号树，产出面包屑可用的线性列表。 */
export function flattenDocumentSymbols(
  symbols: LspDocumentSymbol[],
  container: string[] = [],
): Array<{ symbol: LspDocumentSymbol; container: string[] }> {
  const out: Array<{ symbol: LspDocumentSymbol; container: string[] }> = [];
  const walk = (
    list: LspDocumentSymbol[],
    path: string[],
    depth: number,
  ) => {
    if (depth > 12) return; // 防御畸形数据导致的无限递归
    for (const symbol of list) {
      out.push({ symbol, container: path });
      if (symbol.children?.length) {
        walk(symbol.children, [...path, symbol.name], depth + 1);
      }
    }
  };
  walk(symbols, container, 0);
  return out;
}

/** 符号在文件里的字节偏移（用于面包屑点击跳转）。 */
export function symbolRangeToOffsets(
  doc: Text,
  range: LspRange,
): { from: number; to: number } {
  const from = lspPositionToOffset(doc, range.start);
  const to = lspPositionToOffset(doc, range.end);
  return { from: Math.min(from, to), to: Math.max(from, to) };
}

/**
 * 位置偏移 → 所属符号的容器路径（面包屑用）。
 *
 * 返回**最内层**的匹配：深度优先摊平时父节点排在子节点之前，直接取第一个
 * 命中会得到最外层符号（光标在函数体内的局部变量上时，面包屑会只显示函数名
 * 而少一层）。所以这里保留最后一个命中 —— 也就是最深的那个。
 */
export function containerPathForOffset(
  doc: Text,
  symbols: LspDocumentSymbol[],
  offset: number,
): string[] {
  let deepest: string[] = [];
  for (const { symbol, container } of flattenDocumentSymbols(symbols)) {
    const { from, to } = symbolRangeToOffsets(doc, symbol.range);
    if (offset >= from && offset <= to) {
      deepest = [...container, symbol.name];
    }
  }
  return deepest;
}

/**
 * 把 LSP 的 TextEdit 列表应用到纯文本。
 *
 * 按**偏移从后往前**替换：前面的改动会让后面的偏移失效，正序应用会把内容
 * 搅乱（这正是重命名落盘时踩过的坑，这里一次做对）。
 *
 * 越界的 range 会被钳到行内，行号越界则跳过该条而不是崩掉 —— server 返回
 * 的范围偶尔会落在刚被前面改动挪走的位置。
 */
export function applyTextEdits(
  content: string,
  edits: readonly { range: LspRange; newText: string }[],
): string {
  if (edits.length === 0) return content;
  const lines = content.split("\n");
  // 先算出每条编辑的绝对偏移，再倒序应用。
  const resolved = edits
    .map((edit) => {
      const startLine = Math.min(Math.max(edit.range.start.line, 0), lines.length - 1);
      const endLine = Math.min(Math.max(edit.range.end.line, 0), lines.length - 1);
      if (startLine !== edit.range.start.line || endLine !== edit.range.end.line) {
        return null;
      }
      const start = offsetOf(lines, startLine, edit.range.start.character);
      const end = offsetOf(lines, endLine, edit.range.end.character);
      return { from: Math.min(start, end), to: Math.max(start, end), newText: edit.newText };
    })
    .filter((entry): entry is { from: number; to: number; newText: string } => entry !== null)
    .sort((a, b) => b.from - a.from);
  let out = content;
  for (const edit of resolved) {
    out = out.slice(0, edit.from) + edit.newText + out.slice(edit.to);
  }
  return out;
}

/** (line, character) → 绝对偏移。character 越界时钳到行尾。 */
function offsetOf(lines: readonly string[], line: number, character: number): number {
  let offset = 0;
  for (let i = 0; i < line; i += 1) {
    offset += (lines[i] ?? "").length + 1; // +1 是换行符
  }
  const text = lines[line] ?? "";
  return offset + Math.min(Math.max(character, 0), text.length);
}
