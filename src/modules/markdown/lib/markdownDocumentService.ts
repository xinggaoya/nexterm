import { native } from "@/lib/native";

export type MarkdownDocumentState =
  | { status: "loading" }
  | { status: "ready"; content: string; size: number }
  | { status: "binary"; size: number }
  | { status: "toolarge"; size: number; limit: number }
  | { status: "error"; message: string };

export async function readMarkdownDocument(
  path: string,
): Promise<MarkdownDocumentState> {
  try {
    const result = await native.fsReadFile(path);
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
