import type { EditorView } from "@codemirror/view";

import {
  attachLspToEditor,
  detachLspFromEditor,
} from "@/modules/lsp/manager";

export async function attachOrDetachLsp(
  editor: EditorView,
  path: string,
  mode: "builtin" | "lsp",
): Promise<void> {
  await detachLspFromEditor(editor);
  if (mode !== "lsp") return;
  await attachLspToEditor(editor, path);
}
