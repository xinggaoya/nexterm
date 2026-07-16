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
