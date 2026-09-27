// LSP server spec / 解析结果 / 会话信息（来自 Rust 端 serde 模型）。
export type LspServerSpec = {
  id: string;
  language: string;
  command: string;
  args?: string[];
  cwd?: string | null;
};

export type LspResolvedCommand = {
  command: string;
  args: string[];
};

export type LspSessionInfo = {
  id: number;
  language: string;
  spec_id: string;
};

// 与 Rust LspMessage 枚举的 #[serde(tag="kind", rename_all="snake_case")]
// 对应的 TypeScript 形态。
export type LspServerMessage =
  | { kind: "frame"; payload: string }
  | { kind: "parse_error"; message: string }
  | { kind: "stderr"; message: string }
  | { kind: "exit"; code: number | null };

// ── LSP 协议最小子集（仅声明诊断闭环用到的字段） ─────────────────────────

/** LSP Position（UTF-16 code units，与 CodeMirror 偏移同刻度）。 */
export type LspPosition = { line: number; character: number };

export type LspRange = { start: LspPosition; end: LspPosition };

/** textDocument/publishDiagnostics 通知里的 Diagnostic。 */
export type LspDiagnostic = {
  range: LspRange;
  severity?: 1 | 2 | 3 | 4;
  message: string;
  source?: string;
  code?: number | string;
};

export type PublishDiagnosticsParams = {
  uri: string;
  version?: number | null;
  diagnostics: LspDiagnostic[];
};

// ── 补全 / 悬浮 / 跳转定义所需的协议子集 ─────────────────────────────
//
// 只声明实际读到的字段（类型先行：Rust 侧不参与，但前端读到的形状必须与
// LSP 规范一致，否则会在某个 server 上静默拿到 undefined）。

/** LSP 位置用的是 UTF-16 code unit 计数，与 CodeMirror 的偏移同刻度。 */
export type LspCompletionItem = {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | LspMarkupContent;
  // 补全可以带 textEdit（server 直接给出插入范围），优先级高于 insertText。
  // `insert` 形态是 InsertReplaceEdit（客户端声明 insertReplaceSupport 后
  // 才会出现），这里一并接受。
  textEdit?: LspTextEdit | LspInsertReplaceEdit;
  insertText?: string;
  insertTextFormat?: 1 | 2;
  sortText?: string;
  filterText?: string;
  additionalTextEdits?: LspTextEdit[];
};

export type LspTextEdit = {
  range: LspRange;
  newText: string;
};

export type LspInsertReplaceEdit = {
  newText: string;
  insert: LspRange;
  replace?: LspRange;
};

export type LspMarkupContent = {
  kind: "plaintext" | "markdown";
  value: string;
};

export type LspCompletionList = {
  isIncomplete: boolean;
  items: LspCompletionItem[];
};

export type LspCompletionParams = {
  textDocument: { uri: string };
  position: LspPosition;
};

export type LspHover = {
  contents: string | LspMarkupContent | Array<string | LspMarkupContent>;
  range?: LspRange;
};

export type LspLocation = {
  uri: string;
  range: LspRange;
};

export type LspLocationLink = {
  targetUri: string;
  targetRange: LspRange;
  targetSelectionRange: LspRange;
};

export type LspDocumentSymbol = {
  name: string;
  detail?: string;
  kind: number;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[];
};

// ── 重命名 / 引用 / 工作区符号 ─────────────────────────────────────────

/** `textDocument/rename` 的参数。 */
export type LspRenameParams = {
  textDocument: { uri: string };
  position: LspPosition;
  newName: string;
};

export type LspTextDocumentIdentifier = { uri: string; version?: number | null };

/** `textDocument/references` 的参数。`includeDeclaration` 让结果含定义本身。 */
export type LspReferenceParams = {
  textDocument: { uri: string };
  position: LspPosition;
  context: { includeDeclaration: boolean };
};

export type LspReferenceContext = { includeDeclaration: boolean };

/** 单个重命名 / 引用改动：`[from, to)` 是要替换的原文范围。 */
export type LspWorkspaceEdit = Record<
  string,
  Array<{
    range: LspRange;
    newText: string;
  }>
>;

/**
 * `workspace/symbol` 用的是 **SymbolInformation**（扁平的），不是
 * `DocumentSymbol`（带 children 的树）。server 可以返回任一形态，
 * 两者都要能吃 —— 见 `normalizeSymbol`。
 */
export type LspSymbolInformation = {
  name: string;
  kind: number;
  location: LspLocation;
  containerName?: string;
};

/** URI → 路径。LSP 用 `file://` + 百分号编码，这里只处理我们写入的形式。 */
export function fileUriToPath(uri: string): string {
  if (!uri.startsWith("file://")) return uri;
  const withoutScheme = uri.slice("file://".length);
  // Windows 的 `file:///C:/x` 去掉首个斜杠才是盘符路径。
  const normalized =
    withoutScheme.startsWith("/") && /^\/[a-zA-Z]:/.test(withoutScheme)
      ? withoutScheme.slice(1)
      : withoutScheme;
  try {
    return decodeURIComponent(normalized);
  } catch {
    return normalized;
  }
}

