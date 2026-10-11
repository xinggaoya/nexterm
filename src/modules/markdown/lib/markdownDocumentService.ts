import {
  loadTextDocument,
  type TextDocumentState,
} from "@/lib/documentLoader";
import type { WorkspaceNative } from "@/lib/native";

/** 与编辑器共用同一个读取状态机（见 lib/documentLoader.ts）。 */
export type MarkdownDocumentState = TextDocumentState;

export async function readMarkdownDocument(
  wsNative: WorkspaceNative,
  path: string,
): Promise<MarkdownDocumentState> {
  return loadTextDocument(wsNative, path);
}
