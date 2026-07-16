import type { LspServerSpec } from "../types";

export const TS_SPEC = {
  id: "typescript-language-server",
  language: "typescript",
  args: ["--stdio"],
} as const satisfies Pick<LspServerSpec, "id" | "language" | "args">;
