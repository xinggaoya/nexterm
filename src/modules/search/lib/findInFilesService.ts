import type { FsGrepResult, WorkspaceNative } from "@/lib/native";
import { escapeRegExp } from "./highlight";

export type FindInFilesRequest = {
  root: string;
  pattern: string;
  /**
   * true = pattern 按 Rust 正则解析;false(默认)= 字面量子串匹配。
   * 后端 fs_grep 只认正则,字面量模式在前端转义,本地 / WSL / SSH
   * 三条路由行为保持一致。
   */
  regex?: boolean;
  caseInsensitive: boolean;
  includeGlobs: string[];
};

export type FindInFilesResponse = {
  hits: FsGrepResult["hits"];
  truncated: boolean;
  filesScanned: number;
};

export async function runFindInFiles(
  wsNative: WorkspaceNative,
  req: FindInFilesRequest,
): Promise<FindInFilesResponse> {
  if (!req.pattern.trim()) {
    return { hits: [], truncated: false, filesScanned: 0 };
  }
  const effectivePattern = req.regex ? req.pattern : escapeRegExp(req.pattern);
  const result: FsGrepResult = await wsNative.fsGrep(effectivePattern, req.root, {
    glob: req.includeGlobs.length > 0 ? req.includeGlobs : undefined,
    caseInsensitive: req.caseInsensitive,
  });
  return {
    hits: result.hits,
    truncated: result.truncated,
    filesScanned: result.filesScanned,
  };
}
