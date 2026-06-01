import { invoke } from "@tauri-apps/api/core";
import { currentWorkspaceEnv } from "@/modules/workspace/workspaceEnvSnapshot";

type ReadResult =
  | { kind: "text"; content: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

export type EditorDocumentState =
  | { status: "loading" }
  | { status: "ready"; content: string; size: number }
  | { status: "binary"; size: number }
  | { status: "toolarge"; size: number; limit: number }
  | { status: "error"; message: string };

export async function readEditorDocument(
  path: string,
): Promise<EditorDocumentState> {
  try {
    const result = await invoke<ReadResult>("fs_read_file", {
      path,
      workspace: currentWorkspaceEnv(),
    });
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
  path: string,
  content: string,
): Promise<void> {
  await invoke("fs_write_file", {
    path,
    content,
    workspace: currentWorkspaceEnv(),
  });
}
