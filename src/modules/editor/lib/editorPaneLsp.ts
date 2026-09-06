import type { Diagnostic } from "@codemirror/lint";
import { setDiagnostics } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";

import {
  attachLspToEditor,
  detachLspFromEditor,
} from "@/modules/lsp/manager";
import type { LspDiagnostic } from "@/modules/lsp/types";

export type LspEditorHooks = {
  /** workspace 根目录（initialize 的 rootUri），可缺省。 */
  workspaceRoot?: string | null;
  /** 当前编辑器全文。 */
  getDocumentText: () => string;
  /** LSP 诊断落地：转换后经 setDiagnostics 展示。 */
  applyDiagnostics: (diagnostics: LspDiagnostic[]) => void;
  /** LSP 不可用（无 server 二进制/握手失败）时兜底提示。 */
  onAttachFailed?: (reason: string) => void;
};

/** LSP severity(1-4) → CodeMirror diagnostic severity。 */
function toCmSeverity(severity: number | undefined): Diagnostic["severity"] {
  if (severity === 1) return "error";
  if (severity === 3 || severity === 4) return "info";
  return "warning";
}

/** 把 LSP 诊断范围换算成 CodeMirror 偏移；越界时钳制到文档边界。 */
function lspRangeToCmRange(
  view: EditorView,
  diag: LspDiagnostic,
): { from: number; to: number } {
  const doc = view.state.doc;
  const clampLine = (line1: number): number =>
    Math.min(Math.max(line1, 1), doc.lines);
  const startLine = doc.line(clampLine((diag.range.start.line ?? 0) + 1));
  const endLine = doc.line(clampLine((diag.range.end.line ?? 0) + 1));
  const from = Math.min(
    startLine.from + (diag.range.start.character ?? 0),
    startLine.to,
  );
  const to = Math.min(
    endLine.from + (diag.range.end.character ?? 0),
    endLine.to,
  );
  return { from, to: Math.max(to, from) };
}

/** LSP 诊断数组 → CodeMirror 诊断数组（供 setDiagnostics 效果使用）。 */
export function buildCmDiagnostics(
  view: EditorView,
  lspDiagnostics: LspDiagnostic[],
): Diagnostic[] {
  return lspDiagnostics.map((diag) => {
    const { from, to } = lspRangeToCmRange(view, diag);
    return {
      from,
      to,
      message: diag.message,
      severity: toCmSeverity(diag.severity),
      source: diag.source,
      code: typeof diag.code === "number" ? String(diag.code) : diag.code,
    };
  });
}

/** 用 setDiagnostics 效果把诊断刷进编辑器（空数组即清除标记）。 */
export function applyCmDiagnostics(
  view: EditorView,
  lspDiagnostics: LspDiagnostic[],
): void {
  view.dispatch(setDiagnostics(view.state, buildCmDiagnostics(view, lspDiagnostics)));
}

export async function attachOrDetachLsp(
  editor: EditorView,
  path: string,
  mode: "builtin" | "lsp",
  hooks?: LspEditorHooks,
): Promise<void> {
  await detachLspFromEditor(editor);
  // 切走/关闭 LSP 模式时清掉旧诊断标记，避免残留到 builtin 模式。
  if (hooks && mode !== "lsp") {
    hooks.applyDiagnostics([]);
    return;
  }
  if (mode !== "lsp") return;
  if (!hooks) return;
  const outcome = await attachLspToEditor(editor, path, {
    workspaceRoot: hooks.workspaceRoot,
    getDocumentText: hooks.getDocumentText,
    onDiagnostics: (params) => hooks.applyDiagnostics(params.diagnostics),
  });
  if (!outcome.attached) {
    hooks.applyDiagnostics([]);
    hooks.onAttachFailed?.(outcome.reason);
  }
}
