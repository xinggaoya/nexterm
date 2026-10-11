import {
  loadTextDocument,
  type TextDocumentState,
} from "@/lib/documentLoader";
import type { WorkspaceNative } from "@/lib/native";

/** 编辑器 / Markdown / 通用预览共用同一个读取状态机（见 lib/documentLoader.ts）。 */
export type EditorDocumentState = TextDocumentState;

export async function readEditorDocument(
  wsNative: WorkspaceNative,
  path: string,
): Promise<EditorDocumentState> {
  return loadTextDocument(wsNative, path);
}

export async function writeEditorDocument(
  wsNative: WorkspaceNative,
  path: string,
  content: string,
): Promise<void> {
  await wsNative.fsWriteFile(path, content);
}
