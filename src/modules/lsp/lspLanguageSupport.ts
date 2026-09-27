import type { Text } from "@codemirror/state";
import type { Completion, CompletionResult } from "@codemirror/autocomplete";
import type {
  LspCompletionItem,
  LspCompletionList,
  LspHover,
  LspLocation,
  LspLocationLink,
  LspMarkupContent,
  LspPosition,
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
