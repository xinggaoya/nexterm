import type { WorkspaceNative } from "@/lib/native";
import { imageMimeFromPath, isPreviewableImagePath } from "./imageFiles";

export type FilePreviewState =
  | { status: "loading" }
  | { status: "ready"; src: string; size: number }
  | { status: "unsupported" }
  | { status: "toolarge"; size: number; limit: number }
  | { status: "error"; message: string };

/**
 * 读取图片文件为 data URL。与 markdownDocumentService 同构:状态机
 * 返回值、不抛错,由 Pane 按状态渲染。svg 也走 base64 通道 —— `<img>`
 * 的 data URL 渲染不执行内嵌脚本,比 v-html 安全。
 */
export async function readFilePreview(
  wsNative: WorkspaceNative,
  path: string,
): Promise<FilePreviewState> {
  const mime = imageMimeFromPath(path);
  if (!isPreviewableImagePath(path) || mime === null) {
    return { status: "unsupported" };
  }
  try {
    const result = await wsNative.fsReadFileBase64(path);
    if (result.kind === "toolarge") {
      return { status: "toolarge", size: result.size, limit: result.limit };
    }
    return {
      status: "ready",
      src: `data:${mime};base64,${result.content}`,
      size: result.size,
    };
  } catch (error) {
    return { status: "error", message: String(error) };
  }
}
