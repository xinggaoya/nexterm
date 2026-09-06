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

