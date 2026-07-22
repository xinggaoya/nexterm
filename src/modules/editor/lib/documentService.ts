import type { WorkspaceNative } from "@/lib/native";

export type EditorDocumentState =
  | { status: "loading" }
  | { status: "ready"; content: string; size: number }
  | { status: "binary"; size: number }
  | { status: "toolarge"; size: number; limit: number }
  | { status: "error"; message: string };

export async function readEditorDocument(
  wsNative: WorkspaceNative,
  path: string,
): Promise<EditorDocumentState> {
  try {
    const result = await wsNative.fsReadFile(path);
    if (result.kind === "text") {
      return {
        status: "ready",
        content: result.content,
        size: result.size,
      };
    }
    if (result.kind === "binary") {
      return { status: "binary", size: result.size };
    }
    return {
      status: "toolarge",
      size: result.size,
      limit: result.limit,
    };
  } catch (error) {
    return { status: "error", message: String(error) };
  }
}

export async function writeEditorDocument(
  wsNative: WorkspaceNative,
  path: string,
  content: string,
): Promise<void> {
  await wsNative.fsWriteFile(path, content);
}
