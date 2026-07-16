import type { LspServerSpec } from "../types";

export const GO_SPEC = {
  id: "gopls",
  language: "go",
} as const satisfies Pick<LspServerSpec, "id" | "language">;
