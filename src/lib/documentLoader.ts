import { normalizeErrorMessage } from "./error";
import type { WorkspaceNative } from "@/lib/native";

/**
 * 文本文件读取的共享状态机。
 *
 * `fsReadFile` 的后端返回是一个 tagged union（`text` / `binary` / `toolarge`），
 * 三个消费方 —— 编辑器、Markdown 预览、通用文本预览 —— 过去各自抄了一份
 * 「把它翻成 loading/ready/binary/toolarge/error 五态」的代码。逐行等价，
 * 只有类型别名名字不同；而且三处都写 `String(error)`，会把 `"Error: "` 前缀
 * 一起暴露给用户 UI（`lib/error.ts` 的 `normalizeErrorMessage` 明确是超集）。
 */
export type TextDocumentState =
  | { status: "loading" }
  | { status: "ready"; content: string; size: number }
  | { status: "binary"; size: number }
  | { status: "toolarge"; size: number; limit: number }
  | { status: "error"; message: string };

/** 读取一个文本文件，结果表示为状态而非异常。 */
export async function loadTextDocument(
  wsNative: WorkspaceNative,
  path: string,
): Promise<TextDocumentState> {
  try {
    const result = await wsNative.fsReadFile(path);
    switch (result.kind) {
      case "text":
        return { status: "ready", content: result.content, size: result.size };
      case "binary":
        return { status: "binary", size: result.size };
      case "toolarge":
        return { status: "toolarge", size: result.size, limit: result.limit };
    }
  } catch (error) {
    return { status: "error", message: normalizeErrorMessage(error) };
  }
}
