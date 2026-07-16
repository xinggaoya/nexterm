import type { LspServerSpec } from "../types";

export const PYTHON_SPEC = {
  id: "pyright-langserver",
  language: "python",
} as const satisfies Pick<LspServerSpec, "id" | "language">;
