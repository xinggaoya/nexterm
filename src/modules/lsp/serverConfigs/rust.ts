// rust-analyzer 的前端元数据（实际 binary 由 Rust 端 lsp_resolve_command 解析）。
import type { LspServerSpec } from "../types";

export const RUST_SPEC = {
  id: "rust-analyzer",
  language: "rust",
} as const satisfies Pick<LspServerSpec, "id" | "language">;
